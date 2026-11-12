import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { roadPoint } from '../course';
import type { Stage } from '../stages';
import { hash2 } from './noise';
import { hash01 } from './roadside';

// Dry-stone field walls beside a world's road (`Scenery.dressing.fieldWalls`; Kestrel Vale's Foss Bottom): the fields of a limestone valley, each
// edged by a wall. Per side of the road there is a near wall running parallel to it at about 35 m (the first field), a far one at about 85 m,
// and cross walls between the fields every 150 m or so, from the lane out to the far wall. A field's wall is missing now and then (a hedge, an open
// boundary) and most walls have a gate. `planFieldWalls` is pure (it needs only the stage's road): the layout is hashed from the world's own lap
// metres, so every route and every lap sees the same fields. `buildFieldWalls` stands the sections on the ground as one InstancedMesh per road chunk.

/** Metres of wall in one instanced section. */
export const WALL_SECTION = 4;
const LANE = 7.4; // a cross wall starts just outside the lane's own wall (barriers.ts)
const CROSS_EVERY = 150;
const GATE = 3.6; // metres of gap

export interface WallSection {
  /** The section's two ends, in the world (x east, z south). */
  x0: number; z0: number; x1: number; z1: number;
  /** Which wall it is in: parallel to the road, or across a field. */
  kind: 'along' | 'cross';
  /** For the section's size and tint: stable per place, not per route. */
  seed: number;
}

const mod = (a: number, m: number) => ((a % m) + m) % m;

/** The cross wall of run `j` on a side: its lap metre. */
const crossAt = (j: number, side: number) => j * CROSS_EVERY + (hash01(j, side, 0x77a1) - 0.5) * 70;

/**
 * The wall sections of the road chunk [d0, d1) (course metres): `reach` is how far from the road they are laid (the tier's), `avoid` says where a section
 * must not stand (the landmarks' clear zones). Sections belong to the chunk their start metre is in.
 */
export function planFieldWalls(stage: Stage, d0: number, d1: number, reach: number, avoid?: (x: number, z: number) => boolean): WallSection[] {
  const dress = stage.scenery.dressing;
  const fw = dress?.fieldWalls;
  if (!dress || !fw || reach <= LANE) return [];
  const L = dress.lapLength;
  const inSpan = (m: number) => fw.spans.some(([a, b]) => m >= a && m <= b);
  const u0 = dress.lap(d0);
  const ok = (x: number, z: number, lateral: number) => !fw.blocked?.(x, z, lateral) && !avoid?.(x, z);
  const out: WallSection[] = [];
  const side2 = [-1, 1] as const;
  const point = (d: number, lateral: number, side: number): [number, number] => {
    const p = roadPoint(d);
    return [p.x - Math.sin(p.heading) * lateral * side, p.z + Math.cos(p.heading) * lateral * side];
  };
  /** The lateral offsets of the near and far wall of the run `j`. */
  const lines = (j: number, side: number) => {
    const near = 32 + 9 * hash01(j, side, 3);
    return { near, far: near + 48 + 18 * hash01(j, side, 4) };
  };

  for (const side of side2) {
    // Parallel walls: the sections whose start lap metre (a multiple of WALL_SECTION) is in this chunk.
    for (let k = Math.ceil(u0 / WALL_SECTION); k * WALL_SECTION < u0 + (d1 - d0); k++) {
      const u = k * WALL_SECTION;
      const m = mod(u, L);
      if (!inSpan(m) || !inSpan(mod(u + WALL_SECTION, L))) continue;
      let j = Math.floor(m / CROSS_EVERY);
      if (m < crossAt(j, side)) j--;
      const a = crossAt(j, side), b = crossAt(j + 1, side);
      if (m < a - 1 || m + WALL_SECTION > b + 1) continue; // the cross walls are where the runs meet
      const { near, far } = lines(j, side);
      const d = d0 + (u - u0);
      for (const [lat, which] of [[near, 1], [far, 2]] as const) {
        if (lat > reach) continue;
        if (hash01(j, side, 10 + which) < (which === 1 ? 0.1 : 0.2)) continue; // no wall in this run
        // A gate somewhere along the run.
        const gate = a + 20 + hash01(j, side, 20 + which) * (b - a - 40);
        if (hash01(j, side, 30 + which) < 0.6 && m + WALL_SECTION > gate && m < gate + GATE) continue;
        const [x0, z0] = point(d, lat, side), [x1, z1] = point(d + WALL_SECTION, lat, side);
        if (!ok((x0 + x1) / 2, (z0 + z1) / 2, lat)) continue;
        out.push({ x0, z0, x1, z1, kind: 'along', seed: k * 7 + which + side * 3 });
      }
    }
    // Cross walls: those whose lap metre falls in this chunk, from the lane to the far wall.
    const m0 = mod(u0, L);
    for (let j = Math.floor((m0 - 40) / CROSS_EVERY); j <= Math.ceil((m0 + (d1 - d0) + 40) / CROSS_EVERY); j++) {
      const c = crossAt(j, side);
      if (c < m0 || c >= m0 + (d1 - d0) || !inSpan(mod(c, L))) continue;
      // Both neighbouring runs have a far wall; the cross wall runs out to the nearer end of them (or to the tier's reach).
      const end = Math.min(reach, Math.min(lines(j - 1, side).far, lines(j, side).far));
      const d = d0 + (c - m0);
      const gateAt = LANE + 14 + hash01(j, side, 40) * Math.max(0, end - LANE - 30);
      const gated = hash01(j, side, 41) < 0.5;
      for (let lat = LANE, i = 0; lat + WALL_SECTION <= end + 0.5; lat += WALL_SECTION, i++) {
        if (gated && lat + WALL_SECTION > gateAt && lat < gateAt + GATE) continue;
        const [x0, z0] = point(d, lat, side), [x1, z1] = point(d, lat + WALL_SECTION, side);
        if (!ok((x0 + x1) / 2, (z0 + z1) / 2, lat + WALL_SECTION / 2)) continue;
        out.push({ x0, z0, x1, z1, kind: 'cross', seed: j * 13 + i + side * 5 });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- geometry ----

const SINK = 0.35; // how far a section's body goes below its start's ground, so a sloping field has no gap under it
const LIME = [0.62, 0.6, 0.53]; // pale limestone grey, a warm cast

/** One box with a flat colour (a jittered stone's own shade, a little noise across its faces), no hidden bottom. */
function stone(w: number, h: number, d: number, x: number, y: number, z: number, shade: number, rnd: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.deleteAttribute('uv');
  g.translate(x, y + h / 2, z);
  const arr = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) {
    const noise = 1 + (hash2(i + Math.floor(rnd * 997), 5) - 0.5) * 0.1;
    arr[i] = LIME[0] * shade * noise; arr[i + 1] = LIME[1] * shade * noise; arr[i + 2] = LIME[2] * shade * noise;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/**
 * One WALL_SECTION of wall lying along +x, its base `SINK` below its origin and about 1.15 m above it. Detail 0 (Low and Medium) is a block and two
 * coping stones, 36 triangles; detail 1 (High and Ultra) is three courses of irregular stones, joints staggered, and a lumpy coping, about 130.
 */
export function fieldWallGeometry(detail: 0 | 1): THREE.BufferGeometry {
  const total = WALL_SECTION + 0.04;
  const parts: THREE.BufferGeometry[] = [];
  if (detail === 0) {
    parts.push(stone(total, 0.9, 0.62, total / 2, -SINK, 0, 0.72, 1));
    parts.push(stone(total * 0.55, 0.6, 0.5, total * 0.28, 0.55, 0, 0.92, 2));
    parts.push(stone(total * 0.43, 0.5, 0.5, total * 0.76, 0.55, 0, 0.84, 3));
    return mergeGeometries(parts)!;
  }
  const courses: [number, number, number][] = [[-SINK, 0.3, 3], [0.3, 0.38, 4], [0.68, 0.47, 4]]; // [bottom y, height, stones]
  courses.forEach(([y0, h, n], c) => {
    let x = c % 2 === 0 ? 0 : -0.25;
    for (let i = 0; i < n; i++) {
      const len = total / n + (hash2(i + c * 9, 31) - 0.5) * 0.3;
      const x0 = Math.max(0, x), x1 = Math.min(total, i === n - 1 ? total : x + len);
      if (x1 - x0 > 0.1) {
        const r = hash2(i * 7 + c * 131, 17);
        const top = c === 2;
        parts.push(stone(x1 - x0 - 0.03, h + (top ? (r - 0.5) * 0.18 : 0), top ? 0.5 : 0.6 + r * 0.04, (x0 + x1) / 2, y0, (hash2(i + c, 3) - 0.5) * 0.05, 0.62 + r * 0.35 - (c === 0 ? 0.08 : 0), r));
      }
      x += len;
    }
  });
  return mergeGeometries(parts)!;
}

/** One chunk's walls as an InstancedMesh; null if it has none. `origin` is the chunk group's world position; `ground` the terrain's height there. */
export function buildFieldWalls(sections: WallSection[], geo: THREE.BufferGeometry, mat: THREE.Material, origin: { x: number; z: number }, ground: (x: number, z: number) => number): THREE.InstancedMesh | null {
  if (!sections.length) return null;
  const mesh = new THREE.InstancedMesh(geo, mat, sections.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pitch = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const zAxis = new THREE.Vector3(0, 0, 1);
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const c = new THREE.Color();
  sections.forEach((s, i) => {
    const dx = s.x1 - s.x0, dz = s.z1 - s.z0;
    const len = Math.hypot(dx, dz);
    const y0 = ground(s.x0, s.z0), y1 = ground(s.x1, s.z1);
    q.setFromAxisAngle(up, -Math.atan2(dz, dx));
    q.multiply(pitch.setFromAxisAngle(zAxis, Math.atan2(y1 - y0, len))); // up and down the slope
    pos.set(s.x0 - origin.x, y0, s.z0 - origin.z);
    const r = hash2(s.seed, 91);
    scale.set(len / WALL_SECTION, 0.88 + r * 0.24, 1);
    m.compose(pos, q, scale);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, c.setScalar(0.86 + hash2(s.seed, 92) * 0.28));
  });
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.computeBoundingSphere();
  return mesh;
}
