import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { currentStage, gradeAt, roadPoint } from '../course';
import { FARM_LANDMARKS, STAGES, type LandmarkKind } from '../stages';
import { heightAt } from './terrain';

// Roadside landmarks loaded from GLB models in public/models/. Each stage
// lists the kinds it uses; each kind repeats along the course at a fixed
// spacing. A missing model file is skipped quietly.

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
  for (const kind of currentStage().landmarks) {
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
  private readonly sources = new Map<string, THREE.Object3D | null>(); // file → loaded scene
  private readonly prepared = new Map<LandmarkKind, THREE.Object3D>(); // kind → scaled model
  private readonly placed = new Map<string, THREE.Object3D>();

  constructor() {
    const loader = new GLTFLoader();
    const files = new Set([...STAGES, { landmarks: FARM_LANDMARKS }].flatMap((s) => s.landmarks.map((k) => k.file)));
    for (const file of files) {
      loader.load(
        `${import.meta.env.BASE_URL}models/${file}`,
        (gltf) => this.sources.set(file, gltf.scene),
        undefined,
        () => {
          this.sources.set(file, null);
          console.info(`Landmark model not found: models/${file} (skipped)`);
        },
      );
    }
  }

  /** Removes everything placed (after a stage change). */
  clear() {
    for (const obj of this.placed.values()) this.group.remove(obj);
    this.placed.clear();
  }

  private model(kind: LandmarkKind) {
    let m = this.prepared.get(kind);
    if (!m) {
      const src = this.sources.get(kind.file);
      if (!src) return null; // still loading, or missing
      m = normalise(src.clone(true), kind);
      this.prepared.set(kind, m);
    }
    return m;
  }

  update(distance: number) {
    const keep = new Set<string>();
    for (const site of sitesBetween(distance - BEHIND, distance + AHEAD)) {
      const key = `${site.kind.file}@${site.d}`;
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
