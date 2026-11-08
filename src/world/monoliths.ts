import * as THREE from 'three';
import { currentStage, roadPoint } from '../course';
import { hash2, valueNoise } from './noise';
import { groundSampler } from './terrain';

// Freestanding sandstone monoliths standing on the canyon floors of the Tour of the Moon:
// Independence Monument (a tall tapering tower), the Coke Ovens (a row of rounded domes) and the
// Kissing Couple (two pillars leaning together). Each is one flat-shaded mesh with banded
// vertex colours, built in code (a lathe of rings with ledges and a talus skirt), under 5,000
// triangles, shared by every placement of its kind. Placed from the road's frame (course
// distance and lateral offset), deterministic, built when the rider comes within range.

export type MonolithKind = 'independence' | 'coke' | 'kissing';

export interface Placement {
  kind: MonolithKind;
  d: number; // course distance of the point on the road it stands opposite
  lateral: number; // metres right (+) or left (-) of the centreline
  scale?: number;
  /** Turn from running parallel to the road, radians. */
  yaw?: number;
}

/** Monoliths per stage id. */
export const MONOLITHS: Record<string, Placement[]> = {
  'hotw-tour-of-the-moon': [
    { kind: 'independence', d: 8650, lateral: -310 },
    { kind: 'kissing', d: 10250, lateral: 330, yaw: 0.5 },
    { kind: 'coke', d: 12100, lateral: 290 },
    { kind: 'independence', d: 18200, lateral: -270, scale: 0.6, yaw: 1.2 },
    { kind: 'coke', d: 23000, lateral: -300, scale: 0.7, yaw: 0.3 },
    { kind: 'kissing', d: 28000, lateral: -340, scale: 0.8, yaw: -0.6 },
  ],
};

const AHEAD = 2600; // build this far ahead of the rider (the road is generated 3,000 m ahead)
const BEHIND = 1500;

// ---------------------------------------------------------------- geometry ----

const BAND_COLORS = ['#9c4a2b', '#c4693a', '#d98f58', '#e3b98a', '#b05030', '#8a3d26'].map((c) => new THREE.Color(c));
const TALUS = new THREE.Color('#c99a74');

interface Lathe {
  height: number;
  /** Radius at t = 0 (base, before the skirt) .. 1 (top). */
  radius(t: number): number;
  bands: number;
  seed: number;
  segs?: number;
  /** Height of a rounded cap above the top ring (0: the profile closes itself). */
  cap?: number;
  /** Extra radius at the foot as a share of the radius, the talus skirt. */
  skirt?: number;
}

/** A solid of revolution with ledges between its bands, ragged outline and banded colours; flat-shaded when drawn. */
export function lathe(spec: Lathe): THREE.BufferGeometry {
  const segs = spec.segs ?? 20;
  const skirt = spec.skirt ?? 1.2;
  const rings: { y: number; r: number; band: number }[] = [];
  const K = 3;
  rings.push({ y: -5, r: spec.radius(0) * (1 + skirt) * 1.15, band: -1 });
  for (let b = 0; b < spec.bands; b++) {
    const jut = (hash2(b, spec.seed) - 0.5) * 0.09; // each layer a little proud or recessed
    for (let k = 0; k < K; k++) {
      const t = (b + (k / (K - 1)) * 0.94) / spec.bands;
      const foot = 1 - Math.min(1, t / 0.2);
      const r = spec.radius(t) * (1 + jut - 0.05 * (k / (K - 1))) * (1 + skirt * foot * foot);
      rings.push({ y: t * spec.height, r, band: b });
    }
  }
  const topR = rings[rings.length - 1].r;
  const cap = spec.cap ?? 0;
  if (cap > 0) {
    for (let j = 1; j <= 3; j++) {
      const a = (j / 3) * Math.PI * 0.46;
      rings.push({ y: spec.height + cap * Math.sin(a), r: topR * Math.cos(a), band: spec.bands - 1 });
    }
  }
  const apexY = rings[rings.length - 1].y + (cap > 0 ? cap * 0.12 : spec.height * 0.01);

  const ringPoint = (ri: number, s: number, out: THREE.Vector3) => {
    const ring = rings[ri];
    const a = (s / segs) * Math.PI * 2;
    // Ragged outline: broad lumps plus a vertical streak per column, different on every ring a little.
    const lump = 1 + 0.1 * valueNoise(Math.cos(a) * 1.7 + spec.seed, Math.sin(a) * 1.7 + ring.y / 35) + 0.03 * (hash2(s * 13 + spec.seed, ring.band + 3) - 0.5);
    const r = ring.r * lump;
    return out.set(Math.cos(a) * r, ring.y, Math.sin(a) * r);
  };

  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), cc = new THREE.Vector3(), d = new THREE.Vector3();
  const tri = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3, color: THREE.Color, seed: number) => {
    const jitter = 0.9 + 0.16 * hash2(seed, spec.seed + 9);
    c.copy(color).multiplyScalar(jitter);
    for (const v of [p, q, r]) { pos.push(v.x, v.y, v.z); col.push(c.r, c.g, c.b); }
  };
  const bandColor = (band: number, s: number) => {
    const streak = 0.88 + 0.18 * hash2(s * 5 + 1, spec.seed); // desert varnish: darker vertical streaks
    return band < 0 ? TALUS : c2.copy(BAND_COLORS[Math.floor(hash2(band * 3 + 1, spec.seed) * BAND_COLORS.length)]).multiplyScalar(streak);
  };
  const c2 = new THREE.Color();
  for (let ri = 0; ri < rings.length - 1; ri++) {
    // The skirt and the lowest band are pale talus; above, colours follow the bands.
    const low = rings[ri].y < spec.height * 0.12;
    for (let s = 0; s < segs; s++) {
      ringPoint(ri, s, a); ringPoint(ri, s + 1, b); ringPoint(ri + 1, s + 1, cc); ringPoint(ri + 1, s, d);
      const color = bandColor(low ? -1 : rings[ri].band, s);
      tri(a, cc, b, color, ri * 100 + s * 2);
      tri(a, d, cc, color, ri * 100 + s * 2 + 1);
    }
  }
  // The top: a fan to the apex.
  const top = rings.length - 1;
  const apex = new THREE.Vector3(0, apexY, 0);
  for (let s = 0; s < segs; s++) {
    ringPoint(top, s, a); ringPoint(top, s + 1, b);
    tri(a, apex, b, bandColor(rings[top].band, s), 9000 + s);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

const smooth01 = (t: number) => t * t * (3 - 2 * t);

/** A tall tower tapering from `r0` at the foot to `r1` at the top, with a rounded cap. */
function tower(height: number, r0: number, r1: number, seed: number, lean = 0, segs = 20) {
  const g = lathe({ height, radius: (t) => r0 + (r1 - r0) * smooth01(t) * 0.7 + (r1 - r0) * 0.3 * t, bands: 8, seed, segs, cap: r1 * 0.5 });
  if (lean) {
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) + lean * Math.pow(Math.max(0, p.getY(i)) / height, 1.4));
    g.computeVertexNormals();
  }
  return g;
}

/** Independence Monument: a ~140 m tower, slightly tapering, layered, with a capped top. */
export function independenceGeometry(): THREE.BufferGeometry {
  return tower(140, 21, 14, 11);
}

/** The Kissing Couple: two pillars leaning together until their tops touch. */
export function kissingGeometry(): THREE.BufferGeometry {
  const a = tower(95, 13, 8, 23, 9).translate(-15, 0, 0);
  const b = tower(80, 12, 7.5, 37, -9).translate(15, 0, 0);
  return merge([a, b]);
}

/** The Coke Ovens: a row of four beehive domes. */
export function cokeGeometry(): THREE.BufferGeometry {
  const dome = (h: number, r: number, seed: number, x: number, z: number) =>
    lathe({ height: h, radius: (t) => r * Math.sqrt(Math.max(0.0, 1 - Math.pow(t, 2.4))) + 0.5, bands: 6, seed, segs: 22, skirt: 0.5 }).translate(x, 0, z);
  return merge([dome(58, 40, 5, -90, 4), dome(74, 48, 17, -12, -6), dome(64, 42, 29, 70, 8), dome(50, 34, 41, 140, -3)]);
}

function merge(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const n = list.reduce((s, g) => s + g.attributes.position.count, 0);
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let at = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, at * 3);
    col.set(g.attributes.color.array, at * 3);
    at += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeVertexNormals();
  return out;
}

const BUILDERS: Record<MonolithKind, () => THREE.BufferGeometry> = { independence: independenceGeometry, coke: cokeGeometry, kissing: kissingGeometry };

/** Triangles in one monolith of this kind. */
export function triangleCount(kind: MonolithKind): number {
  const g = BUILDERS[kind]();
  const n = g.attributes.position.count / 3;
  g.dispose();
  return n;
}

// --------------------------------------------------------------- placement ----

/** Where a placement stands: x, z in the world, and the yaw that runs its long axis along the road. */
export function siteOf(p: Placement) {
  const r = roadPoint(p.d);
  return {
    x: r.x - Math.sin(r.heading) * p.lateral,
    z: r.z + Math.cos(r.heading) * p.lateral,
    yaw: -r.heading + (p.yaw ?? 0),
  };
}

export class Monoliths {
  readonly group = new THREE.Group();
  private readonly placed = new Map<string, THREE.Mesh>();
  private readonly geos = new Map<MonolithKind, THREE.BufferGeometry>();
  private readonly mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
  private shadows = false;

  /** Shadows on High and Ultra only. (The shadow box is 60 m wide, so only a monolith beside the rider is ever in it.) */
  setShadows(on: boolean) {
    this.shadows = on;
    for (const m of this.placed.values()) m.castShadow = m.receiveShadow = on;
  }

  /** Rain darkens the rock with the ground. */
  setWet(wet: number) {
    this.mat.color.setScalar(1 - 0.24 * wet);
    this.mat.roughness = 0.95 - 0.2 * wet;
  }

  /** Builds the monoliths within reach of the rider's distance and drops those left behind. */
  update(distance: number) {
    const list = MONOLITHS[currentStage().id] ?? [];
    list.forEach((p, i) => {
      const key = String(i);
      const near = p.d > distance - BEHIND && p.d < distance + AHEAD;
      const mesh = this.placed.get(key);
      if (!near) {
        if (mesh) { this.group.remove(mesh); this.placed.delete(key); }
        return;
      }
      if (mesh) return;
      const { x, z, yaw } = siteOf(p);
      const y = groundSampler(x - 20, x + 20, z - 20, z + 20)(x, z);
      let geo = this.geos.get(p.kind);
      if (!geo) { geo = BUILDERS[p.kind](); this.geos.set(p.kind, geo); }
      const m = new THREE.Mesh(geo, this.mat);
      m.position.set(x, y, z);
      m.rotation.y = yaw;
      m.scale.setScalar(p.scale ?? 1);
      m.castShadow = m.receiveShadow = this.shadows;
      this.placed.set(key, m);
      this.group.add(m);
    });
  }

  /** Removes everything placed (after a stage change). */
  clear() {
    for (const m of this.placed.values()) this.group.remove(m);
    this.placed.clear();
  }

  dispose() {
    this.clear();
    for (const g of this.geos.values()) g.dispose();
    this.geos.clear();
    this.mat.dispose();
  }
}
