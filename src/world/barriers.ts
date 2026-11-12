import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { roadPoint } from '../course';
import type { Stage } from '../stages';
import { hash2 } from './noise';
import { ROAD_HALF_WIDTH, bendsOf, hash01, isClimb } from './roadside';
import { tunnelAt } from './tunnelSpan';

// Guardrails (a W-beam on posts) on mountain stages: along the outside of every
// hairpin and wherever the ground falls away beside the road. One instanced
// 3 m section, placed per road chunk. The alpine passes (`barrier: 'stone'` in the
// stage's scenery) get a low dry-stone parapet in the same places instead, and a
// road with `barrier: 'none'` gets nothing: the drop is just a drop.

const SECTION = 3; // metres per section
const SIDE_OFFSET = ROAD_HALF_WIDTH + 1.0; // just beyond the gravel shoulder
const DROP_AT = 13; // metres from the centreline where the ground is compared with the road
const DROP_MIN = 4; // metres lower than the road there = a drop worth a rail

/** What stands at the roadside on this stage. */
export const barrierKind = (stage: Stage): 'rail' | 'stone' | 'none' => stage.scenery.barrier ?? 'rail';

/** Climbs, and stages with canyons beside the road, get barriers, unless the stage says the road is unguarded (`barrier: 'none'`, Mount Washington). */
export const hasBarriers = (stage: Stage) => barrierKind(stage) !== 'none' && (isClimb(stage) || stage.scenery.roadside !== undefined || stage.scenery.walls !== undefined);

/** Which sections along [d0, d1) get a rail, and on which side (-1 left, +1 right). `ground` is a height lookup (terrain's `groundSampler`). */
export function barrierSections(stage: Stage, d0: number, d1: number, ground: (x: number, z: number) => number): { d: number; side: -1 | 1 }[] {
  if (!hasBarriers(stage)) return [];
  const bends = bendsOf(stage);
  const out: { d: number; side: -1 | 1 }[] = [];
  const first = Math.ceil(d0 / SECTION);
  for (let k = first; k * SECTION < d1; k++) {
    const d = k * SECTION;
    if (d < 40) continue; // not through the start
    if (tunnelAt(stage.scenery.tunnels, d, 4)) continue; // the tunnel's own walls are the guard
    if (stage.finish !== null && Math.abs(d - stage.finish) < 14) continue; // the finish gantry and its crowd barriers are elsewhere
    const p = roadPoint(d);
    for (const side of [-1, 1] as const) {
      // The outside of a hairpin: a right turn (+1) has its outside on the left (-1).
      const bend = bends.some((b) => d > b.start - 9 && d < b.end + 9 && b.turn === -side);
      let drop = false;
      if (!bend) {
        const x = p.x - Math.sin(p.heading) * DROP_AT * side;
        const z = p.z + Math.cos(p.heading) * DROP_AT * side;
        drop = p.y - ground(x, z) > DROP_MIN;
      }
      // Dry-stone walls along a country lane (`Scenery.walls`): both sides, with a field gate now and then.
      const wall = !bend && !drop && stage.scenery.walls?.(d) === true && hash01(k, side, 0x5a11) > 0.05;
      if (bend || drop || wall) out.push({ d, side });
    }
  }
  return out;
}

/** A 3 m guardrail section lying along +x: the beam and a post at its start. Colours baked in as vertex colours. */
export function railGeometry(): THREE.BufferGeometry {
  const paint = (g: THREE.BufferGeometry, color: string) => {
    const n = g.toNonIndexed();
    n.deleteAttribute('uv');
    const c = new THREE.Color(color);
    const arr = new Float32Array(n.attributes.position.count * 3);
    for (let i = 0; i < arr.length; i += 3) { arr[i] = c.r; arr[i + 1] = c.g; arr[i + 2] = c.b; }
    n.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return n;
  };
  return mergeGeometries([
    paint(new THREE.BoxGeometry(SECTION + 0.06, 0.3, 0.05).translate(SECTION / 2, 0.62, 0), '#aeb4ba'), // the W-beam
    paint(new THREE.BoxGeometry(SECTION + 0.06, 0.06, 0.09).translate(SECTION / 2, 0.62, 0.02), '#9aa1a8'), // its ridge
    paint(new THREE.BoxGeometry(0.12, 0.78, 0.1).translate(0, 0.39, 0.07), '#7a8087'), // post
    paint(new THREE.BoxGeometry(0.1, 0.05, 0.06).translate(0.0, 0.62, -0.04), '#d8452f'), // a reflector on the post
  ])!;
}

const SINK = 0.12; // how far below the road's surface a section's origin sits (see buildBarriers)
const PARAPET_T = 0.45; // thick
// Course boundaries in the section's own y: the first is buried (so it sits on a sloping verge), the last is
// 0.55 m above the road.
const COURSE_Y = [-0.4, 0.2, 0.44, 0.55 + SINK];

/**
 * A 3 m dry-stone parapet section lying along +x: three courses of irregular grey
 * stones (each a slightly jittered block, joints staggered from course to course).
 * Colour is baked in per stone as vertex colours; the material is flat-shaded, so
 * the faces read as stones. Deterministic: the same section everywhere.
 */
export function stoneGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const total = SECTION + 0.06; // a little overlap so bends don't open gaps
  for (let course = 0; course < COURSE_Y.length - 1; course++) {
    const y0 = COURSE_Y[course];
    const height = COURSE_Y[course + 1] - y0;
    const top = course === COURSE_Y.length - 2;
    let x = course % 2 === 0 ? 0 : -0.3; // staggered joints
    for (let i = 0; x < total; i++) {
      const len = 0.42 + hash2(i + course * 40, 11) * 0.42;
      const x0 = Math.max(0, x);
      const x1 = Math.min(total, x + len);
      if (x1 - x0 > 0.05) {
        const rnd = (k: number) => hash2(i * 7 + course * 131 + k, 23);
        const sy = height + (top ? (rnd(1) - 0.5) * 0.07 : 0); // the cap stones are uneven
        const sz = PARAPET_T * (top ? 1 : 0.88 + rnd(2) * 0.12);
        const geo = new THREE.BoxGeometry(x1 - x0 - 0.02, sy, sz).toNonIndexed();
        geo.deleteAttribute('uv');
        geo.translate((x0 + x1) / 2, y0 + sy / 2, (rnd(3) - 0.5) * 0.04);
        // Grey stone with a warm or green cast, darker low down, the odd lichen-bright one.
        const shade = 0.42 + rnd(4) * 0.22 - (course === 0 ? 0.06 : 0) + (rnd(5) > 0.9 ? 0.1 : 0);
        const c = new THREE.Color().setRGB(shade * (0.96 + rnd(6) * 0.1), shade * (0.97 + rnd(7) * 0.06), shade * (0.92 + rnd(8) * 0.12), THREE.SRGBColorSpace);
        const arr = new Float32Array(geo.attributes.position.count * 3);
        for (let k = 0; k < arr.length; k += 3) {
          const jitter = 1 + (hash2(k + i * 977, course) - 0.5) * 0.12; // a little noise across each face
          arr[k] = c.r * jitter; arr[k + 1] = c.g * jitter; arr[k + 2] = c.b * jitter;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
        parts.push(geo);
      }
      x += len;
    }
  }
  return mergeGeometries(parts)!;
}

/** Builds one chunk's guardrail mesh from the sections that fall in it; null if none. `origin` is the chunk group's world position. */
export function buildBarriers(sections: { d: number; side: -1 | 1 }[], geo: THREE.BufferGeometry, mat: THREE.Material, origin: { x: number; z: number }): THREE.InstancedMesh | null {
  if (!sections.length) return null;
  const mesh = new THREE.InstancedMesh(geo, mat, sections.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const pitch = new THREE.Quaternion();
  const zAxis = new THREE.Vector3(0, 0, 1);
  sections.forEach((s, i) => {
    // Lay the section from d to d + SECTION: follow the chord between the two road points.
    const a = roadPoint(s.d);
    const b = roadPoint(s.d + SECTION);
    const ax = a.x - Math.sin(a.heading) * SIDE_OFFSET * s.side;
    const az = a.z + Math.cos(a.heading) * SIDE_OFFSET * s.side;
    const bx = b.x - Math.sin(b.heading) * SIDE_OFFSET * s.side;
    const bz = b.z + Math.cos(b.heading) * SIDE_OFFSET * s.side;
    // Local +x runs along (bx - ax, bz - az); rotation about Y by -atan2(dz, dx).
    q.setFromAxisAngle(up, -Math.atan2(bz - az, bx - ax));
    q.multiply(pitch.setFromAxisAngle(zAxis, Math.atan2(b.y - a.y, Math.hypot(bx - ax, bz - az)))); // and up the grade
    pos.set(ax - origin.x, a.y - SINK, az - origin.z);
    m.compose(pos, q, one);
    mesh.setMatrixAt(i, m);
  });
  mesh.receiveShadow = false;
  mesh.castShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}
