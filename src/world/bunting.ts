import * as THREE from 'three';
import { roadPoint } from '../course';
import type { Stage } from '../stages';
import { hash01 } from './roadside';

// Strings of bunting across a village street (`Scenery.dressing.bunting`; Kestrel Vale's Hollins Cross): a cord from one facade to the other, sagging
// in the middle, with a small triangular flag every 1.4 m (every 2.8 m on Low). The strings hang at the world's own lap metres, so every route and
// lap has them in the same places. One InstancedMesh per road chunk: each instance is a piece of cord and the flag hung from it, scaled to the
// chord it spans, tinted by the flag's colour (so the cord is a dark shade of it). A string is static: the village is sheltered.

const FLAG_COLOURS = ['#d8432f', '#f3efe2', '#2f5fa8', '#e8b93a', '#3b8f4f', '#f3efe2', '#d8432f', '#2f5fa8'];
const SAG = 1.1; // metres the middle of a string hangs below its ends
const FLAG_W = 0.5, FLAG_H = 0.62;

export interface BuntingString {
  /** Course distance of the string. */
  d: number;
  /** Lap metre, for the hash that picks the flags' colours. */
  lapAt: number;
}

/** The strings in the chunk [d0, d1) (course metres), from the world's spans. Pure: needs only the stage. */
export function planBunting(stage: Stage, d0: number, d1: number): BuntingString[] {
  const dress = stage.scenery.dressing;
  const b = dress?.bunting;
  if (!dress || !b) return [];
  const L = dress.lapLength;
  const u0 = dress.lap(d0);
  const out: BuntingString[] = [];
  for (const [from, to] of b.spans) {
    for (let at = from; at <= to + 1e-9; at += b.spacing) {
      const off = (((at - u0) % L) + L) % L; // metres into the chunk, going forward round the lap
      if (off < d1 - d0) out.push({ d: d0 + off, lapAt: at });
    }
  }
  return out;
}

/** Number of flags a string carries at a flag step: the string's width over the step, rounded up. */
export const flagsPerString = (half: number, step: number) => Math.max(2, Math.ceil((2 * half) / step));

/** The piece of cord and its flag, lying along +x, one unit long, the cord at y = 0 and the flag hanging below it facing +z (and -z: two triangles back to back). */
export function buntingGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const cord = new THREE.BoxGeometry(1, 0.035, 0.035).toNonIndexed();
  const p = cord.attributes.position;
  for (let i = 0; i < p.count; i++) { pos.push(p.getX(i) + 0.5, p.getY(i), p.getZ(i)); col.push(0.32, 0.3, 0.27); }
  // The flag: a triangle hanging from the cord's middle, 0.5 wide, 0.62 tall.
  const tri = [[0.5 - FLAG_W / 2, -0.02, 0], [0.5 + FLAG_W / 2, -0.02, 0], [0.5, -FLAG_H, 0]];
  for (const order of [[0, 1, 2], [0, 2, 1]]) for (const i of order) { pos.push(...tri[i]); col.push(1, 1, 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** The pieces of the strings in a chunk as one InstancedMesh (null if none). `step` is the metres between flags. */
export function buildBunting(strings: BuntingString[], half: number, height: number, step: number, geo: THREE.BufferGeometry, mat: THREE.Material, origin: { x: number; z: number }): THREE.InstancedMesh | null {
  if (!strings.length) return null;
  const n = flagsPerString(half, step);
  const mesh = new THREE.InstancedMesh(geo, mat, strings.length * n);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const c = new THREE.Color();
  const mid = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), dir = new THREE.Vector3();
  const xAxis = new THREE.Vector3(1, 0, 0);
  const scale = new THREE.Vector3();
  let i = 0;
  for (const s of strings) {
    const p = roadPoint(s.d);
    // The string lies across the road: lateral t in [-half, half] (left to right) at the road's own height, a parabola of sag.
    const at = (t: number, out: THREE.Vector3) => {
      const lat = -half + 2 * half * t;
      return out.set(p.x - Math.sin(p.heading) * lat - origin.x, p.y + height - SAG * (1 - (2 * t - 1) ** 2), p.z + Math.cos(p.heading) * lat - origin.z);
    };
    for (let k = 0; k < n; k++) {
      at(k / n, a); at((k + 1) / n, b);
      dir.subVectors(b, a);
      const len = dir.length();
      q.setFromUnitVectors(xAxis, dir.normalize());
      // The flag hangs straight down whatever the cord's slope: the cord tilts, the flag is tilted back by the same angle in the same plane (a small angle, so left to hang with it).
      scale.set(len, 1, 1);
      mid.copy(a);
      m.compose(mid, q, scale);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.set(FLAG_COLOURS[Math.floor(hash01(Math.round(s.lapAt), k, 0xb0a7) * FLAG_COLOURS.length)]));
      i++;
    }
  }
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.computeBoundingSphere();
  return mesh;
}
