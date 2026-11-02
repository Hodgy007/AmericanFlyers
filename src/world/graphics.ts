import * as THREE from 'three';
import type { Atmosphere } from './atmosphere';
import { setGlowGain } from './bikeParts';
import type { Post, SkyEnvironment } from './post';
import type { Sky } from './sky';
import type { Adapter, AdaptEvent } from './adapt';
import {
  SCALES, TIER_SPECS, isChoice, isSoftwareGpu, loadChoice, pickAutoTier, saveChoice,
  type GraphicsChoice, type Signals, type Tier,
} from './quality';

// Applies a graphics tier to the renderer and the scene, watches the frame time
// (Auto, and the render scale in every mode), and draws the frame, through the
// post-processing chunk when the tier has one. Decisions live in quality.ts.

export interface GraphicsParts {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sun: THREE.DirectionalLight;
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
    gpu,
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

const _r = new THREE.Vector3();
const _u = new THREE.Vector3();

export class Graphics {
  private choice: GraphicsChoice;
  private autoTier: Tier;
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

  constructor(private readonly p: GraphicsParts, signals: Signals) {
    this.signals = signals;
    this.autoTier = pickAutoTier(this.signals);
    this.choice = currentChoice();
    this.tier = this.choice === 'auto' ? this.autoTier : this.choice;
    this.makeAdapter();
    Object.defineProperty(window, '__afGraphics', { configurable: true, get: () => this.info() });
  }

  /** Needs the atmosphere for the grade, cloud shadows and the sky key; call once it exists. */
  attach(atmosphere: Atmosphere) {
    this.atmosphere = atmosphere;
    this.applyTier();
  }

  private makeAdapter() {
    // Software renderers can't spare the shadow map at all.
    this.noShadows = this.choice === 'auto' && isSoftwareGpu(this.signals.gpu);
    this.scaleIdx = 0;
    this.adapter = null;
    const gen = ++this.adaptGen;
    const auto = this.choice === 'auto';
    void import('./adapt').then((m) => {
      if (gen === this.adaptGen) this.adapter = new m.Adapter(this.tier, auto ? this.autoTier : this.tier, auto, performance.now(), this.noShadows);
    }).catch(() => { /* no adaptation without it */ });
  }

  get currentChoice() { return this.choice; }
  get currentTier() { return this.tier; }

  /** The rider's choice from Settings: Auto or a fixed tier. Remembered on this device. */
  setChoice(c: GraphicsChoice) {
    if (c === this.choice) return;
    this.choice = c;
    saveChoice(c);
    this.tier = c === 'auto' ? this.autoTier : c;
    this.makeAdapter();
    this.lastChange = '';
    this.applyTier();
  }

  /** One line for Settings: what Auto picked and whether it has stepped down since. */
  describe(): string {
    const name = (t: Tier) => t[0].toUpperCase() + t.slice(1);
    if (this.choice !== 'auto') return `Fixed at ${name(this.tier)}; sharpness still eases off if frames run slow.`;
    const base = `Auto picked ${name(this.autoTier)} for this device`;
    if (this.tier !== this.autoTier) return `${base} and is running at ${name(this.tier)} to keep frames smooth.`;
    if (this.scaleIdx > 0) return `${base}, at ${Math.round(SCALES[this.scaleIdx] * 100)}% sharpness to keep frames smooth.`;
    return `${base}. It steps down by itself if frames run slow.`;
  }

  info(): GraphicsInfo {
    return {
      tier: this.tier, choice: this.choice, autoTier: this.autoTier, scale: SCALES[this.scaleIdx], pixelRatio: this.pr,
      fps: Math.round(10000 / this.fpsMs) / 10, post: !!this.post, shadows: this.p.sun.castShadow, gpu: this.signals.gpu ?? '', change: this.lastChange,
    };
  }

  /** The hub's orbit draws on its own schedule: its frame times say nothing about the device. */
  setOrbiting(on: boolean) {
    this.orbiting = on;
    this.lastT = 0;
    this.adapter?.hold(performance.now());
  }

  resize(w: number, h: number) {
    this.cssW = w; this.cssH = h;
    this.pr = Math.min(window.devicePixelRatio || 1, TIER_SPECS[this.tier].maxPixelRatio) * SCALES[this.scaleIdx];
    this.p.renderer.setPixelRatio(this.pr);
    this.p.renderer.setSize(w, h, false);
    this.post?.setSize(w, h, this.pr);
    this.adapter?.hold(performance.now());
  }

  /** Puts the sun's shadow box round `centre`, snapped to whole shadow-map texels so the shadows don't shimmer as you ride. */
  fitShadow(centre: THREE.Vector3, lightDir: THREE.Vector3) {
    const { sun } = this.p;
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
    const { renderer, sun, sky, scene } = this.p;
    const spec = TIER_SPECS[this.tier];
    sun.castShadow = !this.noShadows;
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
    this.lastChange = `${ev.reason}: ${this.tier} ${SCALES[this.scaleIdx]}${this.noShadows ? ' no-shadows' : ''}`;
    if (tierChanged || this.p.sun.castShadow === this.noShadows) this.applyTier();
    else this.resize(this.cssW, this.cssH);
  }

  // ----------------------------------------------------------------- frame ----

  /** Draws the frame, and keeps count of how long frames take. */
  render(dt: number) {
    const t0 = performance.now();
    if (this.env && this.atmosphere && this.env.maintain(t0, this.atmosphere.skyKey, this.tier === 'ultra' ? 256 : 128, this.p.scene, this.p.sky)) this.atmosphere.hemiScale = 0.4; // the sky lights things now; keep a little of the hemisphere's ground bounce
    if (this.post) this.post.render(dt);
    else this.p.renderer.render(this.p.scene, this.p.camera);
    const work = performance.now() - t0;
    if (this.orbiting || document.hidden) { this.lastT = 0; return; }
    if (this.lastT > 0) {
      const frame = t0 - this.lastT;
      if (frame < 400) this.fpsMs += (frame - this.fpsMs) * 0.05;
      const ev = this.frozen ? null : this.adapter?.push(t0, frame, work);
      if (ev) this.applyAdapt(ev);
    }
    this.lastT = t0;
  }
}
