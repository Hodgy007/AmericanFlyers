import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { gradeAt, roadPoint } from '../course';
import { heightAt } from './terrain';

// Roadside landmarks loaded from GLB models in public/models/. Each kind
// repeats along the endless course at a fixed spacing. A missing model file
// is skipped quietly, so the ride works with any subset of models present.

interface LandmarkKind {
  file: string;
  every: number; // metres between repeats
  first: number; // distance of the first one
  side: -1 | 0 | 1; // -1 left, 1 right, 0 on the road itself
  /** For side 0: 'across' spans the road like an arch; 'along' is ridden through lengthwise (a bridge). */
  span?: 'across' | 'along';
  offset: number; // metres from the road centre
  size: number; // target height in metres; width for side-0 kinds
  yaw?: number; // extra turn in radians after facing the road
  clearance: number; // keep trees this far away
}

const KINDS: LandmarkKind[] = [
  { file: 'gantry.glb', every: 5000, first: 30, side: 0, span: 'across', offset: 0, size: 13, clearance: 12 },
  { file: 'covered-bridge.glb', every: 6000, first: 4000, side: 0, span: 'along', offset: 0, size: 12.5, clearance: 22 },
  { file: 'windmill.glb', every: 1900, first: 600, side: -1, offset: 26, size: 15, yaw: 0.4, clearance: 24 },
  { file: 'barn.glb', every: 2300, first: 950, side: 1, offset: 34, size: 10, yaw: -0.6, clearance: 26 },
  { file: 'farmhouse.glb', every: 2300, first: 1200, side: -1, offset: 32, size: 9, yaw: 0.6, clearance: 26 },
  { file: 'diner.glb', every: 3700, first: 1900, side: -1, offset: 24, size: 6.5, yaw: 0.5, clearance: 24 },
  { file: 'water-tower.glb', every: 4100, first: 2700, side: 1, offset: 46, size: 26, clearance: 18 },
  { file: 'gas-station.glb', every: 4300, first: 1550, side: 1, offset: 23, size: 6.5, yaw: -0.5, clearance: 24 },
  { file: 'silos.glb', every: 3100, first: 2150, side: 1, offset: 40, size: 18, yaw: -0.3, clearance: 26 },
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
    if (kind.span === 'along') {
      // Long axis follows the road, pitched to match the grade.
      obj.rotation.set(0, -p.heading, Math.atan(gradeAt(site.d)), 'YXZ');
      obj.position.y = p.y; // sits on the road, not sunk
    } else if (kind.side === 0) {
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
