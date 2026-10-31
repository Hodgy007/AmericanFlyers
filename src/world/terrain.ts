import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { currentStage, elevationAt, ROAD_ORIGIN, ROAD_STEP, roadX, roadZ } from '../course';
import { nearLandmark } from './landmarks';
import { fbm, rng, smoothstep } from './noise';

// Terrain is built in square tiles around the rider. Every vertex height is a
// pure function of its world position (plus the road), so neighbouring tiles
// always line up without seams.

const TILE = 200; // metres
const SEG = 50; // 4 m grid
const RANGE = 1150; // build tiles whose centre is within this distance
const ROAD_INFLUENCE = 260; // beyond this the road no longer shapes the land
const COARSE = 5; // coarse nearest-road search stride, in samples (10 m)
const GRASS_TILE_M = 7; // grass texture repeats every 7 m

interface Near {
  dist: number; // metres from the road centreline
  d: number; // course distance of the closest road point
  /** Closest point on a different stretch of road (e.g. the next hairpin straight up). */
  other?: { dist: number; d: number };
}

const SECTION_GAP = 120; // road points this far apart along the course count as different stretches

// ------------------------------------------------------------ height ----

/**
 * Ground height: the road's own elevation in a valley along it, blending out
 * to the stage's wild terrain. Between two stretches of road (stacked
 * hairpins) the road level is blended between them, giving a smooth slope.
 */
export function heightAt(x: number, z: number, near: Near | null): number {
  const { wildHeight, bumpAmp } = currentStage().scenery;
  const bumps = fbm(x / 70, z / 70, 3) * bumpAmp;
  if (!near || near.dist >= ROAD_INFLUENCE) return wildHeight(x, z) + bumps;
  let road = elevationAt(near.d);
  if (near.other) {
    const wa = 1 / (near.dist + 1) ** 4;
    const wb = 1 / (near.other.dist + 1) ** 4;
    road = (road * wa + elevationAt(near.other.d) * wb) / (wa + wb);
  }
  road -= 0.15;
  const w = smoothstep(9, ROAD_INFLUENCE, near.dist);
  return road * (1 - w) + wildHeight(x, z) * w + bumps * smoothstep(9, 45, near.dist);
}

/** Road samples that could be the nearest road point to anything in the box. */
function candidatesFor(minX: number, maxX: number, minZ: number, maxZ: number): number[] {
  const m = ROAD_INFLUENCE + COARSE * ROAD_STEP * 2;
  const out: number[] = [];
  for (let i = 0; i < roadX.length; i += COARSE) {
    const x = roadX[i];
    const z = roadZ[i];
    if (x > minX - m && x < maxX + m && z > minZ - m && z < maxZ + m) out.push(i);
  }
  return out;
}

function nearestRoad(cands: number[], x: number, z: number): Near | null {
  let best = -1;
  let bestD2 = Infinity;
  for (const i of cands) {
    const dx = roadX[i] - x;
    const dz = roadZ[i] - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) { bestD2 = d2; best = i; }
  }
  const limit = ROAD_INFLUENCE + COARSE * ROAD_STEP;
  if (best < 0 || bestD2 > limit * limit) return null;
  const near = refine(best, bestD2, x, z);

  // Second-closest stretch of road, at least SECTION_GAP along the course away.
  let second = -1;
  let secondD2 = Infinity;
  const gap = SECTION_GAP / ROAD_STEP;
  for (const i of cands) {
    if (Math.abs(i - best) < gap) continue;
    const dx = roadX[i] - x;
    const dz = roadZ[i] - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < secondD2) { secondD2 = d2; second = i; }
  }
  if (second >= 0 && secondD2 < limit * limit) near.other = refine(second, secondD2, x, z);
  return near;
}

/** Refines a coarse nearest sample to the exact closest point on the centreline. */
function refine(best: number, bestD2: number, x: number, z: number): Near {
  let bi = best;
  for (let i = Math.max(0, best - COARSE); i <= Math.min(roadX.length - 1, best + COARSE); i++) {
    const dx = roadX[i] - x;
    const dz = roadZ[i] - z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) { bestD2 = d2; bi = i; }
  }
  let dist2 = bestD2;
  let d = ROAD_ORIGIN + bi * ROAD_STEP;
  for (const j of [bi - 1, bi]) {
    if (j < 0 || j + 1 >= roadX.length) continue;
    const ax = roadX[j], az = roadZ[j];
    const vx = roadX[j + 1] - ax, vz = roadZ[j + 1] - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
    const px = ax + vx * t - x, pz = az + vz * t - z;
    const p2 = px * px + pz * pz;
    if (p2 < dist2) { dist2 = p2; d = ROAD_ORIGIN + (j + t) * ROAD_STEP; }
  }
  return { dist: Math.sqrt(dist2), d };
}

// ------------------------------------------------------------ colour ----

const COL = {
  verge: new THREE.Color('#8f8a63'),
  grassA: new THREE.Color('#3f7d35'),
  grassB: new THREE.Color('#77a843'),
  field: new THREE.Color('#c2b75a'),
  rock: new THREE.Color('#878274'),
  snow: new THREE.Color('#f1f4f8'),
  // Red-rock desert (Stage.scenery.palette = 'desert'): layered sandstone, pale sand, grey-green sage.
  strataA: new THREE.Color('#b4532f'),
  strataB: new THREE.Color('#cf7a47'),
  strataC: new THREE.Color('#e0a06a'),
  strataD: new THREE.Color('#8f3b25'),
  sand: new THREE.Color('#dbb98a'),
  sage: new THREE.Color('#8f9568'),
  desertRock: new THREE.Color('#a24a2c'),
};
const tmp = new THREE.Color();

/** Banded red sandstone, sandy flats and the odd patch of sage. */
function desertColor(x: number, z: number, h: number, near: Near | null, out: THREE.Color) {
  const band = h * 0.11 + fbm(x / 160, z / 160, 2) * 0.7; // layers a few metres thick, wobbling a little
  const f = band - Math.floor(band);
  const k = Math.floor(band) & 3;
  const layer = [COL.strataA, COL.strataB, COL.strataC, COL.strataD][k];
  const next = [COL.strataB, COL.strataC, COL.strataD, COL.strataA][k];
  out.copy(layer).lerp(next, smoothstep(0.7, 1, f));
  out.lerp(COL.sand, 0.12 + 0.12 * fbm(x / 90 + 3, z / 90, 2)); // wind-blown sand over the rock
  const sage = fbm(x / 120 - 20, z / 120 + 11, 3);
  if (sage > 0.2) out.lerp(COL.sage, smoothstep(0.2, 0.5, sage) * 0.4);
  if (near && near.dist < 9) out.lerp(COL.verge, 1 - smoothstep(6, 9, near.dist));
}

function groundColor(x: number, z: number, h: number, near: Near | null, out: THREE.Color) {
  const sc = currentStage().scenery;
  if (sc.palette === 'desert') return desertColor(x, z, h, near, out);
  out.copy(COL.grassA).lerp(COL.grassB, fbm(x / 140, z / 140, 3) * 0.5 + 0.5);
  const fields = fbm(x / 380 + 9, z / 380, 2);
  if (sc.fields && fields > 0.28) out.lerp(COL.field, smoothstep(0.28, 0.4, fields) * 0.8);
  const band = Math.max(14, (sc.snowLine - sc.rockLine) * 0.4);
  const rockLine = sc.rockLine + fbm(x / 60, z / 60, 2) * band;
  if (h > rockLine) out.lerp(COL.rock, smoothstep(rockLine, rockLine + band, h));
  const snowLine = sc.snowLine + fbm(x / 90 + 5, z / 90, 2) * band;
  if (h > snowLine) out.lerp(COL.snow, smoothstep(snowLine, snowLine + band * 0.6, h));
  if (near && near.dist < 9) out.lerp(COL.verge, 1 - smoothstep(6, 9, near.dist));
}

/** Darkens steep grass and turns cliffs to rock, using the tile's own height grid. */
function shadeSlopes(pos: THREE.BufferAttribute, colors: Float32Array) {
  const rock = currentStage().scenery.palette === 'desert' ? COL.desertRock : COL.rock;
  const n = SEG + 1;
  const step = TILE / SEG;
  const h = (ix: number, iz: number) => pos.getY(Math.min(n - 1, Math.max(0, iz)) * n + Math.min(n - 1, Math.max(0, ix)));
  const c = new THREE.Color();
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const gx = (h(ix + 1, iz) - h(ix - 1, iz)) / (2 * step);
      const gz = (h(ix, iz + 1) - h(ix, iz - 1)) / (2 * step);
      const slope = Math.hypot(gx, gz);
      if (slope < 0.35) continue;
      const i = (iz * n + ix) * 3;
      c.setRGB(colors[i], colors[i + 1], colors[i + 2]);
      c.multiplyScalar(1 - 0.25 * smoothstep(0.35, 0.8, slope)); // shadier, rougher grass
      c.lerp(rock, smoothstep(0.75, 1.1, slope)); // bare rock on cliffs
      colors.set([c.r, c.g, c.b], i);
    }
  }
}

// ------------------------------------------------------------- trees ----

function painted(geo: THREE.BufferGeometry, color: string): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const arr = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) { arr[i] = c.r; arr[i + 1] = c.g; arr[i + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

function makeConifer() {
  return mergeGeometries([
    painted(new THREE.CylinderGeometry(0.22, 0.32, 2.4, 6).translate(0, 1.2, 0), '#5a3d2b'),
    painted(new THREE.ConeGeometry(2.5, 5, 7).translate(0, 4.4, 0), '#2e6b3a'),
    painted(new THREE.ConeGeometry(1.8, 4, 7).translate(0, 7.1, 0), '#367a42'),
  ])!;
}

function makeBroadleaf() {
  return mergeGeometries([
    painted(new THREE.CylinderGeometry(0.28, 0.38, 3, 6).translate(0, 1.5, 0), '#5f4330'),
    painted(new THREE.IcosahedronGeometry(2.7, 0).scale(1, 0.85, 1).translate(0, 5, 0), '#4f9645'),
    painted(new THREE.IcosahedronGeometry(1.8, 0).translate(1.1, 6.1, 0.7), '#5aa64c'),
  ])!;
}

/** A juniper: a squat, dark grey-green tree with a short trunk, for the red-rock desert. */
function makeJuniper() {
  return mergeGeometries([
    painted(new THREE.CylinderGeometry(0.16, 0.26, 1.6, 5).translate(0, 0.8, 0), '#6b4a32'),
    painted(new THREE.IcosahedronGeometry(1.6, 0).scale(1, 0.9, 1).translate(0, 2.3, 0), '#55704a'),
    painted(new THREE.IcosahedronGeometry(1.1, 0).translate(0.9, 1.9, 0.5), '#617c52'),
  ])!;
}

// ------------------------------------------------------------- tiles ----

interface Tile {
  group: THREE.Group;
  dispose(): void;
}

export class Terrain {
  readonly group = new THREE.Group();
  private readonly tiles = new Map<string, Tile>();
  private readonly groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });

  constructor(renderer: THREE.WebGLRenderer) {
    // Grass detail, multiplied over the land colours. Stored as plain data (not sRGB)
    // so its ~0.92 average only darkens the colours slightly.
    new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/grass.jpg`, (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = THREE.NoColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      this.groundMat.map = tex;
      this.groundMat.needsUpdate = true;
    });
  }
  private readonly treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
  private readonly conifer = makeConifer();
  private readonly broadleaf = makeBroadleaf();
  private readonly juniper = makeJuniper();

  /** Drops every tile (after a stage change). */
  clear() {
    for (const tile of this.tiles.values()) {
      this.group.remove(tile.group);
      tile.dispose();
    }
    this.tiles.clear();
  }

  /** Builds the closest missing tiles (at most `budget`) and drops far ones. */
  update(x: number, z: number, budget = 2) {
    const needed: { key: string; ix: number; iz: number; d: number }[] = [];
    const r = Math.ceil(RANGE / TILE);
    const cx = Math.floor(x / TILE);
    const cz = Math.floor(z / TILE);
    for (let ix = cx - r; ix <= cx + r; ix++) {
      for (let iz = cz - r; iz <= cz + r; iz++) {
        const d = Math.hypot((ix + 0.5) * TILE - x, (iz + 0.5) * TILE - z);
        if (d <= RANGE) needed.push({ key: `${ix},${iz}`, ix, iz, d });
      }
    }
    needed.sort((a, b) => a.d - b.d);
    for (const n of needed) {
      if (budget <= 0) break;
      if (this.tiles.has(n.key)) continue;
      const tile = this.buildTile(n.ix, n.iz);
      this.tiles.set(n.key, tile);
      this.group.add(tile.group);
      budget--;
    }
    for (const [key, tile] of this.tiles) {
      const [ix, iz] = key.split(',').map(Number);
      if (Math.hypot((ix + 0.5) * TILE - x, (iz + 0.5) * TILE - z) > RANGE + TILE) {
        this.group.remove(tile.group);
        tile.dispose();
        this.tiles.delete(key);
      }
    }
  }

  private buildTile(ix: number, iz: number): Tile {
    const cx = (ix + 0.5) * TILE;
    const cz = (iz + 0.5) * TILE;
    const cands = candidatesFor(cx - TILE / 2, cx + TILE / 2, cz - TILE / 2, cz + TILE / 2);

    const geo = new THREE.PlaneGeometry(TILE, TILE, SEG, SEG).rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const uvs = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + cx;
      const z = pos.getZ(i) + cz;
      const near = nearestRoad(cands, x, z);
      const h = heightAt(x, z, near);
      pos.setY(i, h);
      groundColor(x, z, h, near, tmp);
      colors.set([tmp.r, tmp.g, tmp.b], i * 3);
      uvs.set([x / GRASS_TILE_M, z / GRASS_TILE_M], i * 2); // world-space, so tiles line up
    }
    shadeSlopes(pos, colors);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, this.groundMat);
    ground.receiveShadow = true;

    const group = new THREE.Group();
    group.position.set(cx, 0, cz);
    group.add(ground);

    // Scatter trees: dense in forest patches, the odd lone tree elsewhere.
    const rand = rng(Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663));
    const conifers: THREE.Matrix4[] = [];
    const broadleaves: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const desert = currentStage().scenery.palette === 'desert';
    const junipers: THREE.Matrix4[] = [];
    for (let n = 0; n < (desert ? 70 : 260); n++) {
      const lx = (rand() - 0.5) * TILE;
      const lz = (rand() - 0.5) * TILE;
      const x = lx + cx;
      const z = lz + cz;
      const forest = fbm(x / 240 - 13, z / 240 + 5, 3);
      const keep = rand();
      if (desert ? forest < 0.0 && keep > 0.08 : forest < 0.05 - currentStage().scenery.forestCover && keep > 0.06) continue;
      const near = nearestRoad(cands, x, z);
      if (near && (near.dist < 12 || nearLandmark(x, z, near.d))) continue;
      const h = heightAt(x, z, near);
      const sc = currentStage().scenery;
      if (h > sc.treeLine + forest * 40) continue; // tree line
      const s = 0.75 + rand() * 0.7;
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(lx, h - 0.3, lz), q, new THREE.Vector3(s, s * (0.85 + rand() * 0.35), s));
      (desert ? junipers : rand() < sc.coniferBias || forest > 0.3 ? conifers : broadleaves).push(m);
    }
    const meshes = [this.instanced(this.conifer, conifers, rand), this.instanced(this.broadleaf, broadleaves, rand), this.instanced(this.juniper, junipers, rand)];
    for (const m of meshes) if (m) group.add(m);

    return {
      group,
      dispose: () => {
        geo.dispose();
        for (const m of meshes) m?.dispose();
      },
    };
  }

  private instanced(geo: THREE.BufferGeometry, mats: THREE.Matrix4[], rand: () => number) {
    if (!mats.length) return null;
    const mesh = new THREE.InstancedMesh(geo, this.treeMat, mats.length);
    const c = new THREE.Color();
    mats.forEach((m, i) => {
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.setScalar(0.8 + rand() * 0.35));
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    return mesh;
  }
}
