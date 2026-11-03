import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash2 } from './noise';

// Building blocks for the procedural monuments (monuments.ts and friends): a
// `Kit` collects boxes, roofs, cylinders, tilted bars and tori, each with a flat
// colour baked in as vertex colours, and `build()` merges them into one mesh with
// one shared flat-shaded material (the look of the trees and the GLB models).
// Text for signs and plaques goes on a few textured quads (`boardMaterial`).
// Everything is authored in metres, y up, standing on y = 0, front towards +z.

export type Col = THREE.ColorRepresentation;

/** One material for every monument: vertex colours, flat shading, matt. */
export const monumentMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92 });

/**
 * The same, for things kilometres away (the Flatirons). The fog fragment code computes its
 * distance from `vFogRel`; shrinking that in the vertex shader makes the fog see the object as
 * closer, so it is hazy rather than fogged out entirely, in the scene's own haze colours.
 */
export const FAR_FOG_SCALE = 0.22;
export const farMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
farMaterial.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader.replace('#include <fog_vertex>', `#include <fog_vertex>\nvFogRel *= ${FAR_FOG_SCALE.toFixed(3)};`);
};
farMaterial.customProgramCacheKey = () => 'monument-far-fog';

const TURN4 = Math.PI / 4;

export class Kit {
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly panels: THREE.Mesh[] = [];
  private readonly stack: THREE.Matrix4[] = [new THREE.Matrix4()];

  private get top() {
    return this.stack[this.stack.length - 1];
  }

  /** Draws everything inside `draw` moved to `at` and turned by `rot` (radians about x, y, z, in that order of use: YXZ). */
  within(at: [number, number, number], rot: [number, number, number], draw: () => void) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...at),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'YXZ')),
      new THREE.Vector3(1, 1, 1),
    );
    this.stack.push(this.top.clone().multiply(m));
    draw();
    this.stack.pop();
  }

  /** Adds a geometry: coloured, darker towards its foot by `shade` (a cheap ambient occlusion), then moved by the current transform. */
  private add(geo: THREE.BufferGeometry, color: Col, shade: number, local?: THREE.Matrix4) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute('uv');
    if (local) g.applyMatrix4(local);
    g.computeBoundingBox();
    const { min, max } = g.boundingBox!;
    const span = Math.max(max.y - min.y, 1e-6);
    const c = new THREE.Color(color);
    const pos = g.attributes.position;
    const arr = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const f = shade + (1 - shade) * ((pos.getY(i) - min.y) / span);
      arr[i * 3] = c.r * f;
      arr[i * 3 + 1] = c.g * f;
      arr[i * 3 + 2] = c.b * f;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    g.applyMatrix4(this.top);
    this.geos.push(g);
    return this;
  }

  /** Adds a geometry that already carries its own vertex colours. */
  private addColoured(g: THREE.BufferGeometry) {
    g.applyMatrix4(this.top);
    this.geos.push(g);
    return this;
  }

  /** A box standing on (x, y, z), `w` wide (x), `h` tall, `d` deep (z), turned `ry` about its own centre. */
  box(w: number, h: number, d: number, x: number, y: number, z: number, color: Col, ry = 0, shade = 0.88) {
    const local = new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z);
    return this.add(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), color, shade, local);
  }

  /** A cylinder (or cone, with `rTop` near 0) standing on (x, y, z). */
  cyl(rBottom: number, rTop: number, h: number, x: number, y: number, z: number, color: Col, seg = 8, shade = 0.88) {
    return this.add(new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1).translate(0, h / 2, 0).translate(x, y, z), color, shade);
  }

  /** A four-sided pyramid (a hip or spire roof) on a `w` × `d` base, standing on (x, y, z). */
  pyramid(w: number, d: number, h: number, x: number, y: number, z: number, color: Col, ry = 0) {
    const local = new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z);
    const geo = new THREE.ConeGeometry(1, h, 4, 1, true).rotateY(TURN4).scale(w * Math.SQRT1_2, 1, d * Math.SQRT1_2).translate(0, h / 2, 0);
    return this.add(geo, color, 1, local);
  }

  /** A tapering four-sided block (a flat-iron slab, an obelisk): `w` × `t` at the foot, `k` times that at the top, `h` tall, its top shifted `skew` sideways (x). */
  taper(w: number, t: number, h: number, k: number, x: number, y: number, z: number, color: Col, shade = 0.8, skew = 0) {
    const geo = new THREE.CylinderGeometry(k, 1, h, 4, 1).rotateY(TURN4).scale(w * Math.SQRT1_2, 1, t * Math.SQRT1_2).translate(0, h / 2, 0);
    if (skew) geo.applyMatrix4(new THREE.Matrix4().makeShear(0, 0, skew / h, 0, 0, 0)); // x += skew * y / h
    geo.translate(x, y, z);
    return this.add(geo, color, shade);
  }

  /**
   * A gabled roof: the ridge runs along x, `len` long; the slopes span `span` (z) and rise `rise`.
   * The slopes are `color`; the two triangular ends (the gables) are `endColor`. Standing on (x, y, z).
   */
  gable(len: number, span: number, rise: number, x: number, y: number, z: number, color: Col, endColor: Col = color, ry = 0) {
    const l = len / 2;
    const s = span / 2;
    const slope = new THREE.Color(color);
    const end = new THREE.Color(endColor);
    // Corners: a (+x, +z) b (-x, +z) c (-x, -z) d (+x, -z) at the eaves; ridge ends e (+x) f (-x).
    const a = [l, 0, s], b = [-l, 0, s], c = [-l, 0, -s], d = [l, 0, -s], e = [l, rise, 0], f = [-l, rise, 0];
    const tris: [number[], number[], number[], THREE.Color][] = [
      [b, a, e, slope], [b, e, f, slope], // +z slope
      [d, c, f, slope], [d, f, e, slope], // -z slope
      [a, d, e, end], // +x gable
      [c, b, f, end], // -x gable
    ];
    const pos = new Float32Array(tris.length * 9);
    const col = new Float32Array(tris.length * 9);
    tris.forEach(([p, q, r, k], i) => {
      [p, q, r].forEach((v, j) => {
        pos.set(v, i * 9 + j * 3);
        // The eaves are in shadow under the overhang, the ridge catches the sun.
        const f2 = 0.86 + 0.14 * (v[1] / Math.max(rise, 1e-6));
        col.set([k.r * f2, k.g * f2, k.b * f2], i * 9 + j * 3);
      });
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    g.applyMatrix4(new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z));
    return this.addColoured(g);
  }

  /** A square bar from point a to point b, `t` thick (struts, masts, limbs). */
  bar(a: [number, number, number], b: [number, number, number], t: number, color: Col, shade = 0.9) {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const dir = vb.clone().sub(va);
    const len = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.normalize());
    const local = new THREE.Matrix4().compose(va.clone().add(vb).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    return this.add(new THREE.BoxGeometry(len, t, t), color, shade, local);
  }

  /** A ring (a wheel) in the x–y plane, centred on (x, y, z), `r` to the middle of the tube. */
  ring(r: number, tube: number, x: number, y: number, z: number, color: Col, seg = 16) {
    return this.add(new THREE.TorusGeometry(r, tube, 5, seg).translate(x, y, z), color, 0.9);
  }

  /** A textured quad (a sign face) centred on (x, y, z), facing +z, turned `ry`. */
  panel(w: number, h: number, x: number, y: number, z: number, material: THREE.Material, ry = 0) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    mesh.applyMatrix4(this.top.clone().multiply(new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z)));
    this.panels.push(mesh);
    return this;
  }

  /** Adds ready-made geometry with its own position, normal and colour attributes (a terrain-like mesh). */
  raw(g: THREE.BufferGeometry) {
    return this.addColoured(g);
  }

  /** Merges everything into one mesh (plus the textured quads). */
  build(material: THREE.Material = monumentMaterial): THREE.Group {
    const group = new THREE.Group();
    if (this.geos.length) {
      const merged = mergeGeometries(this.geos, false);
      if (!merged) throw new Error('monument parts have different attributes');
      for (const g of this.geos) g.dispose();
      group.add(new THREE.Mesh(merged, material));
    }
    for (const p of this.panels) group.add(p);
    return group;
  }
}

/** Marks a built monument for landmarks.ts: whether it casts shadows (small ones do; a mountain range would shade the valley). */
export function finish(group: THREE.Group, shadows = true): THREE.Group {
  group.userData.shadows = shadows;
  return group;
}

/** Triangles in a built monument (for the budget tests). */
export function triangleCount(obj: THREE.Object3D): number {
  let n = 0;
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry;
    n += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  return n;
}

/** Deterministic [0, 1) for part `i` of a monument seeded `seed`. */
export const rnd = (seed: number, i: number) => hash2(seed * 7919 + 13, i * 104729 + 7);

/** `a` shifted toward `b` by `t` (sRGB hex strings in, hex string out) for lightening and darkening a palette colour. */
export function mix(a: string, b: string, t: number): string {
  return `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
}

// ------------------------------------------------------------ text boards ----

const boards = new Map<string, THREE.MeshStandardMaterial>();

/**
 * A material showing something drawn on a canvas (cached by `key`, so the same words are drawn once).
 * Without a DOM (the unit tests) it is a plain `fallback` colour.
 */
export function boardMaterial(key: string, width: number, height: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, fallback: Col): THREE.MeshStandardMaterial {
  let m = boards.get(key);
  if (m) return m;
  if (typeof document === 'undefined') {
    m = new THREE.MeshStandardMaterial({ color: fallback, roughness: 0.7 });
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    draw(canvas.getContext('2d')!, width, height);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
  }
  boards.set(key, m);
  return m;
}

/** Centred text at `y`, shrunk (down to a floor) until it fits `maxW`. */
export function fitText(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, size: number, weight = 800, family = 'system-ui, sans-serif') {
  let s = size;
  do g.font = `${weight} ${s}px ${family}`;
  while (g.measureText(text).width > maxW && (s -= 2) > 12);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, x, y);
}
