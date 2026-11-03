// Trees: nine low-poly species in one faceted style, two levels of detail each, one shared material
// that sways in the wind, and the pure rules that decide what grows where. terrain.ts scatters them
// (one InstancedMesh per species per 200 m tile) and swaps each tile between the near and far
// geometry as the rider moves.
//
// Every tree stands with its base at y = 0 and is a single non-indexed mesh with per-vertex colour:
// darker at the bottom and inside of the crown, lighter at the tips, and a little lighter on faces
// that look up. The far geometry keeps the near one's silhouette and colours in a third of the
// triangles. Shape jitter is seeded per species, so every ride draws the same trees.

import * as THREE from 'three';
import { hash2, rng, smoothstep } from './noise';
import { SWAY_GLSL, SWAY_UNIFORMS } from './sway';

// ------------------------------------------------------------ species ----

export const TREE_SPECIES = ['spruce', 'pine', 'larch', 'oak', 'beech', 'aspen', 'cottonwood', 'juniper', 'shrub'] as const;
export type TreeSpecies = (typeof TREE_SPECIES)[number];
/** Relative weights of the species a stage grows (they need not add up to 1). */
export type TreeMix = Partial<Record<TreeSpecies, number>>;
export type TreeLod = 'near' | 'far';

/**
 * The mix for a stage that does not name one (an uploaded GPX route): `coniferBias` splits conifers
 * from broadleaves, as it always did; the desert gets junipers; a few shrubs everywhere.
 */
export function defaultMix(coniferBias: number, desert: boolean): TreeMix {
  if (desert) return { juniper: 0.8, shrub: 0.2 };
  const c = Math.min(1, Math.max(0, coniferBias));
  const b = 1 - c;
  const mix: TreeMix = { spruce: 0.5 * c, pine: 0.3 * c, larch: 0.2 * c, oak: 0.35 * b, beech: 0.35 * b, aspen: 0.15 * b, cottonwood: 0.15 * b, shrub: 0.04 };
  for (const s of TREE_SPECIES) if (!mix[s]) delete mix[s];
  return mix;
}

interface Habitat {
  /** Ground height (m, the course's datum) where the species fades in. */
  rise?: [number, number];
  /** ... and where it fades out. */
  fall?: [number, number];
}

// Where each species that cares grows. Oaks and cottonwoods stay low, beeches and aspens thin out
// before the tree line, larches need some height. Spruce, pine, juniper and shrubs grow anywhere.
const HABITAT: Partial<Record<TreeSpecies, Habitat>> = {
  larch: { rise: [150, 450] },
  oak: { fall: [350, 750] },
  cottonwood: { fall: [150, 400] },
  beech: { fall: [800, 1250] },
  aspen: { fall: [1000, 1400] },
};

/** How well `species` grows at ground height `h`: 0 (not at all) to 1. */
export function habitat(species: TreeSpecies, h: number): number {
  const b = HABITAT[species];
  if (!b) return 1;
  let k = 1;
  if (b.rise) k *= smoothstep(b.rise[0], b.rise[1], h);
  if (b.fall) k *= 1 - smoothstep(b.fall[0], b.fall[1], h);
  return k;
}

/** The species for a position at height `h`, from a uniform `u` in [0, 1): the mix's weights times how well each grows there. */
export function pickSpecies(mix: TreeMix, h: number, u: number): TreeSpecies {
  let total = 0;
  for (const s of TREE_SPECIES) {
    const w = mix[s];
    if (w) total += w * habitat(s, h);
  }
  if (total <= 0) return TREE_SPECIES.find((s) => mix[s]) ?? 'spruce';
  let t = u * total;
  let last: TreeSpecies = 'spruce';
  for (const s of TREE_SPECIES) {
    const w = mix[s];
    if (!w) continue;
    const k = w * habitat(s, h);
    if (k <= 0) continue;
    last = s;
    t -= k;
    if (t < 0) return s;
  }
  return last;
}

/**
 * The share of candidate points outside forest patches that still get a lone tree: 6% on farmland
 * (the stages from `forestCover` -0.2 up), fewer on open grassland (Morgul-Bismark).
 */
export function loneTreeShare(forestCover: number): number {
  return 0.06 * Math.min(1, Math.max(0.35, 1 + (forestCover + 0.2) * 2.5));
}

const SHRUB_BAND = 25; // shrubs (krummholz) grow this far above the tree line
const SHRUB_FADE = 80; // ...and take over from trees over this many metres below it

/**
 * What may grow at height `h` given the tree line: a tree, a shrub (stunted growth near and just
 * above the tree line), or nothing. `forest` is the forest noise, which raises the line in
 * forest patches; `u` is uniform in [0, 1).
 */
export function treeLineRule(h: number, treeLine: number, forest: number, u: number): 'tree' | 'shrub' | null {
  const tl = treeLine + forest * 40;
  if (h > tl + SHRUB_BAND) return null;
  if (h > tl) return u < 0.5 ? 'shrub' : null;
  return u < smoothstep(tl - SHRUB_FADE, tl, h) * 0.85 ? 'shrub' : 'tree';
}

const SCALE: Record<TreeSpecies, [number, number]> = {
  spruce: [0.8, 1.5], pine: [0.85, 1.45], larch: [0.8, 1.4], oak: [0.75, 1.35], beech: [0.75, 1.3],
  aspen: [0.8, 1.3], cottonwood: [0.85, 1.4], juniper: [0.7, 1.3], shrub: [0.6, 1.4],
};

/** Instance size for a species, from a uniform `u`. */
export function treeScale(species: TreeSpecies, u: number): number {
  const [a, b] = SCALE[species];
  return a + (b - a) * u;
}

/**
 * A per-instance colour multiplier from three uniforms: brightness (0.82 to 1.12), a warm-cool
 * hue shift (yellower or bluer, up to 10%) and saturation (0.85 to 1.15). Vertex colours multiply it.
 */
export function treeTint(u1: number, u2: number, u3: number, out: THREE.Color): THREE.Color {
  const b = 0.82 + u1 * 0.3;
  const warm = (u2 - 0.5) * 0.2;
  const sat = 0.85 + u3 * 0.3;
  let r = 1 + warm;
  let g = 1 + warm * 0.25;
  let bl = 1 - warm;
  const mean = (r + g + bl) / 3;
  r = mean + (r - mean) * sat;
  g = mean + (g - mean) * sat;
  bl = mean + (bl - mean) * sat;
  return out.setRGB(r * b, g * b, bl * b);
}

// ---------------------------------------------------------------- LOD ----

export const LOD_NEAR = 400; // metres: a tile closer than this draws the detailed trees
export const LOD_HYSTERESIS = 40; // ...and keeps them until it is this much further away

/** Near or far geometry for a tile `dist` metres from the rider; `prev` is what it has now. Low never goes near. */
export function chooseLod(prev: TreeLod, dist: number, nearAllowed: boolean): TreeLod {
  if (!nearAllowed) return 'far';
  if (prev === 'near') return dist > LOD_NEAR + LOD_HYSTERESIS ? 'far' : 'near';
  return dist < LOD_NEAR ? 'near' : 'far';
}

// ----------------------------------------------------------- geometry ----

type Vec = [number, number, number];
type Paint = (p: Vec, out: THREE.Color) => void;

const col = (hex: string) => new THREE.Color(hex);

/** Flat-shaded triangles with colour from a paint function, wound to face away from a reference point inside the shape. */
class Builder {
  private readonly p: number[] = [];
  private readonly c: number[] = [];
  private readonly tmp = new THREE.Color();
  constructor(readonly rand: () => number) {}

  tri(a: Vec, b: Vec, c: Vec, ref: Vec, paint: Paint) {
    let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const gx = (a[0] + b[0] + c[0]) / 3;
    const gy = (a[1] + b[1] + c[1]) / 3;
    const gz = (a[2] + b[2] + c[2]) / 3;
    if (nx * (gx - ref[0]) + ny * (gy - ref[1]) + nz * (gz - ref[2]) < 0) {
      [b, c] = [c, b];
      nx = -nx; ny = -ny; nz = -nz;
    }
    const len = Math.hypot(nx, ny, nz) || 1;
    const light = 0.9 + 0.16 * (ny / len) + (this.rand() - 0.5) * 0.07; // up-facing faces catch more light
    for (const v of [a, b, c]) {
      paint(v, this.tmp);
      this.p.push(v[0], v[1], v[2]);
      this.c.push(this.tmp.r * light, this.tmp.g * light, this.tmp.b * light);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** Foliage colour: dark low and inside, light high and at the tips. */
function foliage(dark: string, light: string, y0: number, y1: number, radius: number): Paint {
  const d = col(dark);
  const l = col(light);
  return (p, out) => {
    const t = smoothstep(y0, y1, p[1]) * 0.7 + Math.min(1, Math.hypot(p[0], p[2]) / radius) * 0.3;
    out.copy(d).lerp(l, t);
  };
}

/** Bark: a base colour darkening towards the ground, optionally banded (birch). */
function bark(top: string, bottom: string, height: number, band?: { color: string; every: number }): Paint {
  const t = col(top);
  const b = col(bottom);
  const k = band ? col(band.color) : null;
  return (p, out) => {
    out.copy(b).lerp(t, Math.min(1, p[1] / height));
    if (k && band && Math.floor(p[1] / band.every) % 2 === 1) out.lerp(k, 0.7);
  };
}

/** A tapering tube from (x, y0, z) to (x + lean, y1, z), `sides` sides, open at both ends (the ground and the crown hide them). */
function trunk(b: Builder, x: number, z: number, y0: number, y1: number, r0: number, r1: number, sides: number, paint: Paint, lean = 0, segments = 1) {
  const ring = (y: number, r: number, k: number): Vec => {
    const a = (k / sides) * Math.PI * 2 + 0.4;
    const off = ((y - y0) / (y1 - y0)) * lean;
    return [x + off + Math.cos(a) * r, y, z + Math.sin(a) * r];
  };
  for (let s = 0; s < segments; s++) {
    const ya = y0 + ((y1 - y0) * s) / segments;
    const yb = y0 + ((y1 - y0) * (s + 1)) / segments;
    const ra = r0 + (r1 - r0) * (s / segments);
    const rb = r0 + (r1 - r0) * ((s + 1) / segments);
    const ref: Vec = [x + ((ya + yb) / 2 - y0) / (y1 - y0) * lean, (ya + yb) / 2, z];
    for (let k = 0; k < sides; k++) {
      const a0 = ring(ya, ra, k), a1 = ring(ya, ra, k + 1), b0 = ring(yb, rb, k), b1 = ring(yb, rb, k + 1);
      b.tri(a0, a1, b1, ref, paint);
      b.tri(a0, b1, b0, ref, paint);
    }
  }
}

// Icosahedron (20 faces) and octahedron (8 faces): the two lump shapes.
const PHI = (1 + Math.sqrt(5)) / 2;
const ICO_V: Vec[] = [[-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0], [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI], [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1]]
  .map(([x, y, z]) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l] as Vec; });
const ICO_F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
const OCT_V: Vec[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const OCT_F = [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [4, 3, 0], [1, 3, 4], [5, 3, 1], [0, 3, 5]];

/** A lumpy ellipsoid of foliage centred at (cx, cy, cz): 20 triangles ('ico') or 8 ('octa'), vertices pushed in and out by `rough`. */
function lump(b: Builder, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, shape: 'ico' | 'octa', paint: Paint, rough = 0.16) {
  const verts = shape === 'ico' ? ICO_V : OCT_V;
  const faces = shape === 'ico' ? ICO_F : OCT_F;
  const yaw = b.rand() * Math.PI * 2;
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  const v: Vec[] = verts.map(([x, y, z]) => {
    const j = 1 + (b.rand() - 0.5) * 2 * rough;
    const rx2 = x * cs - z * sn;
    const rz2 = x * sn + z * cs;
    return [cx + rx2 * rx * j, cy + y * ry * j, cz + rz2 * rz * j];
  });
  const ref: Vec = [cx, cy, cz];
  for (const [i, j, k] of faces) b.tri(v[i], v[j], v[k], ref, paint);
}

interface ConiferShape {
  tiers: number;
  base: number; // y of the lowest tier's base
  step: number; // rise from tier to tier
  tierHeight: number;
  radius: number; // of the lowest tier
  taper: number; // how much narrower the top tier is than the lowest (0 to 1)
  droop: number; // how far the branch tips hang below the tier's base, as a share of its radius
  points: number; // branch points round the lowest tier (the top ones have one fewer)
  trunkTop: number;
  trunkR: number;
}

/** Stacked star-shaped cones: the jagged, drooping tiers of a spruce or a larch. */
function conifer(b: Builder, s: ConiferShape, paint: Paint, barkPaint: Paint, trunkSides: number) {
  trunk(b, 0, 0, 0, s.trunkTop, s.trunkR, s.trunkR * 0.7, trunkSides, barkPaint);
  for (let k = 0; k < s.tiers; k++) {
    const f = s.tiers > 1 ? k / (s.tiers - 1) : 0;
    const r = s.radius * (1 - s.taper * f);
    const y = s.base + s.step * k;
    const m = k < s.tiers / 2 ? s.points : Math.max(3, s.points - 1);
    const apex: Vec = [0, y + s.tierHeight, 0];
    const ring: Vec[] = [];
    const turn = b.rand() * 6.28;
    for (let i = 0; i < m * 2; i++) {
      const outer = i % 2 === 0;
      const a = turn + (i / (m * 2)) * Math.PI * 2 + (b.rand() - 0.5) * 0.25;
      const rr = outer ? r * (0.88 + b.rand() * 0.24) : r * 0.5;
      ring.push([Math.cos(a) * rr, outer ? y - r * s.droop : y + s.tierHeight * 0.05, Math.sin(a) * rr]);
    }
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      b.tri(apex, p, q, [0, (apex[1] + p[1] + q[1]) / 3, 0], paint);
      if (k === 0) b.tri([0, y + 0.05, 0], p, q, [0, y + 1, 0], paint); // the underside, so a rider below sees no sky through the tree
    }
  }
}

const SPRUCE_NEAR: ConiferShape = { tiers: 7, base: 1.5, step: 1.1, tierHeight: 2.4, radius: 2.4, taper: 0.85, droop: 0.2, points: 5, trunkTop: 2.4, trunkR: 0.3 };
const SPRUCE_FAR: ConiferShape = { tiers: 3, base: 1.5, step: 2.7, tierHeight: 4.2, radius: 2.4, taper: 0.7, droop: 0.2, points: 4, trunkTop: 2.4, trunkR: 0.3 };
const LARCH_NEAR: ConiferShape = { tiers: 5, base: 1.8, step: 1.7, tierHeight: 3.0, radius: 2.1, taper: 0.85, droop: 0.3, points: 5, trunkTop: 2.8, trunkR: 0.28 };
const LARCH_FAR: ConiferShape = { tiers: 3, base: 1.8, step: 2.8, tierHeight: 4.2, radius: 2.1, taper: 0.7, droop: 0.3, points: 4, trunkTop: 2.8, trunkR: 0.28 };

type Lump = [number, number, number, number, number, number, ('ico' | 'octa')?];

function crown(b: Builder, lumps: Lump[], paint: Paint, rough?: number) {
  for (const [x, y, z, rx, ry, rz, shape] of lumps) lump(b, x, y, z, rx, ry, rz, shape ?? 'ico', paint, rough);
}

/** Builds one species at one level of detail. */
function buildSpecies(species: TreeSpecies, lod: TreeLod): THREE.BufferGeometry {
  const near = lod === 'near';
  const b = new Builder(rng(TREE_SPECIES.indexOf(species) * 7919 + (near ? 1 : 2)));
  const ts = near ? 6 : 4; // trunk sides
  switch (species) {
    case 'spruce':
      conifer(b, near ? SPRUCE_NEAR : SPRUCE_FAR, foliage('#1c4230', '#3f7d4a', 1.5, 10.5, 2.5), bark('#5a3f2c', '#3e2b1e', 2.4), near ? 5 : 3);
      break;
    case 'larch':
      conifer(b, near ? LARCH_NEAR : LARCH_FAR, foliage('#4a7a36', '#97bb4e', 1.8, 10.5, 2.2), bark('#7a5a3e', '#4d3727', 2.8), near ? 5 : 3);
      break;
    case 'pine': {
      // Ponderosa and lodgepole: a tall bare orange-brown trunk, a clumped irregular crown of flat tufts.
      trunk(b, 0, 0, 0, near ? 8.4 : 9.2, 0.32, 0.16, ts, bark('#8d5b38', '#59392a', 9), 0.25);
      const f = foliage('#2c5732', '#5f8c3e', 6.5, 12, 2.2);
      crown(b, near
        ? [[0.2, 9.8, 0, 1.9, 1.0, 1.9], [1.6, 8.3, 0.6, 1.7, 0.9, 1.5], [-1.3, 7.5, -0.9, 1.5, 0.8, 1.4], [0.4, 11.3, -0.2, 1.1, 0.9, 1.1]]
        : [[0.3, 9.6, 0, 2.4, 1.4, 2.2, 'octa'], [0.4, 11.4, 0, 1.3, 1.2, 1.3, 'octa'], [-1.4, 7.9, -0.6, 1.7, 1.0, 1.6, 'octa']], f, 0.2);
      break;
    }
    case 'oak':
      trunk(b, 0, 0, 0, 2.8, 0.46, 0.3, ts, bark('#5e4533', '#3f2e22', 2.8));
      crown(b, near
        ? [[0, 5.6, 0, 3.4, 2.4, 3.4], [2.2, 4.6, 0.8, 2.4, 1.9, 2.3], [-2.1, 4.8, -0.7, 2.5, 2.0, 2.4], [0.4, 6.8, -1.6, 2.2, 1.8, 2.0], [-0.6, 4.2, 2.2, 2.0, 1.6, 1.9]]
        : [[0, 5.5, 0, 3.6, 2.6, 3.6], [2.3, 4.5, 0.8, 2.5, 1.9, 2.3, 'octa'], [-2.2, 4.6, -0.6, 2.5, 2.0, 2.3, 'octa']],
      foliage('#2c5726', '#66a041', 2.5, 8, 3.8), 0.2);
      break;
    case 'beech':
      trunk(b, 0, 0, 0, 2.6, 0.3, 0.22, near ? 5 : 4, bark('#6c5444', '#473429', 2.6));
      crown(b, near
        ? [[0, 5.2, 0, 2.7, 2.7, 2.7], [1.2, 6.4, 0.4, 1.9, 1.8, 1.9], [-1.3, 4.4, 0.9, 1.9, 1.7, 1.9], [0.1, 3.9, -1.2, 1.7, 1.5, 1.7]]
        : [[0, 5.2, 0, 2.9, 2.9, 2.9], [0.8, 6.8, 0.3, 1.7, 1.5, 1.7, 'octa']],
      foliage('#386a2b', '#80b24d', 2.4, 8, 3), 0.14);
      break;
    case 'aspen':
      // Pale trunk with dark bands, a slim crown of light green: summer, not gold.
      trunk(b, 0, 0, 0, 4.8, 0.22, 0.12, near ? 5 : 4, bark('#dcd6c6', '#bdb6a2', 4.8, near ? { color: '#4a4943', every: 0.9 } : undefined), 0.1, near ? 3 : 1);
      crown(b, near
        ? [[0, 6.7, 0, 1.5, 2.6, 1.5], [0.5, 4.9, 0.3, 1.3, 1.6, 1.3], [-0.5, 8.1, -0.2, 1.0, 1.5, 1.0]]
        : [[0, 6.6, 0, 1.6, 3.3, 1.6], [0, 9.2, 0, 0.9, 1.2, 0.9, 'octa']],
      foliage('#5b9340', '#a6d05f', 3.5, 9.5, 1.6), 0.14);
      break;
    case 'cottonwood':
      trunk(b, 0, 0, 0, 3.6, 0.52, 0.34, ts, bark('#76634f', '#4c3d30', 3.6), 0.3);
      crown(b, near
        ? [[0, 7.2, 0, 3.8, 3.0, 3.8], [2.8, 6.0, 1.2, 2.8, 2.4, 2.6], [-2.9, 6.2, -0.8, 2.8, 2.5, 2.6], [0.6, 9.0, -1.4, 2.6, 2.2, 2.4], [-0.8, 5.6, 2.9, 2.5, 2.1, 2.4], [1.0, 5.2, -2.7, 2.4, 2.0, 2.3]]
        : [[0, 7.0, 0, 4.0, 3.2, 4.0], [2.8, 6.0, 1.2, 2.8, 2.4, 2.6, 'octa'], [-2.9, 6.2, -0.8, 2.8, 2.5, 2.6, 'octa']],
      foliage('#3b682b', '#7bac40', 3.5, 11, 4.2), 0.18);
      break;
    case 'juniper':
      // Juniper and pinyon: squat, dark grey-green, a short trunk (the desert's tree).
      trunk(b, 0, 0, 0, 1.3, 0.2, 0.14, near ? 5 : 4, bark('#6f4e36', '#4c3425', 1.3));
      crown(b, near
        ? [[0, 2.4, 0, 1.7, 1.5, 1.7], [1.0, 1.8, 0.5, 1.1, 1.0, 1.1], [-0.9, 1.9, -0.5, 1.1, 1.1, 1.0]]
        : [[0, 2.3, 0, 1.8, 1.6, 1.8], [0.9, 1.9, 0.4, 1.2, 1.0, 1.1, 'octa']],
      foliage('#3d583f', '#70895a', 1.0, 4, 1.8), 0.18);
      break;
    case 'shrub':
      // Low bush clumps; also the stunted growth near the tree line.
      crown(b, near
        ? [[0, 0.55, 0, 1.0, 0.7, 1.0], [0.8, 0.4, 0.4, 0.7, 0.5, 0.7], [-0.7, 0.4, -0.3, 0.7, 0.5, 0.7]]
        : [[0, 0.55, 0, 1.1, 0.7, 1.1], [0.7, 0.4, 0.3, 0.8, 0.5, 0.8, 'octa']],
      foliage('#436a2f', '#82a046', 0, 1.2, 1.2), 0.2);
      break;
  }
  return b.build();
}

// ----------------------------------------------------------- material ----

/** Adds wind sway to a tree material or its shadow depth material: each vertex leans by afSway() for its height above the tree's base. */
function patchSway(shader: { uniforms: Record<string, THREE.IUniform>; vertexShader: string }) {
  Object.assign(shader.uniforms, SWAY_UNIFORMS);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${SWAY_GLSL}`)
    .replace('#include <project_vertex>', /* glsl */ `
vec4 mvPosition = vec4( transformed, 1.0 );
float afHeight = transformed.y;
vec3 afBase = modelMatrix[3].xyz;
#ifdef USE_INSTANCING
  afHeight *= length( instanceMatrix[1].xyz );
  afBase = ( modelMatrix * vec4( instanceMatrix[3].xyz, 1.0 ) ).xyz;
  mvPosition = instanceMatrix * mvPosition;
#endif
// The phase comes from the tree's base so a crown moves as one; the bend from the vertex's height.
mvPosition.xyz += afSway( afBase, max( afHeight, 0.0 ), 1.0 );
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`);
}

/**
 * The trees' geometry (built on first use), their one material and its shadow twin. Every tile of
 * every species shares these, so nothing recompiles per tile.
 */
export class TreeKit {
  readonly material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
  readonly depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  private readonly geos = new Map<string, THREE.BufferGeometry>();

  constructor() {
    this.material.onBeforeCompile = patchSway;
    this.material.customProgramCacheKey = () => 'afTreeSway';
    this.depthMaterial.onBeforeCompile = patchSway;
    this.depthMaterial.customProgramCacheKey = () => 'afTreeSwayDepth';
  }

  geometry(species: TreeSpecies, lod: TreeLod): THREE.BufferGeometry {
    const key = `${species}/${lod}`;
    let g = this.geos.get(key);
    if (!g) {
      g = buildSpecies(species, lod);
      this.geos.set(key, g);
    }
    return g;
  }

  /** Rain: the trees darken a little. */
  setWet(wet: number) {
    this.material.color.setScalar(1 - 0.16 * wet);
  }

  dispose() {
    for (const g of this.geos.values()) g.dispose();
    this.geos.clear();
    this.material.dispose();
    this.depthMaterial.dispose();
  }
}

/** Which of a cell's trees share a species: 60% of the trees in a 45 m square take the cell's own roll, so stands of one kind form. */
export function standRoll(x: number, z: number, own: number, other: number): number {
  return own < 0.6 ? hash2(Math.floor(x / 45), Math.floor(z / 45)) : other;
}
