import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { currentStage, roadPoint } from '../course';

const CHUNK = 100; // metres of road per mesh
const STEP = 2;
export const ROAD_HALF_WIDTH = 4.6;
const TEXTURE_REPEAT_M = ROAD_HALF_WIDTH * 2; // square texels: one texture length = road width
const BEHIND = 150;
const AHEAD = 1600;

export interface MarkerConfig {
  every: number; // metres between labelled signs
  label: (n: number) => string | null; // null skips that sign
}

// The road texture spans the full road width (shoulder to shoulder) and one
// road-width of length, 512 × 512 px. The asphalt photo-texture is tiled 2 × 2
// underneath; until it loads, a flat grey stands in.
function roadTexture(renderer: THREE.WebGLRenderer): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d')!;
  const tex = new THREE.CanvasTexture(c);
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const paint = (asphalt?: HTMLImageElement) => {
    if (asphalt) {
      for (let x = 0; x < 512; x += 256) for (let y = 0; y < 512; y += 256) g.drawImage(asphalt, x, y, 256, 256);
    } else {
      g.fillStyle = '#3d4048';
      g.fillRect(0, 0, 512, 512);
    }
    // Gravel shoulders over the outer 0.8 m each side.
    g.fillStyle = 'rgba(125, 116, 98, 0.85)';
    g.fillRect(0, 0, 44, 512);
    g.fillRect(468, 0, 44, 512);
    // Slightly worn edge lines and a dashed double centre line.
    g.globalAlpha = 0.9;
    g.fillStyle = '#eef0f2';
    g.fillRect(58, 0, 9, 512);
    g.fillRect(445, 0, 9, 512);
    g.fillStyle = '#f2c14e';
    g.fillRect(247, 0, 7, 200);
    g.fillRect(258, 0, 7, 200);
    g.globalAlpha = 1;
    tex.needsUpdate = true;
  };
  paint();
  const img = new Image();
  img.onload = () => paint(img);
  img.src = `${import.meta.env.BASE_URL}textures/asphalt.jpg`;
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
  dispose(): void;
}

export class Road {
  readonly group = new THREE.Group();
  private readonly chunks = new Map<number, Chunk>();
  private readonly material: THREE.MeshStandardMaterial;
  private readonly postGeo = postGeometry();
  private readonly postMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
  private readonly signPostMat = new THREE.MeshStandardMaterial({ color: '#8a8f99', roughness: 0.5, metalness: 0.4 });

  constructor(renderer: THREE.WebGLRenderer, private markers: MarkerConfig) {
    this.material = new THREE.MeshStandardMaterial({
      map: roadTexture(renderer),
      roughness: 0.92,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  }

  setMarkers(markers: MarkerConfig) {
    this.markers = markers;
    for (const [k, c] of this.chunks) {
      this.group.remove(c.group);
      c.dispose();
      this.chunks.delete(k);
    }
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
      const v = d / TEXTURE_REPEAT_M;
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
    if (label) place(this.buildSign(label, disposables, 'distance'), signD, ROAD_HALF_WIDTH + 2);

    // The stage's own signs (e.g. numbered hairpins).
    for (const s of currentStage().signs) {
      if (s.d >= d0 && s.d < d0 + CHUNK) place(this.buildSign(s.label, disposables, s.style), s.d, ROAD_HALF_WIDTH + 2);
    }

    return { group, dispose: () => disposables.forEach((d) => d.dispose()) };
  }

  private buildSign(label: string, disposables: { dispose(): void }[], style: 'distance' | 'hairpin') {
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
      // Numbered hairpin plaque: "VIRAGE" over a big number.
      g.font = '700 34px system-ui, sans-serif';
      g.fillText('VIRAGE', 128, 58);
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
