import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { currentStage, gradeAt, roadPoint } from '../course';
import type { RoadExtras } from './roadExtras'; // asphalt detail, wet look, painted words, guardrails, crowds: a lazily loaded chunk
import { drawMilestoneFace, averageGrade, milestoneGeometry, milestoneText, MILESTONE_FACE, signStyleOf } from './milestones';
import { drawRoadMap } from './roadMap';
import { ROAD_HALF_WIDTH } from './roadside';
import { ROAD_TEX_WIDTH, roadPaintLayout, roadStyleOf, type RoadPaintLayout } from './roadStyle';
import type { SceneryTier } from './scenery';

const CHUNK = 100; // metres of road per mesh
const STEP = 2;
export { ROAD_HALF_WIDTH };
const BEHIND = 150;
const AHEAD = 1600;

export interface MarkerConfig {
  every: number; // metres between labelled signs
  label: (n: number) => string | null; // null skips that sign
}

// The road texture spans the full road width (shoulder to shoulder) and
// `layout.repeatM` of length (one road width, 512 × 512 px, unless the style needs
// a longer repeat: see roadStyle.ts). The asphalt photo is tiled underneath; until
// it loads, a flat grey stands in. `repaint()` redraws it for another style.
function roadTexture(renderer: THREE.WebGLRenderer, first: RoadPaintLayout) {
  const c = document.createElement('canvas');
  c.width = ROAD_TEX_WIDTH;
  c.height = first.height;
  const g = c.getContext('2d')!;
  const tex = new THREE.CanvasTexture(c);
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();

  let layout = first;
  let asphalt: HTMLImageElement | undefined;
  const paint = () => {
    if (c.height !== layout.height) {
      c.height = layout.height; // resizing clears the canvas, and the GPU copy has the old size: let it be reallocated
      tex.dispose();
    }
    drawRoadMap(g, layout, asphalt);
    tex.needsUpdate = true;
  };
  paint();
  const img = new Image();
  img.onload = () => { asphalt = img; paint(); };
  img.src = `${import.meta.env.BASE_URL}textures/asphalt.jpg`;
  return { tex, repaint: (next: RoadPaintLayout) => { layout = next; paint(); } };
}

/** Black-and-white chequers: 5 squares along the road, 18 across. */
function checkerTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 5 * 32;
  c.height = 18 * 32;
  const g = c.getContext('2d')!;
  for (let x = 0; x < 5; x++) {
    for (let y = 0; y < 18; y++) {
      g.fillStyle = (x + y) % 2 ? '#111318' : '#f4f6fa';
      g.fillRect(x * 32, y * 32, 32, 32);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

function postGeometry() {
  const paint = (geo: THREE.BufferGeometry, color: string) => {
    const g = geo.toNonIndexed();
    const col = new THREE.Color(color);
    const arr = new Float32Array(g.attributes.position.count * 3).map((_, i) => [col.r, col.g, col.b][i % 3]);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  };
  return mergeGeometries([
    paint(new THREE.BoxGeometry(0.12, 1.0, 0.12).translate(0, 0.5, 0), '#f4f4f4'),
    paint(new THREE.BoxGeometry(0.13, 0.14, 0.13).translate(0, 0.93, 0), '#d62839'),
  ])!;
}

interface Chunk {
  group: THREE.Group;
  origin: { x: number; z: number };
  /** The roadside extras added to the group (painted words, guardrails, crowds); null until they're loaded. */
  extra: { dispose(): void } | null;
  dispose(): void;
}

export class Road {
  readonly group = new THREE.Group();
  private readonly chunks = new Map<number, Chunk>();
  private readonly material: THREE.MeshStandardMaterial;
  private readonly map: THREE.Texture;
  private readonly repaintMap: (layout: RoadPaintLayout) => void;
  private layout: RoadPaintLayout;
  private readonly maxAniso: number;
  // Round 6 extras (roadExtras.ts) load after the first frame; the road is drawn without them until then.
  private extras: RoadExtras | null = null;
  private extrasModule: Promise<typeof import('./roadExtras')> | null = null;
  private spec: SceneryTier | null = null;
  private ibl = false;
  private wet = 0;
  private riderName = '';
  private readonly postGeo = postGeometry();
  private readonly postMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
  // The French and Italian milestones (milestones.ts): one post geometry per country, a face per label (cached; cleared with the stage).
  private readonly milestoneGeos = new Map<string, THREE.BufferGeometry>();
  private readonly milestoneFaces = new Map<string, { tex: THREE.Texture; mat: THREE.Material }>();
  private readonly milestoneFaceGeo = new THREE.PlaneGeometry(MILESTONE_FACE.width, MILESTONE_FACE.height);
  private readonly milestoneMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  private readonly signPostMat = new THREE.MeshStandardMaterial({ color: '#8a8f99', roughness: 0.5, metalness: 0.4 });
  // 2.5 m deep (along the road, +x) by the full road width (+z), lying flat.
  private readonly finishGeo = new THREE.PlaneGeometry(2.5, ROAD_HALF_WIDTH * 2).rotateX(-Math.PI / 2);
  private readonly finishMat = new THREE.MeshStandardMaterial({
    map: checkerTexture(),
    roughness: 0.8,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });

  constructor(renderer: THREE.WebGLRenderer, private markers: MarkerConfig) {
    this.layout = roadPaintLayout(roadStyleOf(currentStage()));
    const road = roadTexture(renderer, this.layout);
    this.map = road.tex;
    this.repaintMap = road.repaint;
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();
    this.material = new THREE.MeshStandardMaterial({
      map: this.map,
      roughness: 0.92,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  }

  /** Rain: 0 dry … 1 soaked. The road darkens and turns glossy; once the extras are here it also grows puddles (roadSurface.ts). */
  setWet(wet: number) {
    this.wet = wet;
    this.material.roughness = 0.92 - 0.45 * wet;
    this.material.color.setScalar(1 - 0.3 * wet);
    this.extras?.setWet(wet);
  }

  /** The graphics tier's scenery switches. The first call loads the extras; later ones refit the roadside objects if they changed. */
  setTier(spec: SceneryTier, ibl: boolean) {
    this.spec = spec;
    this.ibl = ibl;
    if (this.extras) { this.applyExtras(this.extras); return; }
    this.extrasModule ??= import('./roadExtras');
    void this.extrasModule.then((m) => {
      this.extras ??= new m.RoadExtras(this.material, this.map, this.maxAniso);
      this.extras.setRoadLayout(this.layout);
      this.applyExtras(this.extras);
    }).catch(() => { /* chunk failed to load (offline): the plain road */ });
  }

  private applyExtras(x: RoadExtras) {
    if (!this.spec) return;
    x.setWet(this.wet);
    x.setRiderName(this.riderName);
    x.setTier(this.spec, this.ibl);
    this.refreshExtras();
  }

  /** The rider's first name, painted on the road on the climbs ("ALLEZ SAM"). Letters only; empty means no name. */
  setRiderName(raw: string | null | undefined) {
    const name = raw ?? '';
    if (name === this.riderName) return;
    this.riderName = name;
    if (this.extras && this.extras.setRiderName(name)) this.refreshExtras();
  }

  /** Called every frame: spectators near the rider cheer as they pass. */
  animate(timeS: number, x: number, y: number, z: number) {
    this.extras?.animate(timeS, x, y, z);
  }

  /** Puts every loaded chunk's roadside objects back: after the extras arrive, or when the tier, name or stage changes them. */
  private refreshExtras() {
    for (const [k, c] of this.chunks) {
      c.extra?.dispose();
      c.extra = this.extras?.addTo(c.group, k * CHUNK, c.origin) ?? null;
    }
  }

  private clearChunks() {
    for (const [k, c] of this.chunks) {
      this.group.remove(c.group);
      c.dispose();
      this.chunks.delete(k);
    }
  }

  /** New distance signs (units or stage changed). Also repaints the road if the stage's style differs from the last one's. */
  setMarkers(markers: MarkerConfig) {
    this.markers = markers;
    const layout = roadPaintLayout(roadStyleOf(currentStage()));
    if (layout !== this.layout) {
      this.layout = layout;
      this.repaintMap(layout);
      this.extras?.setRoadLayout(layout);
    }
    this.clearChunks();
    for (const f of this.milestoneFaces.values()) { f.tex.dispose(); f.mat.dispose(); }
    this.milestoneFaces.clear();
  }

  update(distance: number) {
    const first = Math.floor((distance - BEHIND) / CHUNK);
    const last = Math.floor((distance + AHEAD) / CHUNK);
    for (let k = first; k <= last; k++) {
      if (!this.chunks.has(k)) {
        const c = this.buildChunk(k);
        this.chunks.set(k, c);
        this.group.add(c.group);
      }
    }
    for (const [k, c] of this.chunks) {
      if (k < first - 1 || k > last + 1) {
        this.group.remove(c.group);
        c.dispose();
        this.chunks.delete(k);
      }
    }
  }

  private buildChunk(k: number): Chunk {
    const d0 = k * CHUNK;
    const origin = roadPoint(d0);
    const rows = CHUNK / STEP + 1;
    const pos = new Float32Array(rows * 2 * 3);
    const uv = new Float32Array(rows * 2 * 2);
    const index: number[] = [];
    for (let r = 0; r < rows; r++) {
      const d = d0 + r * STEP;
      const p = roadPoint(d);
      const rx = -Math.sin(p.heading);
      const rz = Math.cos(p.heading);
      const y = p.y + 0.02;
      pos.set([p.x - rx * ROAD_HALF_WIDTH - origin.x, y, p.z - rz * ROAD_HALF_WIDTH - origin.z], r * 6);
      pos.set([p.x + rx * ROAD_HALF_WIDTH - origin.x, y, p.z + rz * ROAD_HALF_WIDTH - origin.z], r * 6 + 3);
      const v = d / this.layout.repeatM;
      uv.set([0, v, 1, v], r * 4);
      if (r > 0) {
        const a = (r - 1) * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.receiveShadow = true;

    const group = new THREE.Group();
    group.position.set(origin.x, 0, origin.z);
    group.add(mesh);
    const disposables: { dispose(): void }[] = [geo];

    // Marker post at the start of every chunk (every 100 m), on the right.
    const place = (obj: THREE.Object3D, d: number, side: number) => {
      const p = roadPoint(d);
      obj.position.set(p.x - Math.sin(p.heading) * side - origin.x, p.y - 0.15, p.z + Math.cos(p.heading) * side - origin.z);
      // Face back down the road towards the approaching rider.
      obj.rotation.y = Math.atan2(-Math.cos(p.heading), -Math.sin(p.heading));
      group.add(obj);
    };
    const post = new THREE.Mesh(this.postGeo, this.postMat);
    post.castShadow = true;
    place(post, d0, ROAD_HALF_WIDTH + 0.7);

    // Labelled sign every `markers.every` metres.
    const n = Math.ceil(d0 / this.markers.every);
    const signD = n * this.markers.every;
    const label = n > 0 && signD < d0 + CHUNK ? this.markers.label(n) : null;
    if (label) {
      const stage = currentStage();
      const country = signStyleOf(stage);
      const milestone = country !== 'us' ? this.buildMilestone(country, label, signD, stage.finish!) : null;
      if (milestone) place(milestone, signD, ROAD_HALF_WIDTH + 1.7);
      else place(this.buildSign(label, disposables, 'distance'), signD, ROAD_HALF_WIDTH + 2);
    }

    // Checkered finish line painted across the road.
    const finish = currentStage().finish;
    if (finish !== null && finish >= d0 && finish < d0 + CHUNK) {
      const p = roadPoint(finish);
      const line = new THREE.Mesh(this.finishGeo, this.finishMat);
      line.position.set(p.x - origin.x, p.y + 0.04, p.z - origin.z);
      line.rotation.set(0, -p.heading, Math.atan(gradeAt(finish)), 'YXZ');
      line.receiveShadow = true;
      group.add(line);
    }

    // The stage's own signs (e.g. numbered hairpins).
    for (const s of currentStage().signs) {
      if (s.numbered !== false && s.d >= d0 && s.d < d0 + CHUNK) place(this.buildSign(s.label, disposables, s.style, currentStage().hairpinWord), s.d, ROAD_HALF_WIDTH + 2);
    }

    const chunk: Chunk = {
      group,
      origin: { x: origin.x, z: origin.z },
      extra: this.extras?.addTo(group, d0, origin) ?? null,
      dispose: () => { chunk.extra?.dispose(); disposables.forEach((d) => d.dispose()); },
    };
    return chunk;
  }

  /** A cyclists' milestone for the sign at `d`: the climb, the distance to the top and the next stretch's average gradient. Null if the label isn't a countdown ("7 km to go"). */
  private buildMilestone(country: 'fr' | 'it', label: string, d: number, finish: number): THREE.Object3D | null {
    const m = /^(\d+) (\S+) to go$/.exec(label);
    if (!m) return null;
    const stage = currentStage();
    const span = Math.min(this.markers.every, finish - d);
    const text = milestoneText(country, stage.name, (finish - d) / this.markers.every, m[2], averageGrade(stage.elevationAt, d, span));
    const key = `${country}|${text.name}|${text.distance}|${text.grade}`;
    let face = this.milestoneFaces.get(key);
    if (!face) {
      const canvas = document.createElement('canvas');
      drawMilestoneFace(canvas, country, text);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      face = { tex, mat: new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }) };
      this.milestoneFaces.set(key, face);
    }
    let geo = this.milestoneGeos.get(country);
    if (!geo) this.milestoneGeos.set(country, (geo = milestoneGeometry(country)));
    const post = new THREE.Group();
    const body = new THREE.Mesh(geo, this.milestoneMat);
    body.castShadow = true;
    const plate = new THREE.Mesh(this.milestoneFaceGeo, face.mat);
    plate.position.set(0, 0.6, 0.116);
    post.add(body, plate);
    post.scale.setScalar(1.3); // a little bigger than the real ones, so it reads from the chase camera
    return post;
  }

  private buildSign(label: string, disposables: { dispose(): void }[], style: 'distance' | 'hairpin', word = 'Virage') {
    const hairpin = style === 'hairpin';
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = hairpin ? 256 : 128;
    const g = c.getContext('2d')!;
    g.fillStyle = hairpin ? '#1d3f8f' : '#1f6f43';
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = '#ffffff';
    g.lineWidth = 6;
    g.strokeRect(8, 8, c.width - 16, c.height - 16);
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (hairpin) {
      // Numbered hairpin plaque: the local word ("VIRAGE", "TORNANTE") over a big number.
      g.font = '700 34px system-ui, sans-serif';
      g.fillText(word.toUpperCase(), 128, 58, 220);
      g.font = '800 130px system-ui, sans-serif';
      g.fillText(label, 128, 160);
    } else {
      let size = 64;
      do g.font = `700 ${size}px system-ui, sans-serif`;
      while (g.measureText(label).width > 220 && (size -= 4) > 20);
      g.fillText(label, 128, 68);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const boardGeo = hairpin ? new THREE.PlaneGeometry(1.1, 1.1) : new THREE.PlaneGeometry(1.6, 0.8);
    const boardMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, side: THREE.DoubleSide });
    disposables.push(tex, boardGeo, boardMat);

    const sign = new THREE.Group();
    const board = new THREE.Mesh(boardGeo, boardMat);
    board.position.y = 2.4;
    board.castShadow = true;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 8).translate(0, 1.2, -0.03), this.signPostMat);
    disposables.push(pole.geometry);
    sign.add(board, pole);
    return sign;
  }
}
