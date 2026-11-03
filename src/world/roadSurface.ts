import * as THREE from 'three';
import type { SceneryTier } from './scenery';
import { RAGGED_ROW, ROAD_TEX_WIDTH, raggedEdge, roadPaintLayout, type RoadPaintLayout } from './roadStyle';
import { HORIZON_COLOR } from './sky';

// The road's asphalt detail and its wet look.
//
// - A normal map (CC0, public/textures/asphalt-n.jpg, Medium and up) is tiled into a
//   canvas laid out exactly like the colour map (the stage's road style, roadStyle.ts),
//   with the painted lines left flat so they stay crisp. A roughness map is derived from it (rougher where the grain
//   is bumpier, shinier in the wheel tracks, paint a little smoother than stone).
// - In the rain, patches (a noise mask over the road) go nearly mirror-smooth, darker
//   and flat: with sky reflections (High and up, the environment map) they show the
//   sky; on Low and Medium a cheap fresnel term adds the horizon colour instead.
//   `setWet()` drives it from the weather.

export class RoadSurface {
  private readonly uniforms = {
    uPuddle: { value: 0 },
    uSky: { value: HORIZON_COLOR },
    uNoEnv: { value: 1 },
    uRepeat: { value: 9.2 }, // metres of road per repeat of the map
  };
  private detail: { normal: THREE.CanvasTexture; rough: THREE.CanvasTexture } | null = null;
  private img: HTMLImageElement | null = null; // the normal photo, kept to redraw the maps for another road style
  private layout: RoadPaintLayout = roadPaintLayout('us-highway');
  private aniso = 1;
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
    this.material.customProgramCacheKey = () => 'af-road-2';
    this.material.needsUpdate = true;
  }

  /** Another road style (a new stage): the maps are redrawn to match the colour map's paint. */
  setLayout(layout: RoadPaintLayout) {
    if (layout === this.layout) return;
    this.layout = layout;
    this.uniforms.uRepeat.value = layout.repeatM;
    if (!this.detail || !this.img) return;
    const old = this.detail;
    this.detail = buildDetail(this.img, this.aniso, layout);
    if (this.material.normalMap === old.normal) {
      this.material.normalMap = this.detail.normal;
      this.material.roughnessMap = this.detail.rough;
    }
    old.normal.dispose();
    old.rough.dispose();
  }

  /** Applies the tier: filtering, whether the sky is in the environment map, and the asphalt detail maps. */
  setTier(spec: SceneryTier, ibl: boolean) {
    this.uniforms.uNoEnv.value = ibl ? 0 : 1;
    const aniso = Math.min(spec.anisotropy, this.maxAniso);
    this.aniso = aniso;
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
      this.img = img;
      this.detail = buildDetail(img, aniso, this.layout);
      this.useDetail(true);
    } catch { /* offline: the road keeps its plain look */ }
    this.loading = false;
  }
}

function buildDetail(img: HTMLImageElement, aniso: number, layout: RoadPaintLayout) {
  const S = ROAD_TEX_WIDTH;
  const H = layout.height;
  const nc = document.createElement('canvas');
  nc.width = S;
  nc.height = H;
  const g = nc.getContext('2d', { willReadFrequently: true })!;
  for (let x = 0; x < S; x += S / 2) for (let y = 0; y < H; y += S / 2) g.drawImage(img, x, y, S / 2, S / 2); // tiled like the colour map
  const px = g.getImageData(0, 0, S, H);
  const d = px.data;

  // Roughness from the grain, before the flat marks go on.
  const rc = document.createElement('canvas');
  rc.width = S;
  rc.height = H;
  const rg = rc.getContext('2d')!;
  const rp = rg.createImageData(S, H);
  for (let y = 0; y < H; y++) {
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

  // Painted lines and gravel or dust shoulders: flat normals, paint a touch smoother than stone, gravel rougher.
  const marks = (ctx: CanvasRenderingContext2D, line: string, gravel: string) => {
    if (layout.edge?.flat) {
      ctx.fillStyle = gravel;
      for (const b of layout.edge.bands) {
        ctx.fillRect(b.from, 0, b.to - b.from, H);
        ctx.fillRect(S - b.to, 0, b.to - b.from, H);
      }
    }
    ctx.fillStyle = line;
    for (const m of layout.paint) ctx.fillRect(m.x, m.y, m.w, m.h);
  };
  g.globalAlpha = 0.85;
  marks(g, '#8080ff', '#8080ff'); // (0.5, 0.5, 1): straight up
  g.globalAlpha = 1;
  rg.globalAlpha = 0.9;
  marks(rg, '#a8a8a8', '#f2f2f2');
  rg.globalAlpha = 1;
  // A lane's ragged edges are loose gravel and moss rather than asphalt: rougher, the normals left alone.
  if (layout.ragged) {
    rg.fillStyle = '#e6e6e6';
    for (const side of [0, 1] as const) raggedEdge(layout, side).forEach((w, r) => rg.fillRect(side === 0 ? 0 : S - w, r * RAGGED_ROW, w, RAGGED_ROW));
  }

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
uniform float uRepeat;
float afRh(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float afRn(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(afRh(i), afRh(i + vec2(1.0, 0.0)), f.x), mix(afRh(i + vec2(0.0, 1.0)), afRh(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

// Puddle mask: noise over the road, in metres (the map's v runs `uRepeat` metres per repeat). More rain, more and bigger puddles.
const PUDDLE = /* glsl */ `
float afPud = 0.0;
if (uPuddle > 0.001) {
  vec2 afQ = vMapUv * vec2(9.2, uRepeat);
  float afN = 0.6 * afRn(afQ / vec2(2.6, 3.4)) + 0.4 * afRn(afQ / vec2(0.9, 1.2) + 7.7);
  afPud = smoothstep(0.70 - 0.15 * uPuddle, 0.80 - 0.15 * uPuddle, afN) * uPuddle;
}
`;
