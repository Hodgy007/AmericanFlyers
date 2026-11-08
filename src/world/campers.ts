import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { roadPoint } from '../course';
import type { Stage } from '../stages';
import { crowdAt, hotspotAt } from './crowdZones';
import { hash01, isClimb, seedOf } from './roadside';

// The roadside camp on the big climbs: motorhomes, tents and parasols with folding
// chairs parked on the verge where the crowds are (crowdZones.ts), set well back
// from the road. Placement is a pure function of the stage and the distance, like
// the spectators, and checks each footprint against the whole road (not just the
// stretch beside it, so a van never lands on the other leg of a hairpin), against
// the guardrails and parapets (barriers.ts), and against the lie of the ground
// (terrain's `groundSampler`). One instanced mesh per kind, per 100 m road chunk.

export type CamperKind = 'van' | 'tent' | 'parasol';

export interface Camper {
  kind: CamperKind;
  d: number; // course distance of the spot
  side: -1 | 1;
  x: number; // world position
  y: number; // the ground there
  z: number;
  yaw: number; // rotation about Y, rad
  tint: string; // body, canvas or canopy colour
}

/** Half length (along the item's x), half width (its z) and the most the ground may vary under it, m. */
export const CAMPER_FOOT: Record<CamperKind, { halfLen: number; halfW: number; slope: number }> = {
  van: { halfLen: 3.2, halfW: 1.2, slope: 0.9 },
  tent: { halfLen: 1.3, halfW: 1.0, slope: 0.6 },
  parasol: { halfLen: 1.7, halfW: 1.7, slope: 0.6 },
};

const SLOT = 22; // metres between candidate spots along the road
const MIN_ZONE = 0.12; // crowdAt() below this: no camp
export const NEAR_CLEAR = 6.2; // m from the centreline for any part of anything: clear of the rails (at 5.6 m) and parapets
export const FAR = 14; // m from the centreline: the furthest a spot's middle goes
const REACH = 200; // m of road either side checked for another stretch of road close by (the other leg of a hairpin)
export const START_CLEAR = 60; // no camp in the start area
export const FINISH_CLEAR = 160; // nor in the last 150 m (the finish gantry and barriers), plus a van's length
const SAMPLE = 4; // m between the road points a spot is checked against

const TINTS: Record<CamperKind, string[]> = {
  van: ['#ffffff', '#f6f2e6', '#e9e5d8', '#dfe7ec', '#f1ead2', '#dbe5d3'],
  tent: ['#e5483b', '#2f80ed', '#f2a900', '#27ae60', '#f4f4f4', '#ff7a2e', '#8e44ad'],
  parasol: ['#e63946', '#f4f4f4', '#ffd23f', '#2f80ed', '#ff7a2e', '#f77f00'],
};
const ORANGE: Record<CamperKind, string> = { van: '#ffb36b', tent: '#ff7a1a', parasol: '#ff6a00' };

/**
 * The camp for road distances [d0, d1). `share` (0..1) thins it for the weaker tiers; `ground` is
 * a height lookup (`groundSampler`); `rails` are the guardrail or parapet sections of the stretch
 * (barrierSections() over a margin either side of the chunk), which a spot keeps a stretch clear of.
 */
export function planCampers(stage: Stage, d0: number, d1: number, share: number, ground: (x: number, z: number) => number, rails: { d: number; side: -1 | 1 }[]): Camper[] {
  if (share <= 0 || !isClimb(stage)) return [];
  const finish = stage.finish!;
  const seed = seedOf(stage.id) ^ 0x2b2b;
  // The road around this chunk, sampled once, for the clearance checks.
  const sx: number[] = [];
  const sz: number[] = [];
  const lo = Math.max(0, d0 - REACH);
  for (let d = lo; d <= d1 + REACH; d += SAMPLE) {
    const p = roadPoint(d);
    sx.push(p.x);
    sz.push(p.z);
  }
  const clear = (x: number, z: number) => {
    for (let i = 0; i < sx.length; i++) {
      const dx = sx[i] - x;
      const dz = sz[i] - z;
      if (dx * dx + dz * dz < NEAR_CLEAR * NEAR_CLEAR) return false;
    }
    return true;
  };

  const out: Camper[] = [];
  for (let k = Math.floor((d0 - 10) / SLOT); k * SLOT < d1 + 10; k++) {
    const d = k * SLOT + (hash01(k, 2, seed) - 0.5) * 12;
    if (d < d0 || d >= d1 || d < START_CLEAR || d > finish - FINISH_CLEAR) continue;
    const c = crowdAt(stage, d);
    if (c < MIN_ZONE) continue;
    const hot = hotspotAt(stage, d);
    const orange = !!hot && hash01(k, 3, seed) < 0.75 * hot.weight;
    const p = Math.min(0.9, 0.16 + 0.4 * Math.min(1, c) + 0.25 * (hot ? hot.weight : 0));
    if (hash01(k, 1, seed) >= p * share) continue;
    const pick = hash01(k, 4, seed);
    const kind: CamperKind = pick < 0.38 ? 'van' : pick < 0.72 ? 'tent' : 'parasol';
    const foot = CAMPER_FOOT[kind];

    const road = roadPoint(d);
    const rx = -Math.sin(road.heading);
    const rz = Math.cos(road.heading);
    // The uphill side first (it has room and a bank behind it); the other only now and then.
    const upLeft = ground(road.x - rx * 10, road.z - rz * 10) > ground(road.x + rx * 10, road.z + rz * 10);
    const first: -1 | 1 = upLeft ? -1 : 1;
    const sides: (-1 | 1)[] = hash01(k, 5, seed) < 0.3 ? [first, -first as -1 | 1] : [first];

    const spot = (() => {
      for (const side of sides) {
        if (rails.some((r) => r.side === side && Math.abs(r.d - d) < foot.halfLen + 5)) continue;
        for (let attempt = 0; attempt < 3; attempt++) {
          const lat = NEAR_CLEAR + foot.halfW + 0.9 + hash01(k, side * 7 + attempt, seed ^ 0x55) * (FAR - NEAR_CLEAR - foot.halfW - 0.9);
          const cx = road.x + rx * lat * side;
          const cz = road.z + rz * lat * side;
          // Vans and tents lie along the road, their doors anywhere; the chairs face the road.
          const along = -(road.heading + (hash01(k, 6, seed) - 0.5) * 0.45 + (hash01(k, 7, seed) < 0.5 ? Math.PI : 0));
          const toRoad = Math.atan2(-rx * side, -rz * side) + (hash01(k, 8, seed) - 0.5) * 0.8;
          const yaw = kind === 'parasol' ? toRoad : along;
          const cos = Math.cos(yaw);
          const sin = Math.sin(yaw);
          const heights: number[] = [];
          let fits = true;
          for (const [lx, lz] of [[0, 0], [foot.halfLen, foot.halfW], [foot.halfLen, -foot.halfW], [-foot.halfLen, foot.halfW], [-foot.halfLen, -foot.halfW]]) {
            const x = cx + lx * cos + lz * sin;
            const z = cz - lx * sin + lz * cos;
            if (!clear(x, z)) { fits = false; break; }
            heights.push(ground(x, z));
          }
          if (!fits) continue;
          if (Math.max(...heights) - Math.min(...heights) > foot.slope) continue; // too steep or lumpy
          if (heights[0] - road.y > 3 || heights[0] - road.y < -2.5) continue; // a high bank, or the edge of a drop
          const y = heights.reduce((a, b) => a + b, 0) / heights.length - 0.05;
          return { side, x: cx, y, z: cz, yaw };
        }
      }
      return null;
    })();
    if (!spot) continue;
    const palette = TINTS[kind];
    out.push({ kind, d, ...spot, tint: orange ? ORANGE[kind] : palette[Math.floor(hash01(k, 9, seed) * palette.length)] });
  }
  return out;
}

// -------------------------------------------------------------- geometry ----

const paint = (g: THREE.BufferGeometry, color: string): THREE.BufferGeometry => {
  const n = g.index ? g.toNonIndexed() : g;
  n.deleteAttribute('uv');
  const c = new THREE.Color(color);
  const arr = new Float32Array(n.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) { arr[i] = c.r; arr[i + 1] = c.g; arr[i + 2] = c.b; }
  n.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return n;
};
/** A coloured box of size (w, h, d) centred at (x, y, z). */
const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: string) => paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color);

/**
 * A motorhome, 6.4 m long, lying along +x with its cab at +x: the body (white, which
 * the instance colour tints), an over-cab bunk, windscreen and side windows, a door, a
 * coloured stripe, roof vents and four wheels. About 200 triangles.
 */
export function vanGeometry(): THREE.BufferGeometry {
  const parts = [
    box(5.0, 2.2, 2.3, -0.7, 1.45, 0, '#ffffff'), // living body
    box(1.4, 1.35, 2.2, 2.5, 1.025, 0, '#ffffff'), // cab
    box(1.4, 0.85, 2.3, 2.5, 2.125, 0, '#fafafa'), // over-cab bunk
    box(0.05, 0.78, 1.9, 3.21, 1.3, 0, '#1d2a35'), // windscreen
    box(0.4, 0.14, 1.9, 3.18, 0.62, 0, '#4a4f55'), // grille and bumper
    box(0.12, 0.22, 2.2, -3.24, 0.5, 0, '#4a4f55'), // rear bumper
    box(0.6, 0.15, 0.6, -1.0, 2.63, 0, '#b9bec3'), // roof vent
    box(1.0, 0.22, 0.8, -2.2, 2.66, 0, '#c9cdd1'), // air conditioner
  ];
  for (const s of [-1, 1]) {
    for (const x of [-2.3, -1.1, 0.1]) parts.push(box(0.9, 0.62, 0.04, x, 1.78, s * 1.16, '#1d2a35')); // side windows
    parts.push(box(0.7, 1.5, 0.05, 1.0, 1.2, s * 1.16, '#d6d8da')); // the door
    parts.push(box(0.8, 0.5, 0.04, 2.5, 1.35, s * 1.11, '#1d2a35')); // cab window
    parts.push(box(5.02, 0.22, 0.03, -0.7, 0.95, s * 1.155, '#c0392b')); // the stripe
    for (const x of [2.4, -1.9]) parts.push(paint(new THREE.CylinderGeometry(0.38, 0.38, 0.26, 8).rotateX(Math.PI / 2).translate(x, 0.38, s * 1.05), '#16181b'));
  }
  return mergeGeometries(parts)!;
}

/**
 * A ridge tent, 2.6 m long and 2 m wide, ridge along x, 1.3 m tall, with a dark doorway
 * at the +x end. Winding is outward (the camper material is single-sided).
 */
export function tentGeometry(): THREE.BufferGeometry {
  const L = 1.3; // half length
  const W = 1.0; // half width
  const H = 1.3;
  const v = (x: number, y: number, z: number) => [x, y, z];
  const tris = [
    // the two ends (outward normals +x and -x)
    [v(L, H, 0), v(L, 0, W), v(L, 0, -W)],
    [v(-L, H, 0), v(-L, 0, -W), v(-L, 0, W)],
    // the +z slope and the -z slope
    [v(L, H, 0), v(-L, H, 0), v(-L, 0, W)], [v(L, H, 0), v(-L, 0, W), v(L, 0, W)],
    [v(L, H, 0), v(L, 0, -W), v(-L, 0, -W)], [v(L, H, 0), v(-L, 0, -W), v(-L, H, 0)],
  ];
  const pos = new Float32Array(tris.length * 9);
  tris.forEach((t, i) => t.forEach((p, j) => pos.set(p, i * 9 + j * 3)));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return mergeGeometries([paint(g, '#ffffff'), box(0.04, 0.8, 0.55, L + 0.005, 0.4, 0, '#2a2a30')])!;
}

/**
 * A parasol with a table and two folding chairs, the chairs on the +z side (they face
 * the road): a pole, an eight-sided canopy in two alternating shades, the table, and chairs.
 */
export function parasolGeometry(): THREE.BufferGeometry {
  const canopy = new THREE.ConeGeometry(1.4, 0.5, 8, 1, true).translate(0, 2.3, 0).toNonIndexed();
  const c = new THREE.Color();
  const arr = new Float32Array(canopy.attributes.position.count * 3);
  for (let f = 0; f < arr.length / 9; f++) {
    c.setScalar(f % 2 ? 0.6 : 1); // alternate panels
    for (let k = 0; k < 3; k++) arr.set([c.r, c.g, c.b], f * 9 + k * 3);
  }
  canopy.deleteAttribute('uv');
  canopy.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  const parts = [
    canopy,
    paint(new THREE.CylinderGeometry(0.025, 0.025, 2.4, 5).translate(0, 1.2, 0), '#8a8f94'),
    box(0.8, 0.04, 0.8, 0, 0.62, 0, '#d9d9d9'), // table
    paint(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 5).translate(0, 0.3, 0), '#6c7176'),
  ];
  for (const x of [-0.75, 0.75]) {
    parts.push(box(0.46, 0.05, 0.44, x, 0.44, 0.95, '#d0d0d0')); // seat
    parts.push(box(0.46, 0.46, 0.05, x, 0.7, 0.75, '#c4c4c4')); // back, towards the table: the sitter looks at the road
    for (const [lx, lz] of [[-0.2, 0.77], [0.2, 0.77], [-0.2, 1.13], [0.2, 1.13]]) parts.push(box(0.03, 0.42, 0.03, x + lx, 0.21, lz, '#5d6268'));
  }
  return mergeGeometries(parts)!;
}

export interface CamperGeometries {
  van: THREE.BufferGeometry;
  tent: THREE.BufferGeometry;
  parasol: THREE.BufferGeometry;
}

export const camperGeometries = (): CamperGeometries => ({ van: vanGeometry(), tent: tentGeometry(), parasol: parasolGeometry() });

export const camperMaterial = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true });

/** One instanced mesh per kind present in `spots`, positioned relative to `origin` (the chunk group's world position). */
export function buildCampers(spots: Camper[], geos: CamperGeometries, mat: THREE.Material, origin: { x: number; z: number }, shadows: boolean): THREE.InstancedMesh[] {
  const out: THREE.InstancedMesh[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const col = new THREE.Color();
  for (const kind of ['van', 'tent', 'parasol'] as const) {
    const list = spots.filter((s) => s.kind === kind);
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(geos[kind], mat, list.length);
    list.forEach((s, i) => {
      pos.set(s.x - origin.x, s.y, s.z - origin.z);
      q.setFromAxisAngle(up, s.yaw);
      mesh.setMatrixAt(i, m.compose(pos, q, one));
      mesh.setColorAt(i, col.set(s.tint));
    });
    mesh.castShadow = shadows;
    mesh.receiveShadow = false;
    mesh.computeBoundingSphere();
    out.push(mesh);
  }
  return out;
}
