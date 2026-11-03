import * as THREE from 'three';
import { currentStage, elevationAt, ROAD_ORIGIN, ROAD_STEP, roadX, roadZ } from '../course';
import { nearLandmark } from './landmarks';
import { fbm, rng, smoothstep } from './noise';
import { REACH } from './canyon';
import type { Scenery } from '../stages';
import { TREE_SPECIES, TreeKit, chooseLod, defaultMix, loneTreeShare, pickSpecies, standRoll, treeLineRule, treeScale, treeTint, type TreeLod, type TreeSpecies } from './trees';
import type { GroundTextures } from './ground'; // the splatting shader and textures are their own chunk (ground.ts), loaded after the first frame
import { LAYER, LAYER_COUNT, type SceneryTier } from './scenery';

// Terrain is built in square tiles around the rider. Every vertex height is a
// pure function of its world position (plus the road), so neighbouring tiles
// always line up without seams.

const TILE = 200; // metres
const SEG = 50; // 4 m grid
const RANGE = 1150; // build tiles whose centre is within this distance
const ROAD_INFLUENCE = 260; // beyond this the road no longer shapes the land
const CLIFF_SLOPE = 0.6; // steeper than this (about 31 degrees) nothing grows
const COARSE = 5; // coarse nearest-road search stride, in samples (10 m)

export interface Near {
  dist: number; // metres from the road centreline
  d: number; // course distance of the closest road point
  /** Metres right (+) or left (-) of the centreline; the roadside hook (canyons) needs the side. Left out by callers who only know a distance. */
  lateral?: number;
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
  const sc = currentStage().scenery;
  const bumps = fbm(x / 70, z / 70, 3) * sc.bumpAmp;
  if (!near || near.dist >= reach(sc)) return sc.wildHeight(x, z) + bumps;
  return shapeAt(sc, near, near.lateral, sc.wildHeight(x, z)) + bumps * smoothstep(9, 45, near.dist);
}

/** How far from the road it shapes the land: a stage with canyons beside the road reaches much further. */
const reach = (sc: Scenery) => (sc.roadside ? REACH : ROAD_INFLUENCE);

/** The height with the road's influence and the stage's roadside hook but no small bumps; `lateral` can differ from the point's own (for slopes). */
function shapeAt(sc: Scenery, near: Near, lateral: number | undefined, wild: number): number {
  const dist = lateral === undefined ? near.dist : Math.abs(lateral);
  let road = elevationAt(near.d);
  if (near.other) {
    const wa = 1 / (near.dist + 1) ** 4;
    const wb = 1 / (near.other.dist + 1) ** 4;
    road = (road * wa + elevationAt(near.other.d) * wb) / (wa + wb);
  }
  road -= 0.15;
  const w = smoothstep(9, ROAD_INFLUENCE, dist);
  const plain = road * (1 - w) + wild * w;
  if (sc.roadside && lateral !== undefined) {
    const rel = sc.roadside(near.d, lateral, plain - road);
    if (rel !== null) return road + rel;
  }
  return plain;
}

/**
 * How steep the ground is across the road at a point (rise over run, 0 where the stage has no
 * roadside hook): the 4 m grid and the scatter code can't see a cliff face, this can.
 */
export function roadsideSlope(x: number, z: number, near: Near | null): number {
  const sc = currentStage().scenery;
  if (!sc.roadside || !near || near.lateral === undefined || near.dist >= reach(sc)) return 0;
  const wild = sc.wildHeight(x, z);
  return Math.abs(shapeAt(sc, near, near.lateral + 1.5, wild) - shapeAt(sc, near, near.lateral - 1.5, wild)) / 3;
}

/** Road samples that could be the nearest road point to anything in the box. */
function candidatesFor(minX: number, maxX: number, minZ: number, maxZ: number): number[] {
  const m = reach(currentStage().scenery) + COARSE * ROAD_STEP * 2;
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
  const limit = reach(currentStage().scenery) + COARSE * ROAD_STEP;
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
  let lateral = 0;
  for (const j of [bi - 1, bi]) {
    if (j < 0 || j + 1 >= roadX.length) continue;
    const ax = roadX[j], az = roadZ[j];
    const vx = roadX[j + 1] - ax, vz = roadZ[j + 1] - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
    const px = ax + vx * t - x, pz = az + vz * t - z;
    const p2 = px * px + pz * pz;
    if (p2 <= dist2) {
      dist2 = p2;
      d = ROAD_ORIGIN + (j + t) * ROAD_STEP;
      lateral = (px * vz - pz * vx) / Math.sqrt(vx * vx + vz * vz); // the right-hand component of (point - road point)
    }
  }
  return { dist: Math.sqrt(dist2), d, lateral };
}

/**
 * A height lookup for a box of the world (a road chunk and its roadside), for
 * things stood beside the road: spectators, guardrails. One scan of the road
 * serves every call.
 */
export function groundSampler(minX: number, maxX: number, minZ: number, maxZ: number): (x: number, z: number) => number {
  const cands = candidatesFor(minX, maxX, minZ, maxZ);
  return (x, z) => heightAt(x, z, nearestRoad(cands, x, z));
}

// ------------------------------------------------------------ colour ----

const COL = {
  verge: new THREE.Color('#8f8a63'),
  grassA: new THREE.Color('#3f7d35'),
  grassB: new THREE.Color('#77a843'),
  field: new THREE.Color('#c2b75a'),
  rock: new THREE.Color('#878274'),
  snow: new THREE.Color('#f1f4f8'),
  // Pale limestone scree (Mont Ventoux's summit): warm pale grey, a shade darker where the stones are bigger or in shadow.
  screeA: new THREE.Color('#d8d4cb'),
  screeB: new THREE.Color('#b9b3a6'),
  limestone: new THREE.Color('#aaa496'), // cliffs among the scree are pale limestone too
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

/**
 * What the ground is made of at a point: eight layer weights summing to 1 (see
 * ground.ts: grass, dry grass, dirt, rock, snow, sandstone, sand, scree). It follows
 * the same logic as the colours, so the textures follow each stage's palette.
 */
export type Weights = number[];

/** Banded red sandstone, sandy flats and the odd patch of sage. */
function desertColor(x: number, z: number, h: number, near: Near | null, out: THREE.Color, w: Weights) {
  const band = h * (currentStage().scenery.roadside ? 0.05 : 0.11) + fbm(x / 160, z / 160, 2) * 0.7; // canyon walls: layers of 20 m, which the 4 m grid can show on a cliff // layers a few metres thick, wobbling a little
  const f = band - Math.floor(band);
  const k = Math.floor(band) & 3;
  const layer = [COL.strataA, COL.strataB, COL.strataC, COL.strataD][k];
  const next = [COL.strataB, COL.strataC, COL.strataD, COL.strataA][k];
  out.copy(layer).lerp(next, smoothstep(0.7, 1, f));
  const sand = 0.12 + 0.12 * fbm(x / 90 + 3, z / 90, 2);
  out.lerp(COL.sand, sand); // wind-blown sand over the rock
  const sage = fbm(x / 120 - 20, z / 120 + 11, 3);
  const sageK = sage > 0.2 ? smoothstep(0.2, 0.5, sage) * 0.4 : 0;
  if (sageK) out.lerp(COL.sage, sageK);
  const verge = near && near.dist < 9 ? 1 - smoothstep(6, 9, near.dist) : 0;
  if (verge) out.lerp(COL.verge, verge);
  // Sandstone under a skin of sand, sage patches as dry ground, the verge as dirt.
  const sandW = Math.min(0.5, sand * 1.4);
  w[LAYER.sand] = sandW * (1 - verge);
  w[LAYER.dry] = sageK * (1 - verge);
  w[LAYER.sandstone] = (1 - sandW - sageK) * (1 - verge);
  w[LAYER.dirt] = verge;
}

export function groundColor(x: number, z: number, h: number, near: Near | null, out: THREE.Color, w: Weights) {
  const sc = currentStage().scenery;
  if (sc.palette === 'desert') return desertColor(x, z, h, near, out, w);
  const t = fbm(x / 140, z / 140, 3) * 0.5 + 0.5;
  out.copy(COL.grassA).lerp(COL.grassB, t);
  const fields = fbm(x / 380 + 9, z / 380, 2);
  const fieldK = sc.fields && fields > 0.28 ? smoothstep(0.28, 0.4, fields) * 0.8 : 0;
  if (fieldK) out.lerp(COL.field, fieldK);
  // The bands are sized by the next line up (snow, or scree where a stage has no snow), so Ventoux's rock fades into scree over tens of metres.
  const band = Math.max(14, (Math.min(sc.snowLine, sc.screeLine ?? Infinity) - sc.rockLine) * 0.4);
  const rockLine = sc.rockLine + fbm(x / 60, z / 60, 2) * band;
  const rockT = h > rockLine ? smoothstep(rockLine, rockLine + band, h) : 0;
  if (rockT) out.lerp(COL.rock, rockT);
  let screeT = 0;
  if (sc.screeLine !== undefined) {
    const screeLine = sc.screeLine + fbm(x / 80 + 9, z / 80 - 4, 2) * band * 0.8;
    screeT = h > screeLine ? smoothstep(screeLine, screeLine + band * 0.8, h) : 0;
    if (screeT) {
      // Broken stones: patches of paler and darker ground at a few metres, with the odd dark stone.
      const stones = fbm(x / 9 + 3, z / 9 - 7, 2) * 0.5 + 0.5;
      tmp.copy(COL.screeA).lerp(COL.screeB, smoothstep(0.45, 0.8, stones) * 0.8 + Math.max(0, fbm(x / 3.1, z / 3.1, 1)) * 0.25);
      out.lerp(tmp, screeT);
    }
  }
  const snowLine = sc.snowLine + fbm(x / 90 + 5, z / 90, 2) * band;
  const snowT = h > snowLine ? smoothstep(snowLine, snowLine + band * 0.6, h) : 0;
  if (snowT) out.lerp(COL.snow, snowT);
  let verge = near && near.dist < 9 ? 1 - smoothstep(6, 9, near.dist) : 0;
  verge *= 1 - 0.75 * screeT; // the shoulder of a road over scree is scree, not dirt
  if (verge) out.lerp(COL.verge, verge);
  // Grass, with dry grass in the brighter patches and wherever the fields are; the verge is dirt; then rock, scree and snow take over by height.
  const dry = Math.max(fieldK, 0.5 * smoothstep(0.62, 1, t));
  const base = (1 - rockT) * (1 - snowT) * (1 - screeT) * (1 - verge);
  w[LAYER.grass] = base * (1 - dry);
  w[LAYER.dry] = base * dry;
  w[LAYER.dirt] = verge * (1 - rockT) * (1 - snowT);
  w[LAYER.rock] = rockT * (1 - snowT) * (1 - screeT) * (1 - verge * 0.5);
  w[LAYER.snow] = snowT;
  w[LAYER.scree] = screeT * (1 - snowT) * (1 - verge);
  const sum = w[0] + w[1] + w[2] + w[3] + w[4] + w[7];
  if (sum > 0) { for (let i = 0; i < 5; i++) w[i] /= sum; w[7] /= sum; } // no array per vertex: this runs for every ground point
}

/** What a probe found at a point: the ground height and how far the nearest road centreline is. One object, reused by every call. */
export interface GroundHit { h: number; roadDist: number; /** Rise over run across the road beside canyons (0 elsewhere): cliffs grow nothing. */ slope?: number }

/**
 * A lookup for things stood on the ground (ground cover): at (x, z) it fills `w` with the
 * layer weights `groundColor()` gives there and returns the ground height and the distance to
 * the nearest road. One scan of the road serves every call, as in `groundSampler`.
 */
export function groundProbe(minX: number, maxX: number, minZ: number, maxZ: number): (x: number, z: number, w: Weights) => GroundHit {
  const cands = candidatesFor(minX, maxX, minZ, maxZ);
  const hit: GroundHit = { h: 0, roadDist: Infinity };
  const c = new THREE.Color();
  return (x, z, w) => {
    const near = nearestRoad(cands, x, z);
    hit.h = heightAt(x, z, near);
    hit.roadDist = near ? near.dist : Infinity;
    hit.slope = roadsideSlope(x, z, near);
    w.fill(0);
    groundColor(x, z, hit.h, near, c, w);
    return hit;
  };
}

/** Darkens steep grass and turns cliffs to rock, using the tile's own height grid. */
function shadeSlopes(pos: THREE.BufferAttribute, colors: Float32Array) {
  const sc = currentStage().scenery;
  const rock = sc.palette === 'desert' ? COL.desertRock : COL.rock;
  const paleRock = new THREE.Color();
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
      let cliff = rock;
      if (sc.screeLine !== undefined) cliff = paleRock.copy(rock).lerp(COL.limestone, smoothstep(sc.screeLine - 20, sc.screeLine + 30, pos.getY(iz * n + ix)));
      c.lerp(cliff, smoothstep(0.75, 1.1, slope)); // bare rock on cliffs
      colors.set([c.r, c.g, c.b], i);
    }
  }
}

// ------------------------------------------------------------- tiles ----

interface Tile {
  group: THREE.Group;
  cx: number;
  cz: number;
  /** The tile's tree meshes and the geometry (near or far) they are drawn with now. */
  trees: { mesh: THREE.InstancedMesh; species: TreeSpecies }[];
  lod: TreeLod;
  dispose(): void;
}

export class Terrain {
  readonly group = new THREE.Group();
  private readonly tiles = new Map<string, Tile>();
  private readonly groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  private textures: GroundTextures | null = null;
  private groundModule: Promise<typeof import('./ground')> | null = null;
  private spec: SceneryTier | null = null;

  constructor(private readonly renderer: THREE.WebGLRenderer) {}

  /**
   * The tier's scenery switches: which texture layers, normals and filtering the ground uses.
   * The first call (after the first frame) loads the splatting shader and textures (ground.ts);
   * until they are here the plain vertex colours show.
   */
  setScenery(spec: SceneryTier) {
    this.spec = spec;
    this.nearTrees = spec.nearTrees;
    this.groundModule ??= import('./ground');
    void this.groundModule.then((m) => {
      if (!this.textures) {
        this.textures = new m.GroundTextures(this.renderer.capabilities.getMaxAnisotropy());
        m.patchGroundMaterial(this.groundMat, this.textures);
        this.groundMat.needsUpdate = true;
      }
      this.requestTextures();
    }).catch(() => { /* chunk failed to load (offline): vertex colours */ });
  }

  private requestTextures() {
    if (!this.spec || !this.textures) return;
    const sc = currentStage().scenery;
    this.textures.request(this.spec, sc.palette === 'desert', sc.snowLine < 2500, sc.screeLine !== undefined && sc.screeLine < 2500);
  }

  private readonly kit = new TreeKit();
  private nearTrees = false; // the tier draws the detailed trees on tiles near the rider (set with the scenery tier)

  /** Rain: 0 dry … 1 soaked. The ground and trees darken a little and lose their matt look. */
  setWet(wet: number) {
    this.groundMat.roughness = 0.95 - 0.2 * wet;
    this.groundMat.color.setScalar(1 - 0.24 * wet);
    this.kit.setWet(wet);
  }

  /** Drops every tile (after a stage change). */
  clear() {
    this.requestTextures(); // the next stage may need other layers
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
      const d = Math.hypot(tile.cx - x, tile.cz - z);
      if (d > RANGE + TILE) {
        this.group.remove(tile.group);
        tile.dispose();
        this.tiles.delete(key);
        continue;
      }
      const lod = chooseLod(tile.lod, d, this.nearTrees);
      if (lod !== tile.lod) this.setTileLod(tile, lod);
    }
  }

  /** Swaps a tile's trees between the detailed and the cheap geometry; the instances stay as they are. Only near trees cast and take shadows (the shadow box is 60 m wide). */
  private setTileLod(tile: Tile, lod: TreeLod) {
    tile.lod = lod;
    for (const { mesh, species } of tile.trees) {
      mesh.geometry = this.kit.geometry(species, lod);
      mesh.castShadow = mesh.receiveShadow = lod === 'near';
    }
  }

  private buildTile(ix: number, iz: number): Tile {
    const cx = (ix + 0.5) * TILE;
    const cz = (iz + 0.5) * TILE;
    const cands = candidatesFor(cx - TILE / 2, cx + TILE / 2, cz - TILE / 2, cz + TILE / 2);

    const geo = new THREE.PlaneGeometry(TILE, TILE, SEG, SEG).rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const wa = new Uint8Array(pos.count * 4); // aWa: grass, dry grass, dirt, rock; aWb: snow, sandstone, sand, scree (0..255)
    const wb = new Uint8Array(pos.count * 4);
    const w: Weights = new Array(LAYER_COUNT).fill(0);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + cx;
      const z = pos.getZ(i) + cz;
      const near = nearestRoad(cands, x, z);
      const h = heightAt(x, z, near);
      pos.setY(i, h);
      w.fill(0);
      groundColor(x, z, h, near, tmp, w);
      colors.set([tmp.r, tmp.g, tmp.b], i * 3);
      for (let k = 0; k < LAYER_COUNT; k++) (k < 4 ? wa : wb)[i * 4 + (k & 3)] = Math.round(w[k] * 255);
    }
    shadeSlopes(pos, colors);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aWa', new THREE.BufferAttribute(wa, 4, true));
    geo.setAttribute('aWb', new THREE.BufferAttribute(wb, 4, true));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, this.groundMat);
    ground.receiveShadow = true;

    const group = new THREE.Group();
    group.position.set(cx, 0, cz);
    group.add(ground);

    // Scatter trees: dense in forest patches, the odd lone tree elsewhere. The stage's species mix
    // decides what grows; height decides which species fit (trees.ts), and shrubs take over at the tree line.
    const rand = rng(Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663));
    const sc = currentStage().scenery;
    const desert = sc.palette === 'desert';
    const mix = sc.trees ?? defaultMix(sc.coniferBias, desert);
    const lone = loneTreeShare(sc.forestCover);
    const spots = new Map<TreeSpecies, THREE.Matrix4[]>();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (let n = 0; n < (desert ? 70 : 260); n++) {
      const lx = (rand() - 0.5) * TILE;
      const lz = (rand() - 0.5) * TILE;
      const x = lx + cx;
      const z = lz + cz;
      const forest = fbm(x / 240 - 13, z / 240 + 5, 3);
      const keep = rand();
      if (desert ? forest < 0.0 && keep > 0.08 : forest < 0.05 - sc.forestCover && keep > lone) continue;
      const near = nearestRoad(cands, x, z);
      if (near && (near.dist < 12 || nearLandmark(x, z, near.d) || roadsideSlope(x, z, near) > CLIFF_SLOPE)) continue; // nor on a cliff face
      const h = heightAt(x, z, near);
      const rule = treeLineRule(h, sc.treeLine, forest, rand()); // the tree line
      if (!rule) continue;
      if (sc.screeLine !== undefined && h > sc.screeLine) continue; // nothing grows on the scree
      const species = rule === 'shrub' ? 'shrub' : pickSpecies(mix, h, standRoll(x, z, rand(), rand()));
      const s = treeScale(species, rand());
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(lx, h - 0.3, lz), q, new THREE.Vector3(s, s * (0.85 + rand() * 0.35), s));
      const list = spots.get(species);
      if (list) list.push(m);
      else spots.set(species, [m]);
    }
    const trees: Tile['trees'] = [];
    for (const species of TREE_SPECIES) {
      const mesh = this.instanced(species, spots.get(species), rand);
      if (!mesh) continue;
      trees.push({ mesh, species });
      group.add(mesh);
    }

    return {
      group,
      cx,
      cz,
      trees,
      lod: 'far',
      dispose: () => {
        geo.dispose();
        for (const t of trees) t.mesh.dispose();
      },
    };
  }

  /** A tile's trees of one species as one InstancedMesh, drawn with the far geometry until the tile is near the rider. */
  private instanced(species: TreeSpecies, mats: THREE.Matrix4[] | undefined, rand: () => number) {
    if (!mats?.length) return null;
    const mesh = new THREE.InstancedMesh(this.kit.geometry(species, 'far'), this.kit.material, mats.length);
    mesh.customDepthMaterial = this.kit.depthMaterial;
    const c = new THREE.Color();
    mats.forEach((m, i) => {
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, treeTint(rand(), rand(), rand(), c));
    });
    mesh.computeBoundingSphere();
    mesh.boundingSphere!.radius += 3; // the detailed geometry swells past the far one a little, and trees sway
    return mesh;
  }
}
