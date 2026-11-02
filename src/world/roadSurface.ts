import * as THREE from 'three';
import type { SceneryTier } from './scenery';
import { HORIZON_COLOR } from './sky';

// The road's asphalt detail and its wet look.
//
// - A normal map (CC0, public/textures/asphalt-n.jpg, Medium and up) is tiled into a
//   canvas laid out exactly like the colour map, with the painted lines left flat
//   so they stay crisp. A roughness map is derived from it (rougher where the grain
//   is bumpier, shinier in the wheel tracks, paint a little smoother than stone).
// - In the rain, patches (a noise mask over the road) go nearly mirror-smooth, darker
//   and flat: with sky reflections (High and up, the environment map) they show the
//   sky; on Low and Medium a cheap fresnel term adds the horizon colour instead.
//   `setWet()` drives it from the weather.

// Layout of the 512 × 512 road texture (it spans the road from shoulder to shoulder).
export const ROAD_TEX = 512;
export const SHOULDER_PX = 44;
export const EDGE_LINES = [58, 445]; // x of each 9 px edge line
export const CENTRE_LINES = [247, 258]; // x of each 7 px dashed centre line (200 px dashes)

export class RoadSurface {
  private readonly uniforms = {
    uPuddle: { value: 0 },
    uSky: { value: HORIZON_COLOR },
    uNoEnv: { value: 1 },
  };
  private detail: { normal: THREE.CanvasTexture; rough: THREE.CanvasTexture } | null = null;
  private loading = false;

  /** Takes over the road's own material: the colour map (with the painted lines) stays; this adds the normal and roughness maps and the puddles. */
  constructor(private readonly material: THREE.MeshStandardMaterial, private readonly map: THREE.Texture, private readonly maxAniso: number) {
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${DECL}`)
        .replace('#include <map_fragment>', `#include <map_fragment>\n${PUDDLE}\ndiffuseColor.rgb *= 1.0 - 0.5 * afPud;`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.035, afPud);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\nnormal = normalize(mix(normal, nonPerturbedNormal, afPud * 0.92));`)
        .replace('#include <opaque_fragment>', `
        {
          // No environment map (Low, Medium): a puddle still mirrors the sky, with a fresnel falloff.
          float afF = 0.04 + 0.96 * pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 4.0);
          outgoingLight += uSky * afPud * afF * uNoEnv * 0.4;
        }
        #include <opaque_fragment>`);
    };
    this.material.customProgramCacheKey = () => 'af-road-1';
    this.material.needsUpdate = true;
  }

  /** Applies the tier: filtering, whether the sky is in the environment map, and the asphalt detail maps. */
  setTier(spec: SceneryTier, ibl: boolean) {
    this.uniforms.uNoEnv.value = ibl ? 0 : 1;
    const aniso = Math.min(spec.anisotropy, this.maxAniso);
    this.map.anisotropy = aniso;
    if (this.detail) { this.detail.normal.anisotropy = aniso; this.detail.rough.anisotropy = aniso; }
    if (spec.roadDetail) void this.loadDetail(aniso);
    else this.useDetail(false);
  }

  /** Rain: 0 dry … 1 soaked (Road.setWet darkens and glosses the material; this grows the puddles). */
  setWet(wet: number) {
    this.uniforms.uPuddle.value = Math.min(1, Math.max(0, (wet - 0.15) / 0.5));
  }

  private useDetail(on: boolean) {
    const m = this.material;
    const want = on && this.detail;
    if (!!m.normalMap === !!want) return;
    m.normalMap = want ? this.detail!.normal : null;
    m.roughnessMap = want ? this.detail!.rough : null;
    m.normalScale.set(0.9, 0.9);
    m.needsUpdate = true;
  }

  private async loadDetail(aniso: number) {
    if (this.detail) { this.useDetail(true); return; }
    if (this.loading) return;
    this.loading = true;
    try {
      const img = new Image();
      img.src = `${import.meta.env.BASE_URL}textures/asphalt-n.jpg`;
      await img.decode();
      this.detail = buildDetail(img, aniso);
      this.useDetail(true);
    } catch { /* offline: the road keeps its plain look */ }
    this.loading = false;
  }
}

function buildDetail(img: HTMLImageElement, aniso: number) {
  const S = ROAD_TEX;
  const nc = document.createElement('canvas');
  nc.width = nc.height = S;
  const g = nc.getContext('2d', { willReadFrequently: true })!;
  for (let x = 0; x < S; x += S / 2) for (let y = 0; y < S; y += S / 2) g.drawImage(img, x, y, S / 2, S / 2); // tiled 2 × 2, like the colour
  const px = g.getImageData(0, 0, S, S);
  const d = px.data;

  // Roughness from the grain, before the flat marks go on.
  const rc = document.createElement('canvas');
  rc.width = rc.height = S;
  const rg = rc.getContext('2d')!;
  const rp = rg.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const bump = Math.hypot(d[i] - 128, d[i + 1] - 128) / 128;
      let r = 0.8 + (bump - 0.12) * 0.7;
      // Two wheel tracks in each lane: polished by tyres, so shinier (and, wet, the first to gleam).
      const lat = ((x + 0.5) / S) * 9.2 - 4.6;
      const track = Math.min(Math.abs(Math.abs(lat) - 1.5), Math.abs(Math.abs(lat) - 2.9));
      r -= 0.12 * Math.max(0, 1 - track / 0.45);
      const v = Math.round(Math.min(0.97, Math.max(0.45, r)) * 255);
      rp.data[i] = rp.data[i + 1] = rp.data[i + 2] = v;
      rp.data[i + 3] = 255;
    }
  }
  rg.putImageData(rp, 0, 0);

  // Painted lines and gravel shoulders: flat normals, paint a touch smoother than stone, gravel rougher.
  const marks = (ctx: CanvasRenderingContext2D, line: string, gravel: string) => {
    ctx.fillStyle = gravel;
    ctx.fillRect(0, 0, SHOULDER_PX, S);
    ctx.fillRect(S - SHOULDER_PX, 0, SHOULDER_PX, S);
    ctx.fillStyle = line;
    for (const x of EDGE_LINES) ctx.fillRect(x, 0, 9, S);
    for (const x of CENTRE_LINES) ctx.fillRect(x, 0, 7, 200);
  };
  g.globalAlpha = 0.85;
  marks(g, '#8080ff', '#8080ff'); // (0.5, 0.5, 1): straight up
  g.globalAlpha = 1;
  rg.globalAlpha = 0.9;
  marks(rg, '#a8a8a8', '#f2f2f2');
  rg.globalAlpha = 1;

  const normal = new THREE.CanvasTexture(nc);
  const rough = new THREE.CanvasTexture(rc);
  for (const t of [normal, rough]) {
    t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    t.colorSpace = THREE.NoColorSpace;
  }
  return { normal, rough };
}

const DECL = /* glsl */ `
uniform float uPuddle;
uniform vec3 uSky;
uniform float uNoEnv;
float afRh(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float afRn(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(afRh(i), afRh(i + vec2(1.0, 0.0)), f.x), mix(afRh(i + vec2(0.0, 1.0)), afRh(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

// Puddle mask: noise over the road, in metres (the map's v runs one road width per repeat). More rain, more and bigger puddles.
const PUDDLE = /* glsl */ `
float afPud = 0.0;
if (uPuddle > 0.001) {
  vec2 afQ = vMapUv * 9.2;
  float afN = 0.6 * afRn(afQ / vec2(2.6, 3.4)) + 0.4 * afRn(afQ / vec2(0.9, 1.2) + 7.7);
  afPud = smoothstep(0.70 - 0.15 * uPuddle, 0.80 - 0.15 * uPuddle, afN) * uPuddle;
}
`;
