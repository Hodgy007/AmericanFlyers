import * as THREE from 'three';
import { LAYER_COUNT, layersFor, type SceneryTier } from './scenery';

// Terrain texture splatting. The terrain keeps its per-vertex colour (the stage's
// own palette: grass, fields, rock, snow, red sandstone) and gains two small
// vertex attributes, `aWa` and `aWb`: how much of each of eight ground layers is
// here. The fragment shader reads the layers from one texture array and lays
// their *detail* (the texture divided by its own average) over the vertex colour,
// so every stage still looks like itself, only with grain instead of flat paint.
//
//   layer   0 grass   1 dry grass   2 dirt   3 rock   4 snow   5 sandstone   6 sand   7 scree
//
// - Rock is triplanar (cliffs don't stretch) and also takes over any steep pixel,
//   judged per pixel from the smooth normal, so a cliff is rock whatever the
//   vertex weights said.
// - A large-scale noise tint breaks up the tiling from a distance.
// - Detail normal maps (High and up) come from a second texture array.
// - Textures are CC0 (see public/textures/README.md), fetched lazily after the
//   first frame, one JPEG per layer. Until they arrive `uAfMix` is 0 and the
//   plain vertex colours show. Only the layers a stage can show are fetched
//   (no sandstone on the Alpe, no snow in Heartland, no scree off Ventoux), and Low fetches three.

const FILES = ['grass', 'dry', 'dirt', 'rock', 'snow', 'sandstone', 'sand', 'scree'];
/** Metres of ground one repeat of each layer covers. */
const SCALE = [5, 5, 4, 6, 6, 6, 4, 4];
/** How much of each layer's grain to keep (snow's trampled dark patches, for one, would read as dirt). */
const CONTRAST = [1.9, 1.6, 1.4, 1.3, 0.6, 1.3, 1.2, 1];
/** How hard each layer's normal map pushes. */
const NORMAL = [0.7, 0.6, 0.6, 1, 0.3, 0.8, 0.6, 0.9];

interface Decoded {
  rgba: Uint8ClampedArray;
  avg: [number, number, number];
}

async function decode(url: string, size: number): Promise<Decoded> {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, size, size); // shrinks 1K files to 512 on Low
  const rgba = g.getImageData(0, 0, size, size).data;
  let r = 0, gr = 0, b = 0, n = 0;
  for (let i = 0; i < rgba.length; i += 64) { r += rgba[i]; gr += rgba[i + 1]; b += rgba[i + 2]; n++; }
  return { rgba, avg: [r / n / 255, gr / n / 255, b / n / 255] };
}

const yieldToBrowser = () => new Promise<void>((res) => setTimeout(res, 0));

export class GroundTextures {
  /** Shared by the terrain material: the shader reads these. */
  readonly uniforms = {
    uAfAlb: { value: null as THREE.DataArrayTexture | null },
    uAfNrm: { value: null as THREE.DataArrayTexture | null },
    uAfMix: { value: 0 },
    uAfNormals: { value: 0 },
    uAfTri: { value: 1 },
    uAfLow: { value: 0 },
    uAfAvg: { value: Array.from({ length: LAYER_COUNT }, () => new THREE.Vector3(0.5, 0.5, 0.5)) },
    uAfScale: { value: SCALE.slice() },
    uAfContrast: { value: CONTRAST.slice() },
    uAfNorm: { value: NORMAL.slice() },
  };
  private size = 0;
  private readonly albData = new Map<number, Decoded>();
  private readonly nrmData = new Map<number, Uint8ClampedArray>();
  private gen = 0;
  private busy = false;
  private again = false;
  private spec: SceneryTier | null = null;
  private desert = false;
  private snow = false;
  private scree = false;

  constructor(private readonly maxAniso: number) {
    // For tests and screenshots: what has been fetched, and whether the shader is using it yet.
    Object.defineProperty(window, '__afGround', { configurable: true, get: () => ({ mix: this.uniforms.uAfMix.value, layers: [...this.albData.keys()].sort(), normals: this.nrmData.size, size: this.size, loading: this.busy }) });
  }

  /** Applies the tier's switches now, and fetches what that tier and stage need and don't have yet. */
  request(spec: SceneryTier, desert: boolean, snow: boolean, scree: boolean) {
    this.spec = spec;
    this.desert = desert;
    this.snow = snow;
    this.scree = scree;
    const u = this.uniforms;
    u.uAfNormals.value = spec.detailNormals ? 1 : 0;
    u.uAfTri.value = spec.triplanar ? 1 : 0;
    u.uAfLow.value = spec.terrainLayers === 3 ? 1 : 0;
    for (const t of [u.uAfAlb.value, u.uAfNrm.value]) if (t) t.anisotropy = Math.min(spec.anisotropy, this.maxAniso);
    void this.load();
  }

  private async load() {
    if (this.busy) { this.again = true; return; }
    const spec = this.spec;
    if (!spec) return;
    this.busy = true;
    const gen = ++this.gen;
    try {
      const size = Math.max(this.size, spec.terrainTexSize); // a bigger set is never shrunk again
      if (size !== this.size) { this.albData.clear(); this.nrmData.clear(); this.size = size; }
      const want = layersFor(this.desert, this.snow, spec.terrainLayers, this.scree);
      const base = `${import.meta.env.BASE_URL}textures/terrain/`;
      let changed = false;
      for (const i of want) {
        if (!this.albData.has(i)) { this.albData.set(i, await decode(`${base}${FILES[i]}.jpg`, size)); changed = true; await yieldToBrowser(); }
        if (spec.detailNormals && !this.nrmData.has(i)) {
          this.nrmData.set(i, (await decode(`${base}${FILES[i]}-n.jpg`, Math.min(size, 512))).rgba);
          changed = true;
          await yieldToBrowser();
        }
      }
      if (changed && gen === this.gen) this.build(size, spec.detailNormals);
    } catch {
      /* offline or a missing file: the vertex colours keep showing */
    }
    this.busy = false;
    if (this.again) { this.again = false; void this.load(); }
  }

  private build(size: number, normals: boolean) {
    const u = this.uniforms;
    const alb = new Uint8Array(size * size * 4 * LAYER_COUNT).fill(128);
    for (const [i, d] of this.albData) {
      alb.set(d.rgba, i * size * size * 4);
      u.uAfAvg.value[i].set(Math.max(0.04, d.avg[0]), Math.max(0.04, d.avg[1]), Math.max(0.04, d.avg[2]));
    }
    u.uAfAlb.value?.dispose();
    u.uAfAlb.value = this.array(alb, size);
    if (normals && this.nrmData.size) {
      const n = Math.min(size, 512);
      const nrm = new Uint8Array(n * n * 4 * LAYER_COUNT).fill(128); // layers not fetched stay flat: 128 unpacks to a zero tilt
      for (const [i, d] of this.nrmData) nrm.set(d, i * n * n * 4);
      u.uAfNrm.value?.dispose();
      u.uAfNrm.value = this.array(nrm, n);
    }
    u.uAfMix.value = 1;
  }

  private array(data: Uint8Array, size: number) {
    const t = new THREE.DataArrayTexture(data, size, size, LAYER_COUNT);
    t.format = THREE.RGBAFormat;
    t.type = THREE.UnsignedByteType;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = Math.min(this.spec?.anisotropy ?? 1, this.maxAniso);
    t.colorSpace = THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  }

  dispose() {
    this.uniforms.uAfAlb.value?.dispose();
    this.uniforms.uAfNrm.value?.dispose();
  }
}

// ----------------------------------------------------------------- shader ----

const VERT_DECL = /* glsl */ `
attribute vec4 aWa;
attribute vec4 aWb;
varying vec4 vWa;
varying vec4 vWb;
varying vec3 vAfW;
varying vec3 vAfN;
`;

const VERT_BODY = /* glsl */ `
vWa = aWa;
vWb = aWb;
vAfW = (modelMatrix * vec4(transformed, 1.0)).xyz;
vAfN = normalize(mat3(modelMatrix) * objectNormal);
`;

const FRAG_DECL = /* glsl */ `
uniform highp sampler2DArray uAfAlb;
uniform highp sampler2DArray uAfNrm;
uniform float uAfMix;
uniform float uAfNormals;
uniform float uAfTri;
uniform float uAfLow;
uniform vec3 uAfAvg[8];
uniform float uAfScale[8];
uniform float uAfContrast[8];
uniform float uAfNorm[8];
varying vec4 vWa;
varying vec4 vWb;
varying vec3 vAfW;
varying vec3 vAfN;

float agHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float agNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(agHash(i), agHash(i + vec2(1.0, 0.0)), f.x), mix(agHash(i + vec2(0.0, 1.0)), agHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// A layer's grain as a multiplier near 1: its colour over its own average, a little greyed, scaled by the layer's contrast.
vec3 afRatio(int i, vec3 rgb, float fade) {
  vec3 r = rgb / uAfAvg[i];
  float l = dot(r, vec3(0.299, 0.587, 0.114));
  r = mix(vec3(l), r, 0.55);
  return 1.0 + (r - 1.0) * uAfContrast[i] * fade;
}
vec3 afAlb(int i, vec2 uv, vec2 dx, vec2 dy, float fade) {
  float s = uAfScale[i];
  return afRatio(i, textureGrad(uAfAlb, vec3(uv / s, float(i)), dx / s, dy / s).rgb, fade);
}
vec3 afNrm(int i, vec2 uv, vec2 dx, vec2 dy) {
  float s = uAfScale[i];
  return textureGrad(uAfNrm, vec3(uv / s, float(i)), dx / s, dy / s).xyz * 2.0 - 1.0;
}
// Final layer weights: the vertex weights, steep ground turned to rock, and Low's three layers.
void afWeights(float n_y, out float w[8]) {
  w[0] = vWa.x; w[1] = vWa.y; w[2] = vWa.z; w[3] = vWa.w; w[4] = vWb.x; w[5] = vWb.y; w[6] = vWb.z; w[7] = vWb.w;
  float steep = 1.0 - smoothstep(0.66, 0.82, n_y);
  for (int i = 0; i < 8; i++) w[i] *= (1.0 - steep);
  w[3] += steep;
  if (uAfLow > 0.5) { w[0] += w[1] + w[2]; w[1] = 0.0; w[2] = 0.0; w[5] += w[6]; w[6] = 0.0; }
  float sum = 0.0;
  for (int i = 0; i < 8; i++) sum += w[i];
  for (int i = 0; i < 8; i++) w[i] /= max(sum, 0.0001);
}
`;

// After <color_fragment>: lay the textures' grain over the vertex colour.
const FRAG_ALBEDO = /* glsl */ `
vec3 afN = normalize(vAfN);
float afW[8];
if (uAfMix > 0.001) {
  afWeights(afN.y, afW);
  vec3 afP = vAfW;
  vec2 afUv = afP.xz;
  vec2 afDx = dFdx(afUv);
  vec2 afDy = dFdy(afUv);
  float afFade = 1.0 - smoothstep(160.0, 600.0, length(vViewPosition));
  vec3 afAcc = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    if (i == 3 || afW[i] < 0.01) continue;
    vec3 afG = afAlb(i, afUv, afDx, afDy, afFade);
    // A second look at the same layer at a fifth of the scale (about 25 m a repeat): mottling that still shows from afar, and tiling that doesn't.
    if (uAfTri > 0.5) afG *= afAlb(i, afUv * 0.2 + vec2(0.37, 0.11), afDx * 0.2, afDy * 0.2, 1.0);
    afAcc += afW[i] * afG;
  }
  if (afW[3] > 0.01) {
    vec3 w = pow(abs(afN), vec3(4.0));
    w /= (w.x + w.y + w.z);
    vec3 rock;
    vec3 pdx = dFdx(afP);
    vec3 pdy = dFdy(afP);
    if (uAfTri > 0.5) {
      rock = w.x * afAlb(3, afP.zy, pdx.zy, pdy.zy, afFade) + w.y * afAlb(3, afP.xz, pdx.xz, pdy.xz, afFade) + w.z * afAlb(3, afP.xy, pdx.xy, pdy.xy, afFade);
    } else {
      bool sx = abs(afN.x) > abs(afN.z);
      vec2 su = sx ? afP.zy : afP.xy;
      vec2 sdx = sx ? pdx.zy : pdx.xy;
      vec2 sdy = sx ? pdy.zy : pdy.xy;
      rock = (w.y) * afAlb(3, afP.xz, pdx.xz, pdy.xz, afFade) + (1.0 - w.y) * afAlb(3, su, sdx, sdy, afFade);
    }
    // Rock faces: strata and weathering at a few metres, from noise along the face, so cliffs aren't smooth from afar.
    rock *= 0.72 + 0.56 * (0.55 * agNoise(vec2(afP.x + afP.z, afP.y * 1.6) / 4.5) + 0.45 * agNoise(vec2(afP.x - afP.z, afP.y * 0.7) / 13.0 + 5.0));
    afAcc += afW[3] * rock;
  }
  // Large-scale tint: tiling doesn't show from a distance.
  float afMacro = 0.62 * agNoise(afP.xz / 90.0) + 0.38 * agNoise(afP.xz / 26.0 + 11.3);
  afAcc *= mix(1.0, 0.8 + 0.4 * afMacro, 0.6 * afFade + 0.3);
  diffuseColor.rgb *= afAcc;
}
`;

// After <normal_fragment_maps>: the layers' detail normals (High and up).
const FRAG_NORMAL = /* glsl */ `
if (uAfMix > 0.001 && uAfNormals > 0.5) {
  vec3 afN0 = afN;
  vec2 afUv0 = vAfW.xz;
  vec2 afDx0 = dFdx(afUv0);
  vec2 afDy0 = dFdy(afUv0);
  vec3 afT = normalize(vec3(1.0, 0.0, 0.0) - afN0 * afN0.x);
  vec3 afB = cross(afN0, afT);
  vec2 afXY = vec2(0.0);
  for (int i = 0; i < 8; i++) {
    if (i == 3 || afW[i] < 0.02) continue;
    afXY += afW[i] * uAfNorm[i] * afNrm(i, afUv0, afDx0, afDy0).xy;
  }
  vec3 afNew = afN0 + afT * afXY.x + afB * afXY.y;
  if (afW[3] > 0.02) {
    // Whiteout triplanar blend of the rock's normal map.
    vec3 w = pow(abs(afN0), vec3(4.0));
    w /= (w.x + w.y + w.z);
    vec3 p = vAfW;
    vec3 pdx = dFdx(p);
    vec3 pdy = dFdy(p);
    vec3 tx = afNrm(3, p.zy, pdx.zy, pdy.zy);
    vec3 ty = afNrm(3, p.xz, pdx.xz, pdy.xz);
    vec3 tz = afNrm(3, p.xy, pdx.xy, pdy.xy);
    tx = vec3(tx.xy + afN0.zy, abs(tx.z) * afN0.x);
    ty = vec3(ty.xy + afN0.xz, abs(ty.z) * afN0.y);
    tz = vec3(tz.xy + afN0.xy, abs(tz.z) * afN0.z);
    vec3 rockN = normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
    afNew += (rockN - afN0) * afW[3] * uAfNorm[3];
  }
  float afFadeN = 1.0 - smoothstep(60.0, 260.0, length(vViewPosition));
  afNew = normalize(mix(afN0, afNew, afFadeN));
  normal = normalize((viewMatrix * vec4(afNew, 0.0)).xyz);
}
`;

/** Gives a MeshStandardMaterial the splatting shader. The vertex colour stays; see the top of the file. */
export function patchGroundMaterial(mat: THREE.MeshStandardMaterial, tex: GroundTextures) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, tex.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_DECL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_DECL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_ALBEDO}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAG_NORMAL}`);
  };
  mat.customProgramCacheKey = () => 'af-ground-2';
}
