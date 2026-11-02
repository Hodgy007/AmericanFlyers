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
  cores?: number; // navigator.hardwareConcurrency (logged only)
  memoryGb?: number; // navigator.deviceMemory (logged only)
  width: number; // CSS px
  height: number;
  dpr: number;
  gpu?: string; // WEBGL_debug_renderer_info's renderer string
  touch?: boolean; // a touch screen as the main pointer (logged only)
}

const SOFTWARE = /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render/i;

/** True for software rasterisers (headless test browsers, GPU-less VMs). */
export const isSoftwareGpu = (gpu?: string) => !!gpu && SOFTWARE.test(gpu);

/**
 * Where Auto starts when nothing is remembered: Ultra on every device, because the controller
 * (adapt.ts) steps down by itself the moment frames get jerky. The one exception is a software
 * renderer, which cannot run Ultra at all (it is what the headless test browser uses): Low.
 * The other device signals (cores, memory, screen) no longer cap the start; they are only logged.
 */
export function pickAutoTier(s: Signals): Tier {
  return isSoftwareGpu(s.gpu) ? 'low' : 'ultra';
}

// ---------------------------------------------------------- auto's memory ----

const AUTO_KEY = 'americanflyers.graphicsAuto';

/** Starting a session this many times on a remembered tier, or this long after the last test, tries one tier higher. */
export const RETEST_SESSIONS = 3;
export const RETEST_AFTER_MS = 3 * 24 * 3600 * 1000;

/** What Auto settled on for this device (kept per device, never synced). */
export interface AutoMemory {
  tier: Tier;
  scale: number; // a value from SCALES
  at: number; // ms since epoch: when this was last saved (after ~30 s of stable riding)
  tested: number; // ms since epoch: when a tier higher than this was last tried (or when it was first remembered)
  sessions: number; // Auto sessions started since `tested`
  gpu: string; // the GPU it was learnt on: a different GPU (a laptop switching cards) starts afresh
}

/** Reads the memory, or null when there is none or it is not valid. */
export function loadAutoMemory(): AutoMemory | null {
  try {
    const raw = localStorage.getItem(AUTO_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as Partial<AutoMemory> | null;
    if (!m || typeof m !== 'object') return null;
    if (!TIERS.includes(m.tier as Tier) || !SCALES.includes(m.scale as number)) return null;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const at = num(m.at), tested = num(m.tested), sessions = num(m.sessions);
    if (at === null || tested === null || sessions === null || sessions < 0) return null;
    return { tier: m.tier as Tier, scale: m.scale as number, at, tested, sessions: Math.floor(sessions), gpu: typeof m.gpu === 'string' ? m.gpu : '' };
  } catch { return null; }
}

export function saveAutoMemory(m: AutoMemory) {
  try { localStorage.setItem(AUTO_KEY, JSON.stringify(m)); } catch { /* not remembered */ }
}

export function clearAutoMemory() {
  try { localStorage.removeItem(AUTO_KEY); } catch { /* nothing to clear */ }
}

export interface AutoStart {
  tier: Tier; // where this session starts (and its ceiling: Auto never climbs above it)
  scaleIdx: number; // index into SCALES to start at (a remembered scale applies only to the remembered tier)
  remembered: Tier | null; // the tier read from the memory, if one was used
  retest: boolean; // started one tier above the remembered one to re-test it
  memory: AutoMemory | null; // what to store at the start of the session (counters moved on), if anything
}

/**
 * Where Auto starts this session: the software exception (Low), else the remembered tier and scale,
 * else Ultra. Every RETEST_SESSIONS-th session, or when the last test is RETEST_AFTER_MS old, it
 * starts one tier above the remembered one (never more than one, never above Ultra) to see whether
 * the device copes now. `countSession` is false when Auto is chosen from Settings rather than at load.
 */
export function pickAutoStart(s: Signals, memory: AutoMemory | null, now: number, countSession = true): AutoStart {
  if (isSoftwareGpu(s.gpu)) return { tier: 'low', scaleIdx: 0, remembered: null, retest: false, memory: null };
  const gpu = s.gpu ?? '';
  if (!memory || memory.gpu !== gpu) return { tier: 'ultra', scaleIdx: 0, remembered: null, retest: false, memory: null };
  const idx = TIERS.indexOf(memory.tier);
  const due = memory.sessions >= RETEST_SESSIONS || now - memory.tested >= RETEST_AFTER_MS;
  const retest = due && idx < TIERS.length - 1;
  if (retest) {
    // One tier up, from full sharpness; the counters start again.
    return { tier: TIERS[idx + 1], scaleIdx: 0, remembered: memory.tier, retest: true, memory: { ...memory, tested: now, sessions: 0 } };
  }
  return {
    tier: memory.tier, scaleIdx: Math.max(0, SCALES.indexOf(memory.scale)), remembered: memory.tier, retest: false,
    memory: countSession ? { ...memory, sessions: memory.sessions + 1 } : null,
  };
}

/** The memory to store once the controller has been stable: keeps the test counters of the one before. */
export function settledMemory(prev: AutoMemory | null, tier: Tier, scaleIdx: number, gpu: string, now: number): AutoMemory {
  return {
    tier, scale: SCALES[scaleIdx], at: now, gpu,
    tested: prev && prev.gpu === gpu ? prev.tested : now,
    sessions: prev && prev.gpu === gpu ? prev.sessions : 0,
  };
}

// ----------------------------------------------------------------- toasts ----

export const NOTE_FIRST_MS = 4000; // no note this soon after the session starts
export const NOTE_GAP_MS = 20000; // at most one note per this long

/** Lets a tier-change note through at most once per NOTE_GAP_MS, and not in the first NOTE_FIRST_MS. */
export class NoteGate {
  private last = -Infinity;
  constructor(private startedAt: number) {}
  /** Riding starts (again): the first NOTE_FIRST_MS of it are quiet. The gap since the last note still counts. */
  restart(now: number) { this.startedAt = now; }
  allow(now: number): boolean {
    if (now - this.startedAt < NOTE_FIRST_MS || now - this.last < NOTE_GAP_MS) return false;
    this.last = now;
    return true;
  }
}

/** The line shown when Auto changes the tier. */
export function tierNote(tier: Tier, direction: 'lowered' | 'raised'): string {
  const name = tier[0].toUpperCase() + tier.slice(1);
  return direction === 'lowered' ? `Graphics lowered to ${name} for a smoother ride` : `Graphics raised to ${name}`;
}
