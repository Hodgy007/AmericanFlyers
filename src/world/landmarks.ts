import * as THREE from 'three';
import { gltfLoader } from './gltf';
import { currentStage, gradeAt, roadPoint } from '../course';
import type { LandmarkKind } from '../stages';
import { groundSampler } from './terrain';
import type { MonumentId } from './monumentTypes';

// Roadside landmarks: GLB models from public/models/, or monuments built in code
// (monuments.ts, a lazy chunk fetched the first time a stage needs one). Each
// stage lists the kinds it uses; each kind repeats along the course at a fixed
// spacing. A missing model file is skipped quietly.

/**
 * Code-built monuments that have a modelled version in public/models/: the GLB is used once it has
 * loaded; if the file is missing the code-built one stands in. `yaw` turns the model to the monument's
 * convention (the builders face +z and ride or look towards -x; the Géant GLB's rider faces +z).
 */
export const MONUMENT_GLB: Partial<Record<MonumentId, { file: string; yaw: number }>> = {
  'geant-tourmalet': { file: 'geant.glb', yaw: -Math.PI / 2 },
  'ventoux-observatory': { file: 'ventoux-summit.glb', yaw: Math.PI },
};

const BEHIND = 250;
const AHEAD = 1500;

interface Site {
  kind: LandmarkKind;
  key: string; // which kind of the stage and which repeat, for telling placed ones apart
  d: number;
  x: number;
  z: number;
}

function siteAt(kind: LandmarkKind, index: number, d: number): Site {
  if (kind.world) return { kind, key: `${index}@${d}`, d, x: kind.world.x, z: kind.world.z };
  const p = roadPoint(d);
  return {
    kind,
    key: `${index}@${d}`,
    d,
    x: p.x - Math.sin(p.heading) * kind.offset * kind.side,
    z: p.z + Math.cos(p.heading) * kind.offset * kind.side,
  };
}

/** Landmark sites whose course distance lies in [from, to]. With `widen`, a kind with a `reach` is looked for that far either side of the window's middle instead. */
function sitesBetween(from: number, to: number, widen = false): Site[] {
  const out: Site[] = [];
  const mid = (from + to) / 2;
  currentStage().landmarks.forEach((kind, index) => {
    const lo = widen && kind.reach ? Math.min(from, mid - kind.reach) : from;
    const hi = widen && kind.reach ? Math.max(to, mid + kind.reach) : to;
    if (kind.first > hi || (kind.until ?? Infinity) < lo) return;
    const last = Math.min(hi, kind.until ?? Infinity);
    for (let k = Math.max(0, Math.ceil((lo - kind.first) / kind.every)); kind.first + k * kind.every <= last; k++) {
      out.push(siteAt(kind, index, kind.first + k * kind.every));
    }
  });
  return out;
}

/** True if (x, z), near course distance `d`, is inside a landmark's clear zone. */
export function nearLandmark(x: number, z: number, d: number): boolean {
  for (const s of sitesBetween(d - 80, d + 80)) {
    if (Math.hypot(s.x - x, s.z - z) < s.kind.clearance) return true;
  }
  return false;
}

export class Landmarks {
  readonly group = new THREE.Group();
  private readonly sources = new Map<string, THREE.Object3D | null>(); // file → loaded scene
  private readonly prepared = new Map<LandmarkKind, THREE.Object3D>(); // kind → scaled model
  private readonly footprint = new Map<LandmarkKind, { x: number; z: number }>(); // kind → half the model's width and depth
  private readonly placed = new Map<string, THREE.Object3D>();

  private readonly loader = gltfLoader();
  private readonly requested = new Set<string>(); // files already being fetched
  private monuments: typeof import('./monuments') | null = null; // the lazy chunk, once it has arrived
  private monumentsRequested = false;

  /**
   * A model file is fetched the first time a landmark that uses it comes within
   * range (1.5 km ahead is minutes of riding), not all up front: the nine files
   * add up to 7.5 MB, and a stage uses only some of them.
   */
  private request(file: string) {
    if (this.requested.has(file)) return;
    this.requested.add(file);
    this.loader.load(
      `${import.meta.env.BASE_URL}models/${file}`,
      (gltf) => this.sources.set(file, gltf.scene),
      undefined,
      () => {
        this.sources.set(file, null);
        console.info(`Landmark model not found: models/${file} (skipped)`);
      },
    );
  }

  /** The code-built monuments are one lazy chunk, fetched when the first one comes into range (stages without any never download it). */
  private requestMonuments() {
    if (this.monumentsRequested) return;
    this.monumentsRequested = true;
    import('./monuments').then(
      (m) => { this.monuments = m; },
      () => console.info('Landmark monuments failed to load (skipped)'),
    );
  }

  /** Removes everything placed (after a stage change). */
  clear() {
    for (const obj of this.placed.values()) this.group.remove(obj);
    this.placed.clear();
  }

  private model(kind: LandmarkKind) {
    let m = this.prepared.get(kind);
    if (!m) {
      const glb = kind.model ? MONUMENT_GLB[kind.model] : undefined;
      if (glb) {
        // Wait for the file's verdict (a stage's landmarks are asked for 1.5 km ahead, minutes of riding): then the model, or the code-built one if the file is missing.
        this.request(glb.file);
        if (!this.sources.has(glb.file)) return null;
        const src = this.sources.get(glb.file);
        if (src) {
          const turn = new THREE.Group();
          turn.rotation.y = glb.yaw;
          turn.add(normalise(src.clone(true), kind));
          const holder = new THREE.Group();
          holder.add(turn);
          m = holder;
          this.prepared.set(kind, m);
          return m;
        }
      }
      if (kind.model) {
        this.requestMonuments();
        if (!this.monuments) return null; // still loading
        try {
          m = stand(this.monuments.buildMonument(kind.model, kind.options), kind);
        } catch (e) {
          console.info(`Landmark monument ${kind.model} failed to build (skipped)`, e);
          m = new THREE.Group(); // an empty stand-in, so it is not rebuilt every frame
        }
      } else {
        this.request(kind.file);
        const src = this.sources.get(kind.file);
        if (!src) return null; // still loading, or missing
        m = normalise(src.clone(true), kind);
      }
      this.prepared.set(kind, m);
    }
    return m;
  }

  update(distance: number) {
    const keep = new Set<string>();
    for (const site of sitesBetween(distance - BEHIND, distance + AHEAD, true)) {
      const key = site.key;
      keep.add(key);
      if (this.placed.has(key)) continue;
      const model = this.model(site.kind);
      if (!model) continue;
      const obj = model.clone(true);
      this.position(obj, site);
      this.placed.set(key, obj);
      this.group.add(obj);
    }
    for (const [key, obj] of this.placed) {
      if (!keep.has(key)) {
        this.group.remove(obj);
        this.placed.delete(key);
      }
    }
  }

  private position(obj: THREE.Object3D, site: Site) {
    const { kind } = site;
    if (kind.world) {
      // Placed in the world, not along the road: its own height and heading (see LandmarkBase.world).
      obj.position.set(kind.world.x, kind.world.y, kind.world.z);
      obj.rotation.y = kind.world.yaw;
      return;
    }
    const p = roadPoint(site.d);
    let yaw = 0;
    if (kind.side === 0) {
      // Face back down the road towards the approaching rider.
      yaw = Math.atan2(-Math.cos(p.heading), -Math.sin(p.heading));
    } else {
      // Face the road, then turn a little towards oncoming riders.
      yaw = Math.atan2(kind.side * Math.sin(p.heading), -kind.side * Math.cos(p.heading)) + (kind.yaw ?? 0) * kind.side;
    }
    // The terrain mesh is shaped from each point's nearest road (the cut beside it, and the leg of
    // the next hairpin above); a fixed `offset` misses both, which leaves a big model hanging over
    // the slope. Sample the real ground under the turned footprint, and stand on its lowest corner so
    // the downhill edge meets the ground (the uphill side settles into the slope).
    let y = p.y;
    if (kind.side !== 0) {
      let half = this.footprint.get(kind);
      if (half === undefined) {
        const box = new THREE.Box3().setFromObject(obj);
        half = { x: (box.max.x - box.min.x) / 2, z: (box.max.z - box.min.z) / 2 };
        this.footprint.set(kind, half);
      }
      // Corners of the footprint in local space, turned into the world. `x` is the road direction.
      const cos = Math.cos(yaw), sin = Math.sin(yaw);
      const corners = [[-half.x, -half.z], [half.x, -half.z], [-half.x, half.z], [half.x, half.z]];
      const reach = Math.min(Math.max(half.x, half.z), 120);
      const ground = groundSampler(site.x - reach, site.x + reach, site.z - reach, site.z + reach);
      y = ground(site.x, site.z);
      for (const [lx, lz] of corners) {
        const dx = lx * cos + lz * sin;
        const dz = -lx * sin + lz * cos;
        y = Math.min(y, ground(site.x + dx, site.z + dz));
      }
    }
    const place = (kind.span === 'along' ? p.y + (kind.lift ?? 0) : y - 0.4); // sink slightly so slopes don't show a gap
    obj.position.set(site.x, place, site.z);
    if (kind.span === 'along') {
      // Long axis follows the road, pitched to match the grade.
      obj.rotation.set(0, -p.heading, Math.atan(gradeAt(site.d)), 'YXZ');
    } else {
      obj.rotation.y = yaw;
    }
  }
}

/** Scales a model to its target size, centres it, and stands it on y = 0. */
function normalise(scene: THREE.Object3D, kind: LandmarkKind): THREE.Object3D {
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const scale =
    kind.span === 'along' ? kind.size / Math.min(size.x, size.z)
    : kind.side === 0 ? kind.size / Math.max(size.x, size.z)
    : kind.size / size.y;
  const centre = box.getCenter(new THREE.Vector3());
  scene.position.set(-centre.x * scale, -box.min.y * scale, -centre.z * scale);
  scene.scale.setScalar(scale);
  const holder = new THREE.Group();
  if (kind.span === 'along' && size.z > size.x) {
    // Turn the model so its long axis lies along the holder's +x (the road direction).
    const turn = new THREE.Group();
    turn.rotation.y = Math.PI / 2;
    turn.add(scene);
    holder.add(turn);
  } else {
    holder.add(scene);
  }
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return holder;
}

/**
 * Scales a code-built monument so it is `kind.size` tall, as built: its own origin is the ground
 * (the builder put any footing below y = 0) and it faces +z, so unlike a GLB it is not re-centred.
 * It casts shadows only if the builder said so (the distant Flatirons would shade the valley).
 */
function stand(group: THREE.Group, kind: LandmarkKind): THREE.Object3D {
  const height = new THREE.Box3().setFromObject(group).max.y;
  group.scale.setScalar(kind.size / Math.max(height, 0.01));
  const shadows = group.userData.shadows !== false;
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = shadows;
      o.receiveShadow = shadows;
    }
  });
  const holder = new THREE.Group();
  holder.add(group);
  return holder;
}
