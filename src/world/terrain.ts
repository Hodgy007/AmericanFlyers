import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { elevationAt, ROAD_ORIGIN, ROAD_STEP, roadX, roadZ } from '../course';
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

interface Near {
  dist: number; // metres from the road centreline
  d: number; // course distance of the closest road point
}

// ------------------------------------------------------------ height ----

/** Rolling hills and mountains that ignore the road. */
function wildHeight(x: number, z: number): number {
  const hills = fbm(x / 850, z / 850, 4) * 105;
  const ridges = (1 - Math.abs(fbm(x / 320 + 41, z / 320 - 7, 3))) * 28;
  return 6 + hills + ridges;
}

/** Ground height: the road's own elevation in a valley along it, blending out to wild hills. */
export function heightAt(x: number, z: number, near: Near | null): number {
  const bumps = fbm(x / 70, z / 70, 3) * 6;
  if (!near || near.dist >= ROAD_INFLUENCE) return wildHeight(x, z) + bumps;
  const road = elevationAt(near.d) - 0.15;
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

  // Refine among the fine samples around the coarse hit, then project onto segments.
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
};
const tmp = new THREE.Color();

function groundColor(x: number, z: number, h: number, near: Near | null, out: THREE.Color) {
  out.copy(COL.grassA).lerp(COL.grassB, fbm(x / 140, z / 140, 3) * 0.5 + 0.5);
  const fields = fbm(x / 380 + 9, z / 380, 2);
  if (fields > 0.28) out.lerp(COL.field, smoothstep(0.28, 0.4, fields) * 0.8);
  const rockLine = 78 + fbm(x / 60, z / 60, 2) * 12;
  if (h > rockLine) out.lerp(COL.rock, smoothstep(rockLine, rockLine + 14, h));
  if (h > rockLine + 30) out.lerp(COL.snow, smoothstep(rockLine + 30, rockLine + 40, h));
  if (near && near.dist < 9) out.lerp(COL.verge, 1 - smoothstep(6, 9, near.dist));
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

// ------------------------------------------------------------- tiles ----

interface Tile {
  group: THREE.Group;
  dispose(): void;
}

export class Terrain {
  readonly group = new THREE.Group();
  private readonly tiles = new Map<string, Tile>();
  private readonly groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
  private readonly treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
  private readonly conifer = makeConifer();
  private readonly broadleaf = makeBroadleaf();

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
    geo.deleteAttribute('uv');
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + cx;
      const z = pos.getZ(i) + cz;
      const near = nearestRoad(cands, x, z);
      const h = heightAt(x, z, near);
      pos.setY(i, h);
      groundColor(x, z, h, near, tmp);
      colors.set([tmp.r, tmp.g, tmp.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
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
    for (let n = 0; n < 260; n++) {
      const lx = (rand() - 0.5) * TILE;
      const lz = (rand() - 0.5) * TILE;
      const x = lx + cx;
      const z = lz + cz;
      const forest = fbm(x / 240 - 13, z / 240 + 5, 3);
      const keep = rand();
      if (forest < 0.05 && keep > 0.06) continue;
      const near = nearestRoad(cands, x, z);
      if (near && (near.dist < 12 || nearLandmark(x, z, near.d))) continue;
      const h = heightAt(x, z, near);
      if (h > 82) continue; // tree line
      const s = 0.75 + rand() * 0.7;
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(lx, h - 0.3, lz), q, new THREE.Vector3(s, s * (0.85 + rand() * 0.35), s));
      (h > 45 || forest > 0.3 || rand() < 0.4 ? conifers : broadleaves).push(m);
    }
    const meshes = [this.instanced(this.conifer, conifers, rand), this.instanced(this.broadleaf, broadleaves, rand)];
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
