import * as THREE from 'three';
import { Kit, farMaterial, finish, mix } from './monumentKit';
import type { MonumentOptions } from './monumentTypes';
import { fbm } from './noise';

// The Flatirons above Boulder: a handful of huge, steeply tilted slabs of red-tan
// sandstone leaning against a forested mountainside. They stand 2 to 3 km from the
// road, beyond the terrain tiles, so the model brings its own mountain (a coarse
// heightfield in forest colours) and uses the far material, which lets the haze
// thin it rather than hide it. Local axes: x along the ridge, z towards the road.

const CREST = 470; // metres from the foot to the ridge
const HALF_W = 2600; // half the length of the ridge
const FOOT_Z = 950; // the foot of the slope, towards the road
const BACK_Z = -1350; // the far foot of the ridge
const STEEP = 1.08; // gradient of the face the slabs lean on
const LEAN = (48 * Math.PI) / 180; // slab angle from horizontal

/** Height of the mountainside at (x, z), metres above its foot. Gentle foothills, a steep face, a rounded ridge, then the far side. */
export function mountainHeight(x: number, z: number): number {
  const foot = FOOT_Z + fbm(x / 900 + 3, 0.5, 2) * 90;
  const s = foot - z; // metres back from the foot line
  if (s <= 0) return -14;
  const up = s < 380 ? 0.22 * s : 83.6 + STEEP * (s - 380);
  const ridge = (up + CREST - Math.hypot(up - CREST, 80)) / 2; // a smooth minimum: the face keeps its gradient right up to a rounded crest
  const far = 1 - smooth(1300, 2300, s);
  const ends = 1 - smooth(0.72, 1, Math.abs(x) / HALF_W);
  const rough = 1 + fbm(x / 520 + 11, s / 520, 3) * 0.14;
  return Math.max(-14, ridge * Math.min(far, 1) * ends * rough + fbm(x / 110, z / 110, 2) * 7 * Math.min(1, up / 60));
}

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const NX = 40;
const NZ = 26;

/** The mountainside as a vertex-coloured grid: forest, meadow patches, bare ground on the crest, paler at the foot where the haze lies. */
function mountainGeometry(): THREE.BufferGeometry {
  const pos = new Float32Array(NX * NZ * 3);
  const col = new Float32Array(NX * NZ * 3);
  const forest = new THREE.Color('#2d4a30');
  const pine = new THREE.Color('#3b5a35');
  const meadow = new THREE.Color('#6a7a3e');
  const bare = new THREE.Color('#857b64');
  const haze = new THREE.Color('#a9b9c4');
  const c = new THREE.Color();
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const x = -HALF_W + (2 * HALF_W * i) / (NX - 1);
      const z = BACK_Z + ((FOOT_Z + 120 - BACK_Z) * j) / (NZ - 1);
      const h = mountainHeight(x, z);
      const v = (j * NX + i) * 3;
      pos[v] = x; pos[v + 1] = h; pos[v + 2] = z;
      c.copy(forest).lerp(pine, 0.5 + 0.5 * fbm(x / 260, z / 260, 2));
      c.lerp(meadow, Math.max(0, fbm(x / 400 + 5, z / 400 - 2, 2)) * 0.8);
      c.lerp(bare, smooth(0.8, 1, h / CREST) * 0.7);
      c.lerp(haze, 0.4 * (1 - smooth(0, 70, h)));
      col[v] = c.r; col[v + 1] = c.g; col[v + 2] = c.b;
    }
  }
  const index: number[] = [];
  for (let j = 0; j < NZ - 1; j++) {
    for (let i = 0; i < NX - 1; i++) {
      const a = j * NX + i;
      const b = a + 1;
      const d = a + NX;
      const e = d + 1;
      index.push(a, d, b, b, d, e); // counter-clockwise seen from above (+y)
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(index);
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  g.dispose();
  return flat;
}

/** [x along the ridge, z of the slab's foot, length up the slope, width, thickness, sideways lean of its tip], metres */
const SLABS: [number, number, number, number, number, number][] = [
  [-1100, 590, 300, 210, 40, 40],
  [-760, 560, 420, 300, 50, -60],
  [-330, 545, 460, 330, 56, 50],
  [140, 550, 440, 320, 52, -40],
  [560, 565, 380, 260, 48, 70],
  [930, 580, 310, 220, 42, -50],
  [1250, 600, 230, 170, 36, 30],
];

/** Six or seven huge red-tan slabs leaning on a forested ridge, about 470 m high in all. Far away: the far material, no shadows. */
export function buildFlatirons(_o: MonumentOptions = {}): THREE.Group {
  const k = new Kit();
  k.raw(mountainGeometry());
  const alpha = LEAN - Math.PI / 2; // turns the slab's up axis to lean back against the slope
  SLABS.forEach(([x, zFoot, length, width, thick, skew], i) => {
    const y = mountainHeight(x, zFoot) - 8; // let the foot sink into the hillside
    const tone = mix('#b9825a', '#c7966b', (i % 3) / 3);
    k.within([x, y, zFoot], [alpha, 0, 0], () => {
      k.taper(width, thick, length, 0.1, 0, 0, 0, tone, 0.68, skew);
      k.taper(width * 0.78, thick * 0.4, length * 0.9, 0.1, 0, 0, thick * 0.32, mix(tone, '#e0b48a', 0.5), 0.8, skew * 0.9); // the lit face
    });
  });
  const group = k.build(farMaterial);
  return finish(group, false);
}
