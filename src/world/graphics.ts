import * as THREE from 'three';
import type { SunLight } from 'three/addons/lights/SunLight.js';
import type { CascadeShadow } from './cascades';
import type { Atmosphere } from './atmosphere';
import { setGlowGain } from './bikeParts';
import type { Post, SkyEnvironment } from './post';
import type { Sky } from './sky';
import type { Adapter, AdaptEvent } from './adapt';
import {
  NoteGate, SCALES, TIER_SPECS, isChoice, isSoftwareGpu, loadAutoMemory, loadChoice, pickAutoStart, saveAutoMemory, saveChoice,
  settledMemory, tierNote,
  type AutoMemory, type AutoStart, type GraphicsChoice, type Signals, type Tier,
} from './quality';

// Applies a graphics tier to the renderer and the scene, watches the frame time
// (Auto, and the render scale in every mode), and draws the frame, through the
// post-processing chunk when the tier has one. Decisions live in quality.ts (where Auto
// starts, what it remembers) and adapt.ts (when to step down or up).

export interface GraphicsParts {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
  cascade: SunLight; // the cascaded sun for High and Ultra (cascades.ts): takes the sun's place, copying its colour and strength
  sky: Sky;
}

export interface GraphicsInfo {
  tier: Tier;
  choice: GraphicsChoice;
  autoTier: Tier;
  scale: number;
  pixelRatio: number;
  fps: number;
  post: boolean;
  shadows: boolean;
  gpu: string;
  change: string;
  remembered: string; // the tier Auto read from this device's memory ('' if none)
  retest: boolean; // Auto started one tier above the remembered one this session
  stats: FrameStats; // draw calls and triangles of the last frame, and of its shadow pass (for measuring)
}

export interface FrameStats { calls: number; tris: number; shadowCalls: number; shadowTris: number; shadowMs: number }

/** `?softgpu=off`: for tests only. Pretends the software renderer is a real GPU, so Auto starts on Ultra like it does on a real device. */
const softGpuOff = new URLSearchParams(location.search).get('softgpu') === 'off';

/** `?cascades=off`: for measuring. High and Ultra keep the single shadow box round the rider, as before the cascades. */
const cascadesOff = new URLSearchParams(location.search).get('cascades') === 'off';
const cascadePlan = (t: Tier) => (cascadesOff ? null : TIER_SPECS[t].cascade);

/** `?jank=60` (ms of busy loop in every frame) or `?jank=120/8` (120 ms in every 8th frame): for testing the step-down. */
function parseJank(): { ms: number; every: number } | null {
  const v = new URLSearchParams(location.search).get('jank');
  if (!v) return null;
  const [ms, every] = v.split('/').map(Number);
  return ms > 0 ? { ms, every: every > 0 ? Math.floor(every) : 1 } : null;
}

/** Reads what the browser will tell us about the device, using a throwaway WebGL context for the GPU's name. Call before creating the renderer. */
export function probeSignals(): Signals {
  const nav = navigator as Navigator & { deviceMemory?: number };
  let gpu: string | undefined;
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    if (gl && ext) gpu = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { /* hidden by the browser */ }
  return {
    cores: nav.hardwareConcurrency || undefined,
    memoryGb: nav.deviceMemory,
    width: screen.width || window.innerWidth,
    height: screen.height || window.innerHeight,
    dpr: window.devicePixelRatio || 1,
    gpu: softGpuOff ? 'Test GPU (?softgpu=off)' : gpu,
    touch: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
  };
}

/** The visit's choice: ?graphics= (this visit only), else the one saved on this device. */
const currentChoice = (): GraphicsChoice => {
  const url = new URLSearchParams(location.search).get('graphics');
  return isChoice(url) ? url : loadChoice();
};

/** Whether the canvas needs its own multisampling: only where the tier can end up drawing straight to the screen, and never on a software renderer (where it is very slow). */
export function wantsMsaa(s: Signals): boolean {
  const c = currentChoice();
  return !isSoftwareGpu(s.gpu) && (c === 'auto' || c === 'low');
}

const name = (t: Tier) => t[0].toUpperCase() + t.slice(1);

const _r = new THREE.Vector3();
const _u = new THREE.Vector3();

/** Auto's settled answer is written to localStorage at most this often, plus once when the page goes away. */
const SAVE_EVERY_MS = 60_000;

export class Graphics {
  private choice: GraphicsChoice;
  private autoTier: Tier; // where Auto starts this session, and the most it climbs back to
  private start: AutoStart;
  private memory: AutoMemory | null;
  private tier: Tier;
  private scaleIdx = 0;
  private noShadows = false;
  private readonly signals: Signals;
  private adapter: Adapter | null = null; // the controller is its own small chunk, loaded just after the first frame
  private adaptGen = 0;
  private post: Post | null = null;
  private postModule: Promise<typeof import('./post')> | null = null;
  private env: SkyEnvironment | null = null;
  private atmosphere: Atmosphere | null = null;
  private cssW = window.innerWidth;
  private cssH = window.innerHeight;
  private pr = 1;
  private orbiting = false;
  private lastT = 0;
  private fpsMs = 16.7;
  private lastChange = '';
  private readonly frozen = new URLSearchParams(location.search).get('adapt') === 'off'; // for measuring a tier as it is
  private shadowBox = 30;
  private shadowSize = 2048;
  private notify: ((msg: string) => void) | null = null;
  private gate = new NoteGate(performance.now());
  private dialogOpen = false;
  private dialogCheckedAt = 0;
  private readonly jank = parseJank();
  private jankFrame = 0;
  private lastSaved = -Infinity; // performance.now() of the last saveAutoMemory
  private dirty = false; // a save the throttle has held back
  private stats: FrameStats = { calls: 0, tris: 0, shadowCalls: 0, shadowTris: 0, shadowMs: 0 };

  constructor(private readonly p: GraphicsParts, signals: Signals) {
    this.signals = signals;
    this.choice = currentChoice();
    this.memory = loadAutoMemory();
    this.start = pickAutoStart(this.signals, this.memory, Date.now());
    if (this.start.memory && this.choice === 'auto') { this.memory = this.start.memory; saveAutoMemory(this.memory); } // this session counts towards the next re-test
    this.autoTier = this.start.tier;
    this.tier = this.choice === 'auto' ? this.autoTier : this.choice;
    this.makeAdapter();
    this.countShadowPass();
    document.addEventListener('visibilitychange', () => this.adapter?.hold(performance.now(), 1500)); // the frames after a tab switch are slow and say nothing
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.flushMemory(); });
    window.addEventListener('pagehide', () => this.flushMemory());
    Object.defineProperty(window, '__afGraphics', { configurable: true, get: () => this.info() });
  }

  /** Where the "Graphics lowered to High" notes go (the app's toast). */
  onNote(fn: (msg: string) => void) { this.notify = fn; }

  /** Something heavy just happened (a model loaded, a stage rebuilt): don't judge the next moment's frames. */
  pause(ms = 1000) { this.adapter?.hold(performance.now(), ms); }

  /** Needs the atmosphere for the grade, cloud shadows and the sky key; call once it exists. */
  attach(atmosphere: Atmosphere) {
    this.atmosphere = atmosphere;
    this.applyTier();
  }

  private makeAdapter() {
    // Software renderers can't spare the shadow map at all.
    this.noShadows = this.choice === 'auto' && isSoftwareGpu(this.signals.gpu);
    const auto = this.choice === 'auto';
    this.scaleIdx = auto ? this.start.scaleIdx : 0;
    this.adapter = null;
    const gen = ++this.adaptGen;
    const settle = Number(new URLSearchParams(location.search).get('settle')); // dev: settle after this many ms instead of 30 s
    void import('./adapt').then((m) => {
      if (gen !== this.adaptGen) return;
      this.adapter = new m.Adapter(this.tier, auto ? this.autoTier : this.tier, auto, performance.now(), this.noShadows, this.scaleIdx);
      if (settle > 0) this.adapter.settleMs = settle;
    }).catch(() => { /* no adaptation without it */ });
  }

  get currentChoice() { return this.choice; }
  get currentTier() { return this.tier; }

  /** The rider's choice from Settings: Auto or a fixed tier. Remembered on this device. */
  setChoice(c: GraphicsChoice) {
    if (c === this.choice) return;
    this.choice = c;
    saveChoice(c);
    if (c === 'auto') { // start again from what this device remembers (or Ultra); this is not a new session
      this.memory = loadAutoMemory();
      this.start = pickAutoStart(this.signals, this.memory, Date.now(), false);
      this.autoTier = this.start.tier;
    }
    this.tier = c === 'auto' ? this.autoTier : c;
    this.makeAdapter();
    this.lastChange = '';
    this.applyTier();
  }

  /** The Graphics select's Auto entry: "Auto (now: High)" while Auto is on. */
  autoLabel(): string {
    return this.choice === 'auto' ? `Auto (now: ${name(this.tier)})` : 'Auto';
  }

  /** One line for Settings: where Auto started, why, and whether it has stepped down since. */
  describe(): string {
    if (this.choice !== 'auto') return `Fixed at ${name(this.tier)}; sharpness still eases off if frames run slow.`;
    const from = name(this.autoTier);
    let base: string;
    if (isSoftwareGpu(this.signals.gpu)) base = `Auto picked Low because this browser draws the 3D view in software`;
    else if (this.start.retest) base = `Auto is trying ${from} again (${name(this.start.remembered ?? this.autoTier)} worked last time)`;
    else if (this.start.remembered) base = `Auto starts on ${from}, what worked on this device last time`;
    else base = `Auto starts on ${from}`;
    if (this.tier !== this.autoTier) return `${base}, and has lowered to ${name(this.tier)} to keep the ride smooth.`;
    if (this.scaleIdx > 0) return `${base}, at ${Math.round(SCALES[this.scaleIdx] * 100)}% sharpness to keep the ride smooth.`;
    return `${base}. It steps down by itself when the ride gets jerky.`;
  }

  info(): GraphicsInfo {
    return {
      tier: this.tier, choice: this.choice, autoTier: this.autoTier, scale: SCALES[this.scaleIdx], pixelRatio: this.pr,
      fps: Math.round(10000 / this.fpsMs) / 10, post: !!this.post, shadows: this.p.sun.castShadow || this.p.cascade.castShadow, gpu: this.signals.gpu ?? '', change: this.lastChange,
      remembered: this.start.remembered ?? '', retest: this.start.retest, stats: this.stats,
    };
  }

  /** Counts the draw calls and triangles of each frame, and of the shadow pass alone (shown in `__afGraphics.stats`). */
  private countShadowPass() {
    const { renderer } = this.p;
    const info = renderer.info;
    info.autoReset = false; // the post chain renders several times a frame: count them all, reset in render()
    const sm = renderer.shadowMap;
    const draw = sm.render.bind(sm);
    const timed = new URLSearchParams(location.search).get('shadowtime') === '1'; // dev: wait for the GPU after the shadow pass to time it (slows the frame)
    const gl = renderer.getContext();
    sm.render = (...a: Parameters<typeof draw>) => {
      const c = info.render.calls, t = info.render.triangles;
      const t0 = timed ? performance.now() : 0;
      draw(...a);
      if (info.render.calls > c) {
        this.stats.shadowCalls = info.render.calls - c; this.stats.shadowTris = info.render.triangles - t;
        if (timed) { gl.finish(); this.stats.shadowMs += (performance.now() - t0 - this.stats.shadowMs) * 0.2; }
      }
    };
  }

  /** The hub's orbit draws on its own schedule: its frame times say nothing about the device. */
  setOrbiting(on: boolean) {
    this.orbiting = on;
    this.lastT = 0;
    this.adapter?.hold(performance.now());
    if (!on) this.gate.restart(performance.now()); // no notes in the first moments of the ride
  }

  resize(w: number, h: number) {
    this.cssW = w; this.cssH = h;
    this.pr = Math.min(window.devicePixelRatio || 1, TIER_SPECS[this.tier].maxPixelRatio) * SCALES[this.scaleIdx];
    this.p.renderer.setPixelRatio(this.pr);
    this.p.renderer.setSize(w, h, false);
    this.post?.setSize(w, h, this.pr);
    this.adapter?.hold(performance.now());
  }

  /** True when the cascaded sun is the one drawing shadows (High and Ultra, shadows not given up). */
  private get cascaded() { return !!cascadePlan(this.tier) && !this.noShadows; }

  /**
   * Low and Medium: puts the sun's shadow box round `centre`, snapped to whole shadow-map texels so the
   * shadows don't shimmer as you ride. High and Ultra: hands the cascaded sun the sun's light (the
   * cascades fit themselves to the camera each frame, snapped the same way).
   */
  fitShadow(centre: THREE.Vector3, lightDir: THREE.Vector3) {
    const { sun, cascade } = this.p;
    if (this.cascaded) {
      cascade.position.copy(lightDir).multiplyScalar(200);
      cascade.color.copy(sun.color);
      cascade.intensity = sun.intensity;
      return;
    }
    const texel = (this.shadowBox * 2) / this.shadowSize;
    _r.set(0, 1, 0).cross(lightDir).normalize();
    _u.crossVectors(lightDir, _r);
    const a = Math.round(centre.dot(_r) / texel) * texel;
    const b = Math.round(centre.dot(_u) / texel) * texel;
    const c = centre.dot(lightDir);
    sun.target.position.set(0, 0, 0).addScaledVector(_r, a).addScaledVector(_u, b).addScaledVector(lightDir, c);
    sun.position.copy(sun.target.position).addScaledVector(lightDir, 200);
  }

  // -------------------------------------------------------------- applying ----

  private applyTier() {
    const { renderer, sun, cascade, sky, scene } = this.p;
    const spec = TIER_SPECS[this.tier];
    const cascaded = this.cascaded;
    sun.visible = !cascaded; // one sun light at a time: the box light, or the cascaded one
    sun.castShadow = !this.noShadows && !cascaded;
    cascade.visible = cascaded;
    cascade.castShadow = cascaded;
    // Only the light that is drawing shadows keeps a map (about 100 MB for the cascades), so a tier change frees the other's.
    if (cascaded) { sun.shadow.map?.dispose(); sun.shadow.map = null; } else { cascade.shadow.map?.dispose(); cascade.shadow.map = null; }
    const plan = cascadePlan(this.tier);
    if (plan) {
      const cs = cascade.shadow as CascadeShadow;
      if (cs.plan.tile !== plan.tile) { cs.map?.dispose(); cs.map = null; }
      cs.plan = plan;
      cs.radius = spec.shadowRadius;
      cs.bias = sun.shadow.bias;
      cs.normalBias = sun.shadow.normalBias;
      cs.camera.far = plan.range;
    }
    this.shadowSize = spec.shadowSize;
    this.shadowBox = spec.shadowBox;
    const sh = sun.shadow;
    if (sh.mapSize.x !== spec.shadowSize) {
      sh.mapSize.set(spec.shadowSize, spec.shadowSize);
      sh.map?.dispose();
      sh.map = null;
    }
    sh.radius = spec.shadowRadius;
    const s = sh.camera;
    s.left = -spec.shadowBox; s.right = spec.shadowBox; s.top = spec.shadowBox; s.bottom = -spec.shadowBox;
    s.updateProjectionMatrix();
    sky.setQuality(spec.skyQuality);
    if (this.atmosphere) this.atmosphere.cloudShadows = spec.cloudShadows;
    if (spec.post) this.ensurePost();
    else {
      this.post?.dispose(); this.post = null;
      setGlowGain(1);
    }
    if (!spec.ibl) {
      this.env?.dispose(); this.env = null;
      scene.environment = null;
      if (this.atmosphere) this.atmosphere.hemiScale = 1;
    }
    this.resize(this.cssW, this.cssH);
    renderer.shadowMap.needsUpdate = true;
  }

  /** Loads the post-processing chunk the first time a tier wants it; until it arrives the frame is drawn directly. */
  private ensurePost() {
    this.postModule ??= import('./post');
    void this.postModule.then((m) => {
      const spec = TIER_SPECS[this.tier];
      if (!spec.post || !this.atmosphere) return;
      if (this.post) this.post.configure(spec);
      else {
        this.post = m.createPost(this.p.renderer, this.p.scene, this.p.camera, this.atmosphere.grade, spec);
        this.post.setSize(this.cssW, this.cssH, this.pr);
        setGlowGain(0.4);
        this.adapter?.hold(performance.now());
      }
      if (spec.ibl) this.env ??= new m.SkyEnvironment(this.p.renderer, this.p.sky.domeMesh);
    }).catch(() => { /* chunk failed to load (offline): stay on the direct path */ });
  }

  private applyAdapt(ev: AdaptEvent) {
    const tierChanged = ev.tier !== this.tier;
    this.tier = ev.tier;
    this.scaleIdx = ev.scaleIdx;
    this.noShadows = ev.noShadows;
    this.lastChange = `${ev.reason}${ev.fast ? ' (fast)' : ''}: ${this.tier} ${SCALES[this.scaleIdx]}${this.noShadows ? ' no-shadows' : ''}`;
    if (tierChanged && this.choice === 'auto' && this.gate.allow(performance.now())) this.notify?.(tierNote(this.tier, ev.reason === 'slow' ? 'lowered' : 'raised'));
    if (tierChanged || (this.p.sun.castShadow || this.p.cascade.castShadow) === this.noShadows) this.applyTier();
    else this.resize(this.cssW, this.cssH);
  }

  /** Once Auto has been stable for ~30 s of riding, keeps what it settled on for the next visit. */
  private remember() {
    if (this.choice !== 'auto' || this.frozen || isSoftwareGpu(this.signals.gpu)) return;
    const st = this.adapter?.takeSettled();
    if (!st || st.noShadows) return;
    // The in-memory memory is always current; the localStorage write is throttled (a settled answer rarely changes).
    const memory = this.memory = settledMemory(this.memory, st.tier, st.scaleIdx, this.signals.gpu ?? '', Date.now());
    const now = performance.now();
    if (now - this.lastSaved < SAVE_EVERY_MS) { this.dirty = true; return; }
    this.lastSaved = now;
    this.dirty = false;
    saveAutoMemory(memory);
  }

  /** Writes a save the throttle held back (page gone or hidden). */
  private flushMemory() {
    if (!this.dirty || !this.memory) return;
    this.lastSaved = performance.now();
    this.dirty = false;
    saveAutoMemory(this.memory);
  }

  // ----------------------------------------------------------------- frame ----

  /** Draws the frame, and keeps count of how long frames take. */
  render(dt: number) {
    const t0 = performance.now();
    this.p.renderer.info.reset();
    if (this.env && this.atmosphere && this.env.maintain(t0, this.atmosphere.skyKey, this.tier === 'ultra' ? 256 : 128, this.p.scene, this.p.sky)) this.atmosphere.hemiScale = 0.4; // the sky lights things now; keep a little of the hemisphere's ground bounce
    if (this.env && this.atmosphere && this.p.scene.environment) { const v = 0.75 * this.atmosphere.skyLight; if (this.p.scene.environmentIntensity !== v) this.p.scene.environmentIntensity = v; }
    if (this.post) this.post.render(dt);
    else this.p.renderer.render(this.p.scene, this.p.camera);
    if (this.jank && ++this.jankFrame % this.jank.every === 0) { const end = performance.now() + this.jank.ms; while (performance.now() < end) { /* busy: a slow or hitchy device, for testing */ } }
    const work = performance.now() - t0;
    this.stats.calls = this.p.renderer.info.render.calls; this.stats.tris = this.p.renderer.info.render.triangles;
    if (this.orbiting || document.hidden) { this.lastT = 0; return; }
    if (this.lastT > 0) {
      const frame = t0 - this.lastT;
      if (frame < 400) this.fpsMs += (frame - this.fpsMs) * 0.05;
      if (t0 - this.dialogCheckedAt > 250) { this.dialogCheckedAt = t0; this.dialogOpen = !!document.querySelector('dialog[open]'); }
      if (this.dialogOpen) this.adapter?.hold(t0, 1000); // a dialog and its blur over the canvas: frames then say little about the ride
      else {
        const ev = this.frozen ? null : this.adapter?.push(t0, frame, work);
        if (ev) this.applyAdapt(ev);
        else this.remember();
      }
    }
    this.lastT = t0;
  }
}
