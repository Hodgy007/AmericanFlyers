import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { roadPoint } from '../course';
import { heightAt } from './terrain';

// Roadside landmarks loaded from GLB models in public/models/. Each kind
// repeats along the endless course at a fixed spacing. A missing model file
// is skipped quietly, so the ride works with any subset of models present.

interface LandmarkKind {
  file: string;
  every: number; // metres between repeats
  first: number; // distance of the first one
  side: -1 | 0 | 1; // -1 left, 1 right, 0 spanning the road
  offset: number; // metres from the road centre
  size: number; // target height in metres (width for road-spanning kinds)
  yaw?: number; // extra turn in radians after facing the road
  clearance: number; // keep trees this far away
}

const KINDS: LandmarkKind[] = [
  { file: 'gantry.glb', every: 5000, first: 0, side: 0, offset: 0, size: 13, clearance: 10 },
  { file: 'windmill.glb', every: 1900, first: 600, side: -1, offset: 38, size: 14, yaw: 0.4, clearance: 10 },
  { file: 'barn.glb', every: 2300, first: 950, side: 1, offset: 34, size: 10, yaw: -0.6, clearance: 18 },
  { file: 'farmhouse.glb', every: 2300, first: 1200, side: -1, offset: 32, size: 9, yaw: 0.6, clearance: 16 },
  { file: 'diner.glb', every: 3700, first: 1900, side: -1, offset: 24, size: 6.5, yaw: 0.5, clearance: 16 },
  { file: 'water-tower.glb', every: 4100, first: 2700, side: 1, offset: 46, size: 26, clearance: 10 },
];

const BEHIND = 250;
const AHEAD = 1500;

interface Site {
  kind: LandmarkKind;
  d: number;
  x: number;
  z: number;
}

function siteAt(kind: LandmarkKind, d: number): Site {
  const p = roadPoint(d);
  return {
    kind,
    d,
    x: p.x - Math.sin(p.heading) * kind.offset * kind.side,
    z: p.z + Math.cos(p.heading) * kind.offset * kind.side,
  };
}

/** Landmark sites whose course distance lies in [from, to]. */
function sitesBetween(from: number, to: number): Site[] {
  const out: Site[] = [];
  for (const kind of KINDS) {
    for (let k = Math.max(0, Math.ceil((from - kind.first) / kind.every)); kind.first + k * kind.every <= to; k++) {
      out.push(siteAt(kind, kind.first + k * kind.every));
    }
  }
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
  private readonly models = new Map<string, THREE.Object3D | null>();
  private readonly placed = new Map<string, THREE.Object3D>();

  constructor() {
    const loader = new GLTFLoader();
    for (const kind of KINDS) {
      loader.load(
        `${import.meta.env.BASE_URL}models/${kind.file}`,
        (gltf) => this.models.set(kind.file, normalise(gltf.scene, kind)),
        undefined,
        () => {
          this.models.set(kind.file, null);
          console.info(`Landmark model not found: models/${kind.file} (skipped)`);
        },
      );
    }
  }

  update(distance: number) {
    const keep = new Set<string>();
    for (const site of sitesBetween(distance - BEHIND, distance + AHEAD)) {
      const key = `${site.kind.file}@${site.d}`;
      keep.add(key);
      if (this.placed.has(key)) continue;
      const model = this.models.get(site.kind.file);
      if (!model) continue; // still loading, or missing
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
    const p = roadPoint(site.d);
    const { kind } = site;
    const y = kind.side === 0 ? p.y : heightAt(site.x, site.z, { dist: kind.offset, d: site.d });
    obj.position.set(site.x, y - 0.4, site.z); // sink slightly so slopes don't show a gap
    if (kind.side === 0) {
      // Face back down the road towards the approaching rider.
      obj.rotation.y = Math.atan2(-Math.cos(p.heading), -Math.sin(p.heading));
    } else {
      // Face the road, then turn a little towards oncoming riders.
      obj.rotation.y = Math.atan2(kind.side * Math.sin(p.heading), -kind.side * Math.cos(p.heading)) + (kind.yaw ?? 0) * kind.side;
    }
  }
}

/** Scales a model to its target size, centres it, and stands it on y = 0. */
function normalise(scene: THREE.Object3D, kind: LandmarkKind): THREE.Object3D {
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const scale = kind.side === 0 ? kind.size / Math.max(size.x, size.z) : kind.size / size.y;
  const centre = box.getCenter(new THREE.Vector3());
  scene.position.set(-centre.x * scale, -box.min.y * scale, -centre.z * scale);
  scene.scale.setScalar(scale);
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  const holder = new THREE.Group();
  holder.add(scene);
  return holder;
}
