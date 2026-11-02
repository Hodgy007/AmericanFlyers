// Graphics quality: the four tiers and what each one switches on, picking a tier
// for a device (Auto), and the controller that lowers it, or the render scale,
// when frames run slow. Pure logic, no WebGL: the Graphics class (graphics.ts)
// applies the result, and tests/unit/quality.test.ts covers the decisions.

export type Tier = 'low' | 'medium' | 'high' | 'ultra';
export type GraphicsChoice = Tier | 'auto';
export const TIERS: readonly Tier[] = ['low', 'medium', 'high', 'ultra'];
export const CHOICES: readonly GraphicsChoice[] = ['auto', ...TIERS];

export interface TierSpec {
  maxPixelRatio: number;
  shadowSize: number; // shadow map side, px
  shadowRadius: number; // PCF blur, in shadow-map texels
  shadowBox: number; // half-width of the shadow box round the rider, m
  post: boolean; // bloom + colour grade + anti-aliasing (the lazily loaded post chunk)
  bloom: number; // 0 off, else the bloom chain's size relative to the frame (0.5 = half)
  aa: 'none' | 'fxaa' | 'smaa';
  ao: number; // 0 off, else the ambient-occlusion buffer's size relative to the frame
  ibl: boolean; // sky reflections (a PMREM environment from the sky)
  cloudShadows: boolean;
  skyQuality: 0 | 1 | 2; // cloud octaves: 3 / 4 / 5
}

export const TIER_SPECS: Record<Tier, TierSpec> = {
  low: { maxPixelRatio: 1, shadowSize: 1024, shadowRadius: 1, shadowBox: 30, post: false, bloom: 0, aa: 'none', ao: 0, ibl: false, cloudShadows: false, skyQuality: 0 },
  medium: { maxPixelRatio: 1.5, shadowSize: 2048, shadowRadius: 1, shadowBox: 30, post: true, bloom: 0.5, aa: 'fxaa', ao: 0, ibl: false, cloudShadows: false, skyQuality: 1 },
  high: { maxPixelRatio: 2, shadowSize: 2048, shadowRadius: 2, shadowBox: 30, post: true, bloom: 1, aa: 'smaa', ao: 0.5, ibl: true, cloudShadows: true, skyQuality: 2 },
  ultra: { maxPixelRatio: 2, shadowSize: 4096, shadowRadius: 1.6, shadowBox: 38, post: true, bloom: 2, aa: 'smaa', ao: 0.75, ibl: true, cloudShadows: true, skyQuality: 2 },
};

/** Render scales the controller steps through (fractions of the pixel ratio the tier allows). */
export const SCALES: readonly number[] = [1, 0.85, 0.7];

export function isChoice(v: unknown): v is GraphicsChoice {
  return typeof v === 'string' && (CHOICES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------- storage ----

const KEY = 'americanflyers.graphics';

/** The device's saved choice. Per device on purpose (a phone and a TV need different answers): not part of the synced Settings. */
export function loadChoice(): GraphicsChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (isChoice(v)) return v;
  } catch { /* storage unavailable: Auto */ }
  return 'auto';
}

export function saveChoice(c: GraphicsChoice) {
  try {
    if (c === 'auto') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, c);
  } catch { /* not remembered */ }
}

// ------------------------------------------------------------------- auto ----

export interface Signals {
  cores?: number; // navigator.hardwareConcurrency
  memoryGb?: number; // navigator.deviceMemory (capped at 8 by browsers)
  width: number; // CSS px
  height: number;
  dpr: number;
  gpu?: string; // WEBGL_debug_renderer_info's renderer string
  touch?: boolean; // a touch screen as the main pointer: phone, tablet, some TVs
}

const SOFTWARE = /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render/i;
const MOBILE_GPU = /mali|adreno|powervr|apple gpu|tegra|immortalis|xclipse/i;
const WEAK_PC_GPU = /intel.*(hd graphics|uhd|iris)|radeon (r[2-7]|hd|vega [3-8]\b)|geforce (gt |9|8)|virgl/i;
const STRONG_GPU = /rtx ?(20[6-8]|[345]0\d\d)|rx ?(5[67]00|[679]\d00)|apple m\d (pro|max|ultra)|arc ?[ab][5-9]\d{2}|gtx 1[06][6-8]0/i;

/** True for software rasterisers (headless test browsers, GPU-less VMs). */
export const isSoftwareGpu = (gpu?: string) => !!gpu && SOFTWARE.test(gpu);

/** Picks a starting tier from cheap signals; the adaptive controller does the rest. */
export function pickAutoTier(s: Signals): Tier {
  if (isSoftwareGpu(s.gpu)) return 'low';
  const gpu = s.gpu ?? '';
  const short = Math.min(s.width, s.height);
  const phone = !!s.touch && short < 700;
  const tablet = !!s.touch && !phone;
  let level: number; // 0 low … 3 ultra
  if (MOBILE_GPU.test(gpu) || phone) level = 0;
  else if (tablet) level = 1;
  else if (WEAK_PC_GPU.test(gpu)) level = 1;
  else if (STRONG_GPU.test(gpu) && (s.cores ?? 8) >= 8 && (s.memoryGb ?? 8) >= 8) level = 3;
  else level = 2;
  if (phone && level === 0 && (s.cores ?? 8) >= 8 && (s.memoryGb ?? 4) >= 6) level = 1; // a recent flagship
  // Weak CPU or little memory cap it; a huge canvas (4K) costs a tier unless the GPU is strong.
  if (s.cores !== undefined && s.cores <= 2) level = 0;
  else if (s.cores !== undefined && s.cores <= 4) level = Math.min(level, 1);
  if (s.memoryGb !== undefined && s.memoryGb <= 2) level = 0;
  else if (s.memoryGb !== undefined && s.memoryGb <= 4) level = Math.min(level, 1);
  const pixels = s.width * s.height * s.dpr * s.dpr;
  if (pixels > 8e6 && !STRONG_GPU.test(gpu)) level = Math.max(0, level - 1);
  return TIERS[level];
}
