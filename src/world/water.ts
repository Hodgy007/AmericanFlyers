import * as THREE from 'three';
import type { Stage } from '../stages';
import type { PondBody, RiverBody, SeaBody } from './waterTypes';

// The stage's water: flat blue sheets at their level (waterTypes.ts) that the terrain sinks below. One cheap
// standard material, so the fog and the haze treat it like the ground; the sea is a big plane that follows
// the rider, ponds and rivers are fixed meshes. Built when the stage is set, torn down at the next.

const SEA_SIZE = 16000;
const SEA_SNAP = 200;

const COLOURS = { sea: '#2a6b8a', pond: '#4a7f95', river: '#55747a' };

export class Water {
  readonly group = new THREE.Group();
  private sea: THREE.Mesh | null = null;
  private readonly mats = new Map<string, THREE.MeshStandardMaterial>();
  private geos: THREE.BufferGeometry[] = [];

  private material(kind: 'sea' | 'pond' | 'river') {
    let m = this.mats.get(kind);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: COLOURS[kind], roughness: kind === 'sea' ? 0.32 : 0.22, metalness: 0.12 });
      this.mats.set(kind, m);
    }
    return m;
  }

  /** Replaces the water with the stage's own (or none). */
  restage(stage: Stage) {
    for (const c of [...this.group.children]) this.group.remove(c);
    for (const g of this.geos) g.dispose();
    this.geos = [];
    this.sea = null;
    for (const body of stage.scenery.water ?? []) {
      if (body.kind === 'sea') this.addSea(body);
      else if (body.kind === 'pond') this.addPond(body);
      else this.addRiver(body);
    }
  }

  private addSea(b: SeaBody) {
    const geo = new THREE.PlaneGeometry(SEA_SIZE, SEA_SIZE).rotateX(-Math.PI / 2);
    this.geos.push(geo);
    this.sea = new THREE.Mesh(geo, this.material('sea'));
    this.sea.position.y = b.level;
    this.sea.userData.level = b.level;
    this.group.add(this.sea);
  }

  private addPond(b: PondBody) {
    const geo = new THREE.CircleGeometry(1, 56).rotateX(-Math.PI / 2);
    this.geos.push(geo);
    const mesh = new THREE.Mesh(geo, this.material('pond'));
    mesh.scale.set(b.rx, 1, b.rz);
    mesh.rotation.y = b.rot;
    mesh.position.set(b.x, b.level, b.z);
    this.group.add(mesh);
  }

  private addRiver(b: RiverBody) {
    // A strip along the polyline: two vertices per point, offset either side along the local normal.
    const n = b.pts.length;
    const pos = new Float32Array(n * 6);
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const [px, pz] = b.pts[i];
      const [ax, az] = b.pts[Math.max(0, i - 1)];
      const [bx, bz] = b.pts[Math.min(n - 1, i + 1)];
      const len = Math.hypot(bx - ax, bz - az) || 1;
      const nx = -(bz - az) / len;
      const nz = (bx - ax) / len;
      pos.set([px + (nx * b.width) / 2, 0, pz + (nz * b.width) / 2, px - (nx * b.width) / 2, 0, pz - (nz * b.width) / 2], i * 6);
      if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // The strip's winding may face down depending on the polyline's direction: draw both sides, the normals point up.
    const up = geo.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < up.count; i++) up.setXYZ(i, 0, 1, 0);
    this.geos.push(geo);
    const mat = this.material('river').clone();
    mat.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = b.level;
    this.group.add(mesh);
  }

  /** Keeps the sea under the rider. */
  update(x: number, z: number) {
    if (!this.sea) return;
    this.sea.position.x = Math.round(x / SEA_SNAP) * SEA_SNAP;
    this.sea.position.z = Math.round(z / SEA_SNAP) * SEA_SNAP;
  }
}
