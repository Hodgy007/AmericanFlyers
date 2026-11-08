import * as THREE from 'three';
import { currentStage, roadPoint } from '../course';
import { hash2, smoothstep, valueNoise } from './noise';
import { ROAD_HALF_WIDTH, seedOf } from './roadside';
import { LAYER, LAYER_COUNT } from './scenery';
import { SWAY_GLSL, SWAY_UNIFORMS } from './sway';
import { groundProbe, type GroundHit, type Weights } from './terrain';

// Ground cover: small instanced plants and stones on the verges and fields right beside the road
// (High: half the density, Ultra: all of it; Low and Medium never load this file). The flat
// textured ground gets grass tufts, wildflowers, stones and, in the desert, sage bushes, so the
// foreground has something to ride past.
//
// Placement is a pure function of the stage and the position (same every ride). Space beside the
// road is cut into cells keyed by road distance, like road chunks: 10 m along the road, three bands
// across it from just outside the gravel shoulder to 30 m. Each cell tries a fixed number of
// jittered candidate points; a candidate is kept by a hash against the density at its distance
// from the road (thickest at the verge, thinning outwards) times a patchiness noise, then by what
// the ground is there (groundProbe in terrain.ts): green or straw tufts and flowers on grass and
// fields, pebbles on the dirt verge, stones and alpine flowers on rock, nothing on snow, sage and
// red stones in the desert. Because every draw is keyed by cell and candidate, High's half share is
// a subset of Ultra's.
//
// Drawing: one InstancedMesh per kind (tuft, flower, stone, bush: four draw calls) for the whole
// cover. Built cells keep their matrices and colours; whenever the set of cells changes they are
// copied side by side into the instance buffers and only that part is uploaded. Cells are built
// within BUILD_R of the rider (nearest first, a few ms of work a frame) and dropped beyond DROP_R,
// so riding allocates nothing in between. The fade at the edge of RANGE is in the vertex shader
// (scale to nothing), so nothing pops. Plants bend with the wind (sway.ts); shading is vertex colour
// (dark at the base, light at the tips) times a per-instance colour, they receive shadows and cast none.

// ------------------------------------------------------------ layout ----

export const CELL = 10; // metres along the road
export const LAT_MIN = ROAD_HALF_WIDTH + 1; // just outside the gravel shoulder (and the guardrails)
export const LAT_MAX = 30;
export const BANDS = 3;
const BAND_W = (LAT_MAX - LAT_MIN) / BANDS;
export const RANGE = 90; // metres from the rider: items are full size up to RANGE - FADE and gone at RANGE
export const FADE = 15;
const BUILD_R = RANGE + 14; // a cell is built when its centre is this close...
const DROP_R = RANGE + 24; // ...and dropped when it is this far, so cells never flicker in and out
const SCAN = 700; // road distance searched either way for cells: a hairpin brings far-along road close
const PEAK = 2.2; // candidate items per m² at the edge of the verge, before patchiness
const FALLOFF = 2.2; // density falls off as (1 - t)^FALLOFF across the 5.6 to 30 m band

export type Kind = 'tuft' | 'flower' | 'stone' | 'bush';
export const KINDS: Kind[] = ['tuft', 'flower', 'stone', 'bush'];

/** Instance capacity of each mesh (the buffers are allocated once); a full Ultra view needs about half of this. */
const CAPACITY: Record<Kind, number> = { tuft: 9000, flower: 1800, stone: 3200, bush: 1800 };

// ----------------------------------------------------------- palettes ----

// Multiplied with the geometry's grey vertex colours (dark base, light tip), so these are the tip colours.
const GREEN = ['#4f8a34', '#5b9a39', '#6aa63f', '#79b04a'];
const STRAW = ['#b9a851', '#c9b863', '#a99a48', '#d2c277'];
const SPARSE = ['#8a8c4a', '#9a9455', '#7f9040']; // thin tufts on the dirt verge
const WILD = ['#f6f6ee', '#f6f6ee', '#f2cf2e', '#f2cf2e', '#8a56c8']; // white, yellow, purple
const ALPINE = ['#f3f3f6', '#f0d447', '#6a7de0', '#e57fb0'];
const GREY = ['#8d8a82', '#75726b', '#9b968b', '#6f6c66'];
const PEBBLE = ['#a89f8a', '#b3aa97', '#938b79'];
const LIMESTONE = ['#b9b3a5', '#9d9686', '#c6c1b4', '#8a8372', '#6d675b']; // Ventoux's pale scree, with a few shadowed dark stones
const RED = ['#a9482b', '#8c3b25', '#b9643b', '#9a5236'];
const SAGE = ['#7f8a5e', '#8d9568', '#6c7a52'];

const pick = (list: string[], u: number) => list[Math.min(list.length - 1, Math.floor(u * list.length))];

// ------------------------------------------------------------ density ----

/** Candidate items per m² at `r` metres from the road centreline (full share): PEAK at the verge, nothing at LAT_MAX. */
export function densityAt(r: number): number {
  const t = Math.min(1, Math.max(0, (r - LAT_MIN) / (LAT_MAX - LAT_MIN)));
  return PEAK * (1 - t) ** FALLOFF;
}

/** Clumpiness 0.12..1 from the position along the road and across it (patches of lush and bare ground a few metres wide). */
export function patchAt(d: number, lat: number): number {
  return Math.min(1, Math.max(0.12, 0.62 + 0.6 * valueNoise(d / 6.5, lat / 6.5 + 31)));
}

/** 0..1: how much of a wildflower meadow this spot is (flowers come in drifts, not evenly). */
export function meadowAt(d: number, lat: number): number {
  return smoothstep(0.2, 0.62, valueNoise(d / 9 + 7, lat / 9 - 5));
}

// --------------------------------------------------------- what grows ----

export interface Pick {
  kind: Kind;
  color: string;
  /** Pebbles and alpine flowers: smaller than the usual. */
  small: boolean;
}

/**
 * What goes at a point with ground weights `w`: `a` chooses which ground it is (the weights are
 * odds), `b` whether anything is kept there (sparse ground keeps fewer), `c` the kind on that
 * ground and `e` the colour; `meadow` (0..1) raises the chance of flowers. Null: nothing.
 */
export function pickCover(w: readonly number[], desert: boolean, meadow: number, a: number, b: number, c: number, e: number): Pick | null {
  if (desert) {
    // Dry country: sage on the dry patches, red stones everywhere, nothing taller.
    if (b > 0.55) return null;
    if (c < 0.3 + 0.6 * w[LAYER.dry]) return { kind: 'bush', color: pick(SAGE, e), small: false };
    return { kind: 'stone', color: pick(RED, e), small: false };
  }
  const grass = w[LAYER.grass], dry = w[LAYER.dry], dirt = w[LAYER.dirt], rock = w[LAYER.rock], snow = w[LAYER.snow], scree = w[LAYER.scree];
  const total = grass + dry + dirt + rock + snow + scree;
  if (total <= 0) return null;
  const x = a * total;
  if (x < grass) {
    const flower = 0.02 + 0.3 * meadow;
    if (c < flower) return { kind: 'flower', color: pick(WILD, e), small: false };
    if (c < flower + 0.03) return { kind: 'stone', color: pick(GREY, e), small: false };
    return { kind: 'tuft', color: pick(GREEN, e), small: false };
  }
  if (x < grass + dry) {
    if (b > 0.9) return null;
    if (c < 0.03 + 0.12 * meadow) return { kind: 'flower', color: pick(c < 0.02 ? WILD : ['#f2cf2e', '#f6f6ee'], e), small: false };
    if (c < 0.1) return { kind: 'stone', color: pick(GREY, e), small: false };
    return { kind: 'tuft', color: pick(STRAW, e), small: false };
  }
  if (x < grass + dry + dirt) {
    if (b > 0.7) return null; // bare dirt: sparse
    if (c < 0.4) return { kind: 'tuft', color: pick(SPARSE, e), small: false };
    return { kind: 'stone', color: pick(PEBBLE, e), small: true };
  }
  if (x < grass + dry + dirt + rock) {
    if (b > 0.5) return null;
    if (c < 0.2) return { kind: 'flower', color: pick(ALPINE, e), small: true };
    if (c < 0.28) return { kind: 'tuft', color: pick(STRAW, e), small: true };
    return { kind: 'stone', color: pick(GREY, e), small: false };
  }
  if (x < grass + dry + dirt + rock + scree) {
    // Bare limestone scree: pale broken stones and nothing growing.
    if (b > 0.8) return null; // rubble is thick up there
    return { kind: 'stone', color: pick(LIMESTONE, e), small: c < 0.45 };
  }
  return null; // snow
}

// ----------------------------------------------------------- planning ----

export interface Cell {
  k: number; // 10 m cell index along the road: distance k * CELL to (k + 1) * CELL
  side: 1 | -1; // + right of the centreline
  band: number; // 0 nearest the road
}

export interface CoverItem {
  kind: Kind;
  x: number; y: number; z: number;
  yaw: number;
  sx: number; sy: number; sz: number;
  color: string;
}

export interface PlanOptions {
  /** Density share, 0..1: High 0.5, Ultra 1. */
  share: number;
  /** Hash seed (from the stage). */
  seed: number;
  desert: boolean;
}

interface Road { x: number; z: number; heading: number }
export type GroundAt = (x: number, z: number, w: Weights) => GroundHit;

const bandEdges = (band: number) => [LAT_MIN + band * BAND_W, LAT_MIN + (band + 1) * BAND_W] as const;

/** Candidate points a cell tries: enough for the density at its inner edge, so the verge band tries the most. */
export function candidateCount(band: number): number {
  const [near, far] = bandEdges(band);
  return Math.ceil(densityAt(near) * CELL * (far - near) * 1.1);
}

/** Where a cell is, for deciding whether to build it: the position of its middle. */
export function cellCentre(cell: Cell, road: (d: number) => Road, out: { x: number; z: number }) {
  const p = road((cell.k + 0.5) * CELL);
  const [a, b] = bandEdges(cell.band);
  const lat = cell.side * (a + b) / 2;
  out.x = p.x - Math.sin(p.heading) * lat;
  out.z = p.z + Math.cos(p.heading) * lat;
}

/**
 * Everything one cell grows: pure given the road and a ground lookup. Positions are world
 * coordinates; heights come from the ground lookup, so items sit on the terrain.
 */
export function planCell(cell: Cell, o: PlanOptions, road: (d: number) => Road, ground: GroundAt): CoverItem[] {
  const out: CoverItem[] = [];
  const [latA, latB] = bandEdges(cell.band);
  const id = (cell.k * 2 + (cell.side > 0 ? 1 : 0)) * 4 + cell.band;
  const w: Weights = new Array(LAYER_COUNT).fill(0);
  const n = candidateCount(cell.band);
  for (let i = 0; i < n; i++) {
    const u = (j: number) => hash2(id ^ o.seed, i * 8 + j);
    const r = latA + u(1) * (latB - latA);
    const lat = cell.side * r;
    const d = (cell.k + u(0)) * CELL;
    // Density at this distance from the road, patchiness, the share: one draw decides, so a lower share keeps a subset.
    if (u(2) >= (densityAt(r) / PEAK) * patchAt(d, lat) * o.share) continue;
    const p = road(d);
    const x = p.x - Math.sin(p.heading) * lat;
    const z = p.z + Math.cos(p.heading) * lat;
    const g = ground(x, z, w);
    // Skip ground nearer another stretch of road (the inside of a hairpin) or the road itself.
    if (g.roadDist < LAT_MIN - 0.3 || g.roadDist < r - 2) continue;
    if (g.slope !== undefined && g.slope > 0.5) continue; // no plants on cliff faces (canyons beside the road)
    const what = pickCover(w, o.desert, meadowAt(d, lat), u(3), u(4), u(5), u(6));
    if (!what) continue;
    const s = u(7);
    const yaw = hash2(id ^ o.seed, i * 8 + 8) * Math.PI * 2;
    const item: CoverItem = { kind: what.kind, x, y: g.h, z, yaw, sx: 1, sy: 1, sz: 1, color: what.color };
    switch (what.kind) {
      case 'tuft': {
        const small = what.small ? 0.55 : 1;
        item.sx = (0.75 + 0.55 * s) * small;
        item.sy = (0.6 + 0.65 * u(3) * u(4)) * small + 0.15 * s;
        item.sz = item.sx;
        item.y -= 0.03; // the blades start just under the surface
        break;
      }
      case 'flower': {
        const small = what.small ? 0.5 : 1;
        item.sy = (0.7 + 0.6 * s) * small;
        item.sx = item.sz = item.sy;
        item.y -= 0.03;
        break;
      }
      case 'stone': {
        const size = (0.06 + 0.22 * s ** 2.5) * (what.small ? 0.7 : 1);
        item.sx = size * (0.85 + 0.5 * u(3));
        item.sy = size * (0.5 + 0.25 * u(4));
        item.sz = size * (0.8 + 0.4 * u(5));
        item.y += item.sy * 0.2; // sunk into the ground a little
        break;
      }
      case 'bush': {
        const size = 0.35 + 0.4 * s;
        item.sx = size;
        item.sy = size * 0.7;
        item.sz = size * (0.9 + 0.3 * u(4));
        item.y -= 0.05;
        break;
      }
    }
    out.push(item);
  }
  return out;
}

// ----------------------------------------------------------- geometry ----

/** Collects triangles with per-vertex colour (grey), normal and the tint flag (1: the instance colour applies). */
class Builder {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly col: number[] = [];
  readonly tint: number[] = [];

  tri(a: THREE.Vector3Tuple, b: THREE.Vector3Tuple, c: THREE.Vector3Tuple, n: THREE.Vector3Tuple, ca: number, cb: number, cc: number, tint = 1) {
    for (const [p, g] of [[a, ca], [b, cb], [c, cc]] as const) {
      this.pos.push(...p);
      this.nor.push(...n);
      this.col.push(g, g, g);
      this.tint.push(tint);
    }
  }

  /** Same, with a colour per vertex instead of a grey. */
  triRgb(a: THREE.Vector3Tuple, b: THREE.Vector3Tuple, c: THREE.Vector3Tuple, n: THREE.Vector3Tuple, rgb: THREE.Color, tint = 0) {
    for (const p of [a, b, c]) {
      this.pos.push(...p);
      this.nor.push(...n);
      this.col.push(rgb.r, rgb.g, rgb.b);
      this.tint.push(tint);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aTint', new THREE.Float32BufferAttribute(this.tint, 1));
    return g;
  }
}

const norm = (x: number, y: number, z: number): THREE.Vector3Tuple => {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
};

/**
 * A grass tuft about 0.55 m tall: seven bent, tapered blades (three triangles each) leaning out
 * from the middle at different angles, so from any side some face the eye. Real geometry, no alpha
 * texture. Normals point mostly up, so tufts light like the ground they stand on.
 */
export function tuftGeometry(): THREE.BufferGeometry {
  const b = new Builder();
  const BLADES = 7;
  for (let i = 0; i < BLADES; i++) {
    const a = (i + 0.35 * hash2(i, 1)) * ((Math.PI * 2) / BLADES);
    const dx = Math.cos(a), dz = Math.sin(a);
    const len = 0.42 + 0.26 * hash2(i, 2);
    const lean = 0.16 + 0.25 * hash2(i, 3);
    const root = 0.025 + 0.025 * hash2(i, 4);
    const twist = a + Math.PI / 2 + (hash2(i, 5) - 0.5) * 1.0; // which way the blade faces
    const sx = Math.cos(twist), sz = Math.sin(twist);
    const shade = 0.88 + 0.2 * hash2(i, 6);
    const mid = len * 0.55;
    const lean2 = lean + 0.55; // blades arch over towards the tip
    const p0: THREE.Vector3Tuple = [dx * root, 0, dz * root];
    const p1: THREE.Vector3Tuple = [p0[0] + dx * Math.sin(lean) * mid, Math.cos(lean) * mid, p0[2] + dz * Math.sin(lean) * mid];
    const tip = len - mid;
    const p2: THREE.Vector3Tuple = [p1[0] + dx * Math.sin(lean2) * tip, p1[1] + Math.cos(lean2) * tip, p1[2] + dz * Math.sin(lean2) * tip];
    const w0 = 0.03, w1 = 0.018;
    const l0: THREE.Vector3Tuple = [p0[0] - sx * w0, 0, p0[2] - sz * w0];
    const r0: THREE.Vector3Tuple = [p0[0] + sx * w0, 0, p0[2] + sz * w0];
    const l1: THREE.Vector3Tuple = [p1[0] - sx * w1, p1[1], p1[2] - sz * w1];
    const r1: THREE.Vector3Tuple = [p1[0] + sx * w1, p1[1], p1[2] + sz * w1];
    const n = norm(dx * 0.35, 1, dz * 0.35);
    const cb = 0.38 * shade, cm = 0.72 * shade, ct = 1.0 * shade;
    b.tri(l0, r0, l1, n, cb, cb, cm);
    b.tri(r0, r1, l1, n, cb, cm, cm);
    b.tri(l1, r1, p2, n, cm, cm, ct);
  }
  return b.build();
}

/** A wildflower about 0.4 m tall: two crossed stem quads, a six-sided head (tinted by the instance colour) and a yellow centre. */
export function flowerGeometry(): THREE.BufferGeometry {
  const b = new Builder();
  const H = 0.38;
  const stem = new THREE.Color('#4d7f2f');
  const stemTop = new THREE.Color('#5e9a38');
  const top = new THREE.Color();
  for (const a of [0, Math.PI / 2]) {
    const sx = Math.cos(a) * 0.009, sz = Math.sin(a) * 0.009;
    const n = norm(-Math.sin(a), 0.3, Math.cos(a));
    b.triRgb([-sx, 0, -sz], [sx, 0, sz], [-sx * 0.6, H, -sz * 0.6], n, stem);
    b.triRgb([sx, 0, sz], [sx * 0.6, H, sz * 0.6], [-sx * 0.6, H, -sz * 0.6], n, top.copy(stemTop));
  }
  // Head: a tilted hexagon, facing up and a little towards the viewer's side.
  const tilt = 0.5;
  const head = (r: number, y: number, sides: number, tint: number, rgb: THREE.Color | null) => {
    const up = norm(0, Math.cos(tilt), -Math.sin(tilt));
    const at = (k: number): THREE.Vector3Tuple => {
      const t = (k / sides) * Math.PI * 2;
      const lx = Math.cos(t) * r, lz = Math.sin(t) * r;
      // tilt about the x axis
      return [lx, y + lz * Math.sin(tilt), lz * Math.cos(tilt)];
    };
    const c: THREE.Vector3Tuple = [0, y, 0];
    for (let k = 0; k < sides; k++) {
      if (rgb) b.triRgb(c, at(k), at(k + 1), up, rgb, tint);
      else b.tri(c, at(k), at(k + 1), up, 1, 1, 1, tint);
    }
  };
  head(0.09, H, 6, 1, null);
  head(0.035, H + 0.006, 5, 0, new THREE.Color('#e8a91c'));
  return b.build();
}

/** A rounded lump: an icosahedron with smooth normals from its middle and grey vertex colours darker at the bottom. */
function lump(radius: number, at: THREE.Vector3Tuple, squash: number, b: Builder) {
  const g = new THREE.IcosahedronGeometry(radius, 0);
  const p = g.attributes.position;
  const v = (i: number): THREE.Vector3Tuple => [p.getX(i) + at[0], p.getY(i) * squash + at[1], p.getZ(i) + at[2]];
  const nrm = (q: THREE.Vector3Tuple) => norm(q[0] - at[0], (q[1] - at[1]) / squash, q[2] - at[2]);
  const shade = (q: THREE.Vector3Tuple) => 0.5 + 0.5 * Math.min(1, Math.max(0, (q[1] + 0.05) / 0.5));
  for (let i = 0; i < p.count; i += 3) {
    const a = v(i), c = v(i + 1), d = v(i + 2);
    // One normal per corner would need per-vertex data in Builder.tri; the face's own average is close enough for a 20-triangle lump.
    const n = nrm([(a[0] + c[0] + d[0]) / 3, (a[1] + c[1] + d[1]) / 3, (a[2] + c[2] + d[2]) / 3]);
    b.tri(a, c, d, n, shade(a), shade(c), shade(d));
  }
  g.dispose();
}

/** A sage bush about 0.45 m across: three lumps (60 triangles), grey-green by the instance colour, darker underneath. */
export function bushGeometry(): THREE.BufferGeometry {
  const b = new Builder();
  lump(0.34, [0, 0.2, 0], 0.75, b);
  lump(0.24, [0.22, 0.14, 0.1], 0.8, b);
  lump(0.22, [-0.18, 0.15, -0.12], 0.8, b);
  return b.build();
}

/** A stone: an icosahedron with its corners nudged by a hash of their position (so shared corners move together), unit size; the instance scale makes it flat and lopsided. */
export function stoneGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = (v: number) => Math.round(v * 100);
    const j = 0.82 + 0.36 * hash2(k(x) * 31 + k(z), k(y) * 17 + 5);
    p.setXYZ(i, x * j, y * j, z * j);
    const shade = 0.62 + 0.38 * Math.min(1, Math.max(0, (y * j + 1) / 2));
    col.set([shade, shade, shade], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

export const triangles = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

// ------------------------------------------------------------ shading ----

/** Feeds the shaders: where the rider is (the fade is measured from there). */
interface CoverUniforms { uCoverRider: { value: THREE.Vector3 } }

/** Vertex colour (dark base, light tip) times the instance colour; plants take the shared wind sway. */
function coverMaterial(uniforms: CoverUniforms, plant: boolean): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: !plant, side: plant ? THREE.DoubleSide : THREE.FrontSide });
  mat.customProgramCacheKey = () => (plant ? 'afCoverPlant' : 'afCoverStone');
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    if (plant) Object.assign(shader.uniforms, SWAY_UNIFORMS);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform vec3 uCoverRider;
${plant ? `attribute float aTint;\n${SWAY_GLSL}` : ''}`)
      // The fade and the sway are applied to the object-space position, so the shadow, fog and
      // projection chunks that follow all see the moved vertex.
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  vec4 afBase = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  transformed *= 1.0 - smoothstep(${(RANGE - FADE).toFixed(1)}, ${RANGE.toFixed(1)}, distance(afBase.xz, uCoverRider.xz));
${plant ? `  // afSway's bend grows with height squared and is tuned for trees: grass is short, so it is
  // given four times its height, which moves a 0.4 m blade by a few centimetres in a breeze.
  float afH = transformed.y * length(instanceMatrix[1].xyz);
  transformed += inverse(mat3(instanceMatrix)) * afSway(afBase.xyz, afH * 4.0, 0.25);` : ''}
}`);
    if (plant) {
      // Stems and flower centres keep their own colour; only tinted vertices take the instance colour.
      shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>', `#include <color_vertex>
vColor.rgb = mix(color.rgb, vColor.rgb, aTint);`);
      // Blades are seen from both sides: light them the same from either (no flipped normal on the back face).
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0'));
    }
  };
  return mat;
}

// ------------------------------------------------------------- cover ----

interface CellData {
  /** Centre of the cell, for dropping it when the rider is far from it. */
  x: number; z: number;
  /** Per kind: instance matrices (16 floats each), colours (3 each) and how many. */
  m: Record<Kind, Float32Array>;
  c: Record<Kind, Float32Array>;
  n: Record<Kind, number>;
}

interface Wanted extends Cell { key: number; dist: number }

const cellKey = (c: Cell) => ((c.k + 100000) * 2 + (c.side > 0 ? 1 : 0)) * BANDS + c.band;

/**
 * The ground cover around the rider. `world.ts` creates it when the tier allows (after the first
 * frame), calls `update()` every frame, and `dispose()`s it when the tier drops. Put `group` in
 * the scene at the origin.
 */
export class GroundCover {
  readonly group = new THREE.Group();
  private readonly uniforms: CoverUniforms = { uCoverRider: { value: new THREE.Vector3(1e6, 0, 1e6) } };
  private readonly plantMat = coverMaterial(this.uniforms, true);
  private readonly stoneMat = coverMaterial(this.uniforms, false);
  private readonly geos: Record<Kind, THREE.BufferGeometry> = { tuft: tuftGeometry(), flower: flowerGeometry(), stone: stoneGeometry(), bush: bushGeometry() };
  private readonly meshes = {} as Record<Kind, THREE.InstancedMesh>;
  private readonly cells = new Map<number, CellData>();
  private queue: Wanted[] = [];
  private share = 1;
  private lastK = Number.NaN;
  private dirty = true; // the set of wanted cells needs working out again
  private flushNeeded = false;
  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpScale = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpMat = new THREE.Matrix4();
  private readonly tmpCol = new THREE.Color();
  private readonly tmpAt = { x: 0, z: 0 };
  private readonly up = new THREE.Vector3(0, 1, 0);

  /** `layer`: the camera layer the cover is drawn on (the ambient-occlusion pass does not look at it). */
  constructor(layer: number) {
    for (const kind of KINDS) {
      const mesh = new THREE.InstancedMesh(this.geos[kind], kind === 'stone' ? this.stoneMat : this.plantMat, CAPACITY[kind]);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY[kind] * 3), 3).setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.visible = false;
      mesh.frustumCulled = false; // one cover round the rider: nearly always on screen, and the bounds would need redoing on every change
      mesh.receiveShadow = true;
      mesh.layers.set(layer);
      this.meshes[kind] = mesh;
      this.group.add(mesh);
    }
    // For tests and screenshots, like __afGround and __afGraphics.
    if (typeof window !== 'undefined') Object.defineProperty(window, '__afCover', { configurable: true, get: () => this.stats() });
  }

  /** Density share (the tier's `groundCover`): a different share replants everything. */
  setShare(share: number) {
    if (share === this.share) return;
    this.share = share;
    this.clear();
  }

  /** Rain darkens the plants with the ground. */
  setWet(wet: number) {
    this.plantMat.color.setScalar(1 - 0.22 * wet);
    this.stoneMat.color.setScalar(1 - 0.2 * wet);
  }

  /** Forgets every cell (a new stage, or a new share). */
  clear() {
    if (this.cells.size) this.flushNeeded = true;
    this.cells.clear();
    this.queue.length = 0;
    this.dirty = true;
  }

  /** What is drawn now: draw calls, instances and triangles (for the performance notes and tests). */
  stats() {
    let instances = 0, tris = 0, calls = 0;
    for (const kind of KINDS) {
      const m = this.meshes[kind];
      if (!m.visible) continue;
      calls++;
      instances += m.count;
      tris += m.count * triangles(this.geos[kind]);
    }
    return { calls, instances, triangles: tris, cells: this.cells.size };
  }

  /**
   * Every frame. `distance` is the rider's road distance, (x, z) their position. Builds the
   * nearest missing cells within `budgetMs`, drops far ones, and moves the fade to the rider.
   */
  update(distance: number, x: number, z: number, budgetMs = 4) {
    this.uniforms.uCoverRider.value.set(x, 0, z);
    const k0 = Math.floor(distance / CELL);
    if (this.dirty || k0 !== this.lastK) {
      this.rescan(k0, x, z);
      this.lastK = k0;
      this.dirty = false;
    }
    if (this.queue.length) {
      const stage = currentStage();
      const opts: PlanOptions = { share: this.share, seed: seedOf(stage.id), desert: stage.scenery.palette === 'desert' };
      const t0 = performance.now();
      do {
        const w = this.queue.pop()!;
        if (!this.cells.has(w.key)) { this.cells.set(w.key, this.buildCell(w, opts)); this.flushNeeded = true; }
      } while (this.queue.length && performance.now() - t0 < budgetMs);
    }
    if (this.flushNeeded) this.flush();
  }

  /** Works out which cells to build (nearest last, so `pop()` takes the nearest) and drops those out of range. */
  private rescan(k0: number, x: number, z: number) {
    for (const [key, c] of this.cells) {
      if (Math.hypot(c.x - x, c.z - z) > DROP_R) { this.cells.delete(key); this.flushNeeded = true; }
    }
    this.queue.length = 0;
    const span = Math.ceil(SCAN / CELL);
    for (let k = k0 - span; k <= k0 + span; k++) {
      for (const side of [-1, 1] as const) {
        for (let band = 0; band < BANDS; band++) {
          const cell: Cell = { k, side, band };
          const key = cellKey(cell);
          if (this.cells.has(key)) continue;
          cellCentre(cell, roadPoint, this.tmpAt);
          const dist = Math.hypot(this.tmpAt.x - x, this.tmpAt.z - z);
          if (dist <= BUILD_R) this.queue.push({ ...cell, key, dist });
        }
      }
    }
    this.queue.sort((a, b) => b.dist - a.dist);
  }

  private buildCell(c: Cell, o: PlanOptions): CellData {
    cellCentre(c, roadPoint, this.tmpAt);
    const cx = this.tmpAt.x, cz = this.tmpAt.z;
    const probe = groundProbe(cx - 20, cx + 20, cz - 20, cz + 20);
    const items = planCell(c, o, roadPoint, probe);
    const n = { tuft: 0, flower: 0, stone: 0, bush: 0 };
    for (const it of items) n[it.kind]++;
    const data: CellData = {
      x: cx, z: cz, n,
      m: { tuft: new Float32Array(n.tuft * 16), flower: new Float32Array(n.flower * 16), stone: new Float32Array(n.stone * 16), bush: new Float32Array(n.bush * 16) },
      c: { tuft: new Float32Array(n.tuft * 3), flower: new Float32Array(n.flower * 3), stone: new Float32Array(n.stone * 3), bush: new Float32Array(n.bush * 3) },
    };
    const at = { tuft: 0, flower: 0, stone: 0, bush: 0 };
    for (const it of items) {
      const i = at[it.kind]++;
      this.tmpQuat.setFromAxisAngle(this.up, it.yaw);
      this.tmpMat.compose(this.tmpPos.set(it.x, it.y, it.z), this.tmpQuat, this.tmpScale.set(it.sx, it.sy, it.sz));
      this.tmpMat.toArray(data.m[it.kind], i * 16);
      this.tmpCol.set(it.color).toArray(data.c[it.kind], i * 3);
    }
    return data;
  }

  /** Copies every cell's instances side by side into the meshes and uploads just that part. */
  private flush() {
    this.flushNeeded = false;
    for (const kind of KINDS) {
      const mesh = this.meshes[kind];
      const mArr = mesh.instanceMatrix.array as Float32Array;
      const cArr = mesh.instanceColor!.array as Float32Array;
      const cap = CAPACITY[kind];
      let n = 0;
      for (const cell of this.cells.values()) {
        const count = Math.min(cell.n[kind], cap - n);
        if (count <= 0) continue;
        mArr.set(count === cell.n[kind] ? cell.m[kind] : cell.m[kind].subarray(0, count * 16), n * 16);
        cArr.set(count === cell.n[kind] ? cell.c[kind] : cell.c[kind].subarray(0, count * 3), n * 3);
        n += count;
      }
      mesh.count = n;
      mesh.visible = n > 0;
      for (const attr of [mesh.instanceMatrix, mesh.instanceColor!]) {
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, n * attr.itemSize);
        attr.needsUpdate = true;
      }
    }
  }

  /** Frees the GPU buffers, geometry and materials, and takes the cover out of the scene. */
  dispose() {
    if (typeof window !== 'undefined') delete (window as unknown as { __afCover?: unknown }).__afCover;
    this.group.removeFromParent();
    for (const kind of KINDS) {
      this.meshes[kind].dispose();
      this.geos[kind].dispose();
    }
    this.plantMat.dispose();
    this.stoneMat.dispose();
    this.cells.clear();
    this.queue.length = 0;
  }
}
