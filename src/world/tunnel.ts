import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { roadPoint } from '../course';
import { fbm, smoothstep } from './noise';
import { TUNNEL_BAY, TUNNEL_CROWN, TUNNEL_HALF_WIDTH, TUNNEL_HILL, TUNNEL_WALL, TUNNEL_KERB as KERB, tunnelProfile, vaultHeight, type TunnelSpan } from './tunnelSpan';

export { TUNNEL_BAY, TUNNEL_CROWN, TUNNEL_HALF_WIDTH, TUNNEL_WALL, tunnelProfile, vaultHeight };

/** The shell is sampled every this many metres along the road: the road's own spacing, so chunks meet exactly. */
const STEP = 2;

// A road tunnel (`Scenery.tunnels`): a tube extruded along the road's own centreline, walls and a vault a little wider than the road, built per 100 m
// road chunk by RoadExtras (so it streams with the road). The terrain over the span is raised by the stage's `roadside` hook (the hill closes over
// the road); this is what the rider sees: inward-facing dark concrete, a lighter kerb band, a ring joint every 6 m and a lamp between every two,
// with the light pooled on the vault in vertex colours (no real lights). Two meshes per chunk: the shell and the lamps. The shell casts shadows,
// so the vault darkens the road and the rider in sunlight; the lighting in world.ts is left alone. The portal arches are a monument (monuments.ts).

export interface RoadSample { x: number; y: number; z: number; heading: number }
export type RoadFn = (d: number) => RoadSample;

/** The course distances the shell is sampled at between `from` and `to`: both ends exactly, and every STEP metres (on multiples of it) between, so a chunk's neighbours meet on the same row. */
function rowsBetween(from: number, to: number): number[] {
  const out = [from];
  for (let d = Math.floor(from / STEP + 1e-9) * STEP + STEP; d < to - 1e-6; d += STEP) if (d > from + 1e-6) out.push(d);
  if (to > from + 1e-6) out.push(to);
  return out;
}

// Concrete: warm dark greys. The kerb band is a lighter grey, the vault a shade darker.
const WALL = new THREE.Color('#5a5852');
const KERB_COL = new THREE.Color('#8a877e');
const VAULT = new THREE.Color('#4a4944');
const FLOOR_EDGE = 4.5; // the floor strip runs in to here (the road's half width is 4.6)
const FLOOR = new THREE.Color('#34332f');
const LAMP_Y = 0.07; // lamps hang this far below the vault's underside
const LAMP_LAT = 1.9; // two rows of lamps, this far either side of the crown
const LAMP_LEN = 1.1;
const LAMP_WIDTH = 0.28;

/**
 * The shell and the lamps for the part of the tunnel in [d0, d1) (course metres). `road` gives the centreline; positions are relative to `origin`
 * (the chunk group's world position). Null geometries mean the chunk holds no tunnel. Pure given `road` (the unit tests call it with a straight one).
 */
export function tunnelGeometry(spans: readonly TunnelSpan[], d0: number, d1: number, road: RoadFn, origin: { x: number; z: number }): { shell: THREE.BufferGeometry | null; lamps: THREE.BufferGeometry | null; hill: THREE.BufferGeometry | null } {
  const hills: THREE.BufferGeometry[] = [];
  const shells: THREE.BufferGeometry[] = [];
  const lamps: THREE.BufferGeometry[] = [];
  // The shell's ring: the walls and vault, and a strip of floor from the foot of each wall in to the road's edge (the road mesh is only 9.2 m wide).
  const profile: [number, number][] = [[-FLOOR_EDGE, 0], ...tunnelProfile(), [FLOOR_EDGE, 0]];
  for (const span of spans) {
    const a = Math.max(d0, span.from);
    const b = Math.min(d1, span.to);
    if (!(b > a + 1e-6)) continue;
    const rows = rowsBetween(a, b);
    const n = profile.length;
    const pos = new Float32Array(rows.length * n * 3);
    const col = new Float32Array(rows.length * n * 3);
    const tmp = new THREE.Color();
    rows.forEach((d, r) => {
      const p = road(d);
      const rx = -Math.sin(p.heading);
      const rz = Math.cos(p.heading);
      // Light pooled round each lamp, dark at the ring joints; strongest on the vault, absent low on the walls. The shell ends fade into the dark.
      const bay = (d - TUNNEL_BAY / 2) / TUNNEL_BAY;
      const pool = 0.5 + 0.5 * Math.cos(2 * Math.PI * bay);
      profile.forEach(([lat, y], i) => {
        const k = (r * n + i) * 3;
        pos[k] = p.x + rx * lat - origin.x;
        pos[k + 1] = p.y + y;
        pos[k + 2] = p.z + rz * lat - origin.z;
        const upper = smoothstep(TUNNEL_WALL - 0.5, TUNNEL_CROWN - 0.8, y);
        const base = y === 0 ? FLOOR : y < KERB + 0.05 ? KERB_COL : tmp.copy(WALL).lerp(VAULT, upper);
        const f = 0.74 + 0.4 * pool * (0.45 + 0.55 * upper) + 0.14 * upper;
        const band = y < KERB + 0.05 ? 1 : 0.92 + 0.08 * Math.sin(d * 0.9 + lat * 1.7); // a little unevenness in the concrete
        col[k] = base.r * f * band;
        col[k + 1] = base.g * f * band;
        col[k + 2] = base.b * f * band;
      });
    });
    const index: number[] = [];
    for (let r = 0; r + 1 < rows.length; r++) {
      for (let i = 0; i + 1 < n; i++) {
        const v00 = r * n + i, v01 = r * n + i + 1, v10 = (r + 1) * n + i, v11 = (r + 1) * n + i + 1;
        // Wound so the faces look in at the road (the shell is only ever seen from inside).
        index.push(v00, v10, v01, v01, v10, v11);
      }
    }
    const shell = new THREE.BufferGeometry();
    shell.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    shell.setAttribute('color', new THREE.BufferAttribute(col, 3));
    shell.setIndex(index);
    shell.computeVertexNormals();
    shells.push(shell);

    if (span.roof) hills.push(hillGeometry(span.roof, rows, road, origin));

    // Lamps: flat boxes on the vault, every TUNNEL_BAY metres between the ring joints, in two rows.
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (let k = Math.ceil((a - TUNNEL_BAY / 2 - 1e-6) / TUNNEL_BAY); k * TUNNEL_BAY + TUNNEL_BAY / 2 < b; k++) {
      const d = k * TUNNEL_BAY + TUNNEL_BAY / 2;
      if (d < a || d >= b) continue;
      const p = road(d);
      const ahead = road(d + 1);
      const pitch = Math.atan2(ahead.y - p.y, Math.hypot(ahead.x - p.x, ahead.z - p.z));
      for (const side of [-1, 1]) {
        const lat = side * LAMP_LAT;
        const y = vaultHeight(lat) - LAMP_Y;
        e.set(0, -p.heading, pitch, 'YXZ');
        q.setFromEuler(e);
        m.compose(
          new THREE.Vector3(p.x - Math.sin(p.heading) * lat - origin.x, p.y + y, p.z + Math.cos(p.heading) * lat - origin.z),
          q,
          new THREE.Vector3(1, 1, 1),
        );
        lamps.push(new THREE.BoxGeometry(LAMP_LEN, 0.08, LAMP_WIDTH).applyMatrix4(m));
      }
    }
  }
  return {
    shell: shells.length ? (shells.length === 1 ? shells[0] : mergeGeometries(shells)) : null,
    lamps: lamps.length ? mergeGeometries(lamps) : null,
    hill: hills.length ? (hills.length === 1 ? hills[0] : mergeGeometries(hills)) : null,
  };
}

const HILL_STEP = 4; // metres between the hill's rows along the road
const HILL_ROCK = new THREE.Color('#7b786b');
const HILL_GRASS = new THREE.Color('#52703a');
const HILL_DARK = new THREE.Color('#3f4a33');

/**
 * The hill over the tunnel: a heightfield (`TunnelSpan.roof`) on a 2 m grid across the road, 12 m either side, with a skirt dropped round its edge so it
 * meets the terrain without a crack; the terrain under it is dug out (the stage's `roadside` hook). Rock and moss in vertex colours.
 */
function hillGeometry(roof: (d: number, lat: number) => number, rows: number[], road: RoadFn, origin: { x: number; z: number }): THREE.BufferGeometry {
  // Its own, coarser rows: every HILL_STEP metres (on multiples of it, so a chunk's neighbours meet) and both ends.
  const a = rows[0], b = rows[rows.length - 1];
  const ds = [a];
  for (let d = Math.floor(a / HILL_STEP + 1e-9) * HILL_STEP + HILL_STEP; d < b - 1e-6; d += HILL_STEP) if (d > a + 1e-6) ds.push(d);
  ds.push(b);
  const lats: number[] = [];
  for (let l = -TUNNEL_HILL; l <= TUNNEL_HILL; l += 2) lats.push(l);
  const cols = [lats[0] - 1.2, ...lats, lats[lats.length - 1] + 1.2]; // the skirt columns
  const pos = new Float32Array(ds.length * cols.length * 3);
  const col = new Float32Array(ds.length * cols.length * 3);
  const tmp = new THREE.Color();
  ds.forEach((d, r) => {
    const p = road(d);
    const rx = -Math.sin(p.heading);
    const rz = Math.cos(p.heading);
    cols.forEach((lat, c) => {
      const k = (r * cols.length + c) * 3;
      const skirt = c === 0 || c === cols.length - 1;
      const x = p.x + rx * lat;
      const z = p.z + rz * lat;
      pos[k] = x - origin.x;
      pos[k + 1] = p.y - 0.15 + roof(d, skirt ? Math.sign(lat) * TUNNEL_HILL : lat) - (skirt ? 1.5 : 0);
      pos[k + 2] = z - origin.z;
      const t = 0.5 + 0.5 * fbm(x / 14 + 7, z / 14, 2);
      tmp.copy(HILL_ROCK).lerp(HILL_GRASS, 0.1 + 0.4 * t).lerp(HILL_DARK, 0.18 * (1 - t));
      col[k] = tmp.r; col[k + 1] = tmp.g; col[k + 2] = tmp.b;
    });
  });
  const index: number[] = [];
  const n = cols.length;
  for (let r = 0; r + 1 < ds.length; r++) {
    for (let c = 0; c + 1 < n; c++) {
      const v00 = r * n + c, v01 = r * n + c + 1, v10 = (r + 1) * n + c, v11 = (r + 1) * n + c + 1;
      index.push(v00, v01, v10, v01, v11, v10); // facing up (checked in tunnel.test.ts)
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

let materials: { shell: THREE.MeshStandardMaterial; lamp: THREE.MeshBasicMaterial; hill: THREE.MeshStandardMaterial } | null = null;

/** The two materials every tunnel chunk shares (made on first use). */
export function tunnelMaterials() {
  materials ??= {
    // Double-sided: the side camera (4 m to the rider's right) can end up beside the wall, in the slot the terrain is dug out to; it then sees a concrete wall rather than through it.
    shell: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.96, metalness: 0 }),
    lamp: new THREE.MeshBasicMaterial({ color: '#fff0c4' }),
    hill: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }),
  };
  return materials;
}

/** The tunnel's meshes for the road chunk [d0, d1) whose group stands at `origin`: none if the chunk holds no tunnel. The caller disposes the geometries. */
export function buildTunnel(spans: readonly TunnelSpan[], d0: number, d1: number, origin: { x: number; z: number }): { objects: THREE.Object3D[]; geos: THREE.BufferGeometry[] } {
  const objects: THREE.Object3D[] = [];
  const geos: THREE.BufferGeometry[] = [];
  const g = tunnelGeometry(spans, d0, d1, roadPoint, origin);
  const mats = tunnelMaterials();
  if (g.shell) {
    const mesh = new THREE.Mesh(g.shell, mats.shell);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    objects.push(mesh);
    geos.push(g.shell);
  }
  if (g.hill) {
    const mesh = new THREE.Mesh(g.hill, mats.hill);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    objects.push(mesh);
    geos.push(g.hill);
  }
  if (g.lamps) {
    objects.push(new THREE.Mesh(g.lamps, mats.lamp));
    geos.push(g.lamps);
  }
  return { objects, geos };
}
