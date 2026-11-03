import * as THREE from 'three';
import { roadPoint } from '../course';
import { currentStage } from '../course';
import { barrierKind, barrierSections, buildBarriers, railGeometry, stoneGeometry } from './barriers';
import { buildCrowd, crowdMaterial, crowdUniforms, planCrowd, spectatorGeometry } from './crowds';
import { buildPaint, drawAtlas, paintName, planPaint, type PaintSpot } from './roadPaint';
import { isClimb } from './roadside';
import { RoadSurface } from './roadSurface';
import type { RoadPaintLayout } from './roadStyle';
import type { SceneryTier } from './scenery';
import { groundSampler } from './terrain';

// Everything round 6 puts on and beside the road, in one lazily loaded chunk
// (road.ts fetches it after the first frame): the asphalt detail and the wet
// look (roadSurface.ts), words painted on the climbs (roadPaint.ts), guardrails
// (barriers.ts) and spectators (crowds.ts). `addTo()` fits out one 100 m road chunk.

const CHUNK = 100; // road.ts's chunk length

export class RoadExtras {
  private readonly surface: RoadSurface;
  private spec: SceneryTier | null = null;
  private name = '';
  private paint: { stage: unknown; name: string; spots: PaintSpot[] } | null = null;
  private paintTex: THREE.CanvasTexture | null = null;
  private paintMat: THREE.MeshStandardMaterial | null = null;
  private readonly railGeo = railGeometry();
  private readonly railMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.5 });
  private stoneGeo: THREE.BufferGeometry | null = null; // only the alpine passes need these
  private stoneMat: THREE.MeshStandardMaterial | null = null;
  private readonly crowdGeo = spectatorGeometry(false);
  private readonly flaggerGeo = spectatorGeometry(true);
  private readonly crowdMat = crowdMaterial();

  constructor(private readonly roadMaterial: THREE.MeshStandardMaterial, map: THREE.Texture, maxAniso: number) {
    this.surface = new RoadSurface(roadMaterial, map, maxAniso);
  }

  /** The stage's road style, so the normal and roughness maps keep its painted lines flat. */
  setRoadLayout(layout: RoadPaintLayout) {
    this.surface.setLayout(layout);
  }

  setTier(spec: SceneryTier, ibl: boolean) {
    this.spec = spec;
    this.surface.setTier(spec, ibl);
    if (this.paintTex) this.paintTex.anisotropy = Math.min(spec.anisotropy, 8);
  }

  setWet(wet: number) {
    this.surface.setWet(wet);
    this.paintMat?.color.setScalar(this.roadMaterial.color.r);
  }

  /** The rider's first name for the road paint. True if the painted name changed (so the road chunks want their paint redone). */
  setRiderName(raw: string): boolean {
    const name = paintName(raw);
    if (name === this.name) return false;
    this.name = name;
    this.paint = null;
    if (this.paintTex) { this.paintTex.image = drawAtlas(name, this.atlasWidth()); this.paintTex.needsUpdate = true; }
    return true;
  }

  animate(timeS: number, x: number, y: number, z: number) {
    crowdUniforms.uTime.value = timeS;
    crowdUniforms.uRider.value.set(x, y, z);
  }

  private atlasWidth() {
    return this.spec && this.spec.terrainTexSize === 512 ? 512 : 1024;
  }

  /** Paint, guardrails and spectators for the road chunk starting at `d0`; added to `group` (whose world position is `origin`). */
  addTo(group: THREE.Group, d0: number, origin: { x: number; z: number }): { dispose(): void } {
    const spec = this.spec;
    const objects: THREE.Object3D[] = [];
    const geos: THREE.BufferGeometry[] = [];
    const stage = currentStage();
    const d1 = d0 + CHUNK;
    if (spec) {
      if (spec.roadPaint && isClimb(stage)) {
        if (!this.paint || this.paint.stage !== stage || this.paint.name !== this.name) this.paint = { stage, name: this.name, spots: planPaint(stage, this.name) };
        const geo = buildPaint(this.paint.spots, d0, d1, origin);
        if (geo) {
          const mesh = new THREE.Mesh(geo, this.paintMaterial(spec));
          mesh.receiveShadow = true;
          mesh.renderOrder = 1;
          objects.push(mesh);
          geos.push(geo);
        }
      }
      if (spec.barriers && isClimb(stage)) {
        const a = roadPoint(d0 + CHUNK / 2);
        const ground = groundSampler(a.x - 140, a.x + 140, a.z - 140, a.z + 140);
        const stone = barrierKind(stage) === 'stone';
        if (stone && !this.stoneGeo) {
          this.stoneGeo = stoneGeometry();
          this.stoneMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
        }
        const rails = buildBarriers(barrierSections(stage, d0, d1, ground), stone ? this.stoneGeo! : this.railGeo, stone ? this.stoneMat! : this.railMat, origin);
        if (rails) objects.push(rails);
      }
      if (spec.crowd > 0 && stage.finish !== null) {
        const all = planCrowd(stage, d0, d1, spec.crowd, stage.signs.map((s) => s.d), spec.crowdFlags);
        for (const [people, geo] of [[all.filter((p) => !p.flag), this.crowdGeo], [all.filter((p) => p.flag), this.flaggerGeo]] as const) {
          const mesh = buildCrowd(people, geo, this.crowdMat, origin, spec.crowdShadows);
          if (mesh) objects.push(mesh);
        }
      }
    }
    for (const o of objects) group.add(o);
    return {
      dispose: () => {
        for (const o of objects) { group.remove(o); (o as THREE.InstancedMesh).dispose?.(); }
        for (const g of geos) g.dispose();
      },
    };
  }

  private paintMaterial(spec: SceneryTier) {
    if (!this.paintMat) {
      this.paintTex = new THREE.CanvasTexture(drawAtlas(this.name, this.atlasWidth()));
      this.paintTex.colorSpace = THREE.SRGBColorSpace;
      this.paintTex.anisotropy = Math.min(spec.anisotropy, 8);
      this.paintMat = new THREE.MeshStandardMaterial({
        map: this.paintTex, transparent: true, depthWrite: false, roughness: 0.8,
        polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
      });
      this.paintMat.color.setScalar(this.roadMaterial.color.r);
    }
    return this.paintMat;
  }
}
