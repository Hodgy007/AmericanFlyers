import * as THREE from 'three';
import { gradeAt, roadPoint, type RoadPoint } from '../course';
import { Drivetrain } from '../drivetrain';
import { RiderModel } from './rider';
import { DEFAULT_LANE } from '../steering';
import { modelKit } from '../kit';
import { DEFAULT_STYLE, type BikeStyle } from '../garage/style';
import { draftShift, wind } from './wind';
import { Pool, type PoolStats } from './riderPool';

// Other riders on the road: live riders on the same stage, and the ghost of
// your best ride. Positions arrive a couple of times a second at most, so each
// rider is moved on at their last known speed and eased onto fresh positions.

export interface OtherRider {
  id: string;
  name: string;
  distance: number; // metres along the course, predicted for now
  speedMs: number;
  power: number;
  cadence: number;
  ghost?: boolean;
  /** Computer-ridden pro team riders: their team, kit colours and lane. */
  team?: string;
  /** Name tag text, if different from `name` ('' for no tag). */
  tag?: string;
  jersey?: string;
  frame?: string;
  /** Second kit colour (a live rider's custom kit); pro teams use their frame colour instead. */
  accent?: string;
  /** Their bike and clothes from the garage (a live rider's kit string carries them). */
  style?: BikeStyle;
  lane?: number;
  /** A line the rider is saying right now (an AI rival's speech bubble, src/ai/); undefined or '' for none. */
  speech?: string;
}

const SHOW_BEHIND = 300;
const SHOW_AHEAD = 900;
const MAX_SHOWN = 24;
const FRAMES = ['#1f3c88', '#0f7b5f', '#c2410c', '#6d28d9', '#0e7490', '#b91c1c', '#ca8a04', '#334155'];
const JERSEYS = ['#2563eb', '#16a34a', '#f97316', '#9333ea', '#0891b2', '#dc2626', '#eab308', '#475569'];

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** What a rider wears: their own kit if they sent one, else colours picked from their id. */
function lookOf(o: OtherRider) {
  const h = hash(o.id);
  return {
    frame: o.frame ?? FRAMES[h % FRAMES.length],
    jersey: o.jersey ?? JERSEYS[(h >>> 3) % JERSEYS.length],
    // Pro teams: [jersey, frame] in the navy and red slots. Live riders with a kit: jersey on the torso.
    kit: o.jersey && o.frame ? (o.accent ? modelKit(o.jersey, o.accent) : ([o.jersey, o.frame] as [string, string])) : null,
    style: o.style ? o.style : undefined,
  };
}

/** A rider's look, compared field by field between frames (their kit as last applied, to notice changes). */
type Look = ReturnType<typeof lookOf>;

function sameLook(a: Look, b: Look) {
  return a.frame === b.frame && a.jersey === b.jersey && a.style === b.style && a.kit?.[0] === b.kit?.[0] && a.kit?.[1] === b.kit?.[1];
}

// Per-frame scratch: the road point and the list of riders near you, reused so update() allocates nothing.
const _p: RoadPoint = { x: 0, y: 0, z: 0, heading: 0 };
const _cands: OtherRider[] = [];
const _near: OtherRider[] = [];


const emojiTextures = new Map<string, THREE.CanvasTexture>();
/** One shared texture per emoji, drawn with the system's emoji font. */
function emojiTexture(emoji: string) {
  let tex = emojiTextures.get(emoji);
  if (!tex) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.font = '92px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 64, 70);
    tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    emojiTextures.set(emoji, tex);
  }
  return tex;
}

const EMOTE_SECONDS = 2.6;

/** The canvas a name tag is drawn on is this wide whatever the name, so changing the text never reallocates the GPU texture. */
const TAG_W = 640;
const TAG_H = 64;
const TAG_FONT = '600 40px Inter, system-ui, sans-serif';

/** What the pool needs of a name tag (a fake in the unit tests, which have no canvas). */
export interface TagLike {
  readonly sprite: THREE.Sprite;
  /** Redraws the tag; does nothing if it already shows this. */
  set(text: string, ghost: boolean, accent?: string): void;
  dispose(): void;
}

/** A name tag: one canvas, texture and sprite, reused for whoever wears it (set() redraws the text). */
class NameTag implements TagLike {
  readonly sprite: THREE.Sprite;
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  private shown = '';

  constructor() {
    this.canvas.width = TAG_W;
    this.canvas.height = TAG_H;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    // Same size on screen near or far (sizeAttenuation off: scale is a fraction of the view).
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, depthWrite: false, transparent: true, sizeAttenuation: false }));
    this.sprite.position.set(0, 2.05, 0);
    this.sprite.renderOrder = 10;
  }

  set(text: string, ghost: boolean, accent?: string) {
    const key = `${text}|${ghost ? 1 : 0}|${accent ?? ''}`;
    if (key === this.shown) return;
    this.shown = key;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, TAG_W, TAG_H);
    ctx.font = TAG_FONT;
    let t = text;
    // A name too long for the canvas is cut short rather than clipped.
    while (t.length > 1 && ctx.measureText(t).width > TAG_W - 44) t = t.slice(0, -2) + '…';
    const w = Math.min(TAG_W, Math.ceil(ctx.measureText(t).width) + 44);
    ctx.fillStyle = ghost ? 'rgba(20, 30, 60, 0.55)' : 'rgba(10, 14, 24, 0.72)';
    ctx.beginPath();
    ctx.roundRect(2, 2, w - 4, 60, 30);
    ctx.fill();
    if (accent) {
      // A stripe of team colour down the left of the tag.
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.roundRect(2, 2, 14, 60, [30, 0, 0, 30]);
      ctx.fill();
    }
    ctx.fillStyle = ghost ? '#cfe0ff' : '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(t, 22, 34);
    // Only the left `w` pixels of the canvas show.
    this.tex.repeat.set(w / TAG_W, 1);
    this.tex.needsUpdate = true;
    const h = 0.032;
    this.sprite.scale.set((h * w) / TAG_H, h, 1);
  }

  dispose() {
    this.tex.dispose();
    this.sprite.material.dispose();
  }
}

/** Shared 2D context for measuring speech-bubble text: one canvas for the whole session, made on first use. */
let measureCtx: CanvasRenderingContext2D | null = null;

/** A speech bubble above a rider (an AI rival's line, src/ai/): white, wrapped to a few short lines. */
function speechBubble(text: string) {
  const font = '600 34px Inter, system-ui, sans-serif';
  const measure = (measureCtx ??= document.createElement('canvas').getContext('2d')!);
  measure.font = font;
  const lines: string[] = [];
  let cur = '';
  for (const word of text.split(' ')) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && measure.measureText(next).width > 560) { lines.push(cur); cur = word; } else cur = next;
  }
  if (cur) lines.push(cur);
  const w = Math.ceil(Math.max(...lines.map((l) => measure.measureText(l).width))) + 44;
  const lh = 44;
  const h = lines.length * lh + 36;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h + 16;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
  ctx.beginPath();
  ctx.roundRect(2, 2, w - 4, h - 4, 22);
  ctx.moveTo(w / 2 - 12, h - 3);
  ctx.lineTo(w / 2, h + 13);
  ctx.lineTo(w / 2 + 12, h - 3);
  ctx.fill();
  ctx.fillStyle = '#10151f';
  ctx.font = font;
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, 22, 18 + lh * i + lh / 2));
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, depthTest: false, transparent: true, sizeAttenuation: false }));
  const sh = 0.032 * ((h + 16) / 64);
  sprite.scale.set((sh * w) / (h + 16), sh, 1);
  sprite.center.set(0.5, 0); // the tail points at the rider
  sprite.position.set(0, 2.4, 0);
  sprite.renderOrder = 13;
  return sprite;
}

/** What the pool needs of a rider model (the real RiderModel; a stand-in in tests that count builds). */
export type ModelLike = Pick<RiderModel, 'group' | 'body' | 'setLook' | 'update' | 'poseRider' | 'dispose'>;

/** A model and its name tag: the unit that is pooled. Everything per-rider is set again on the way out of the pool. */
interface Slot {
  model: ModelLike;
  tag: TagLike;
  /** The kit the model was last dressed in (undefined for a ghost), to skip dressing it again for the same look. */
  look?: Look;
}

/** How slots are built; injectable so tests can count builds without WebGL or a canvas. */
export interface SlotFactory {
  model(look: ConstructorParameters<typeof RiderModel>[0]): ModelLike;
  tag(): TagLike;
}

const REAL_SLOTS: SlotFactory = { model: (look) => new RiderModel(look), tag: () => new NameTag() };

/** Free models kept for riders to come back into view: the field churns by a few at a time, not by dozens. */
const POOL_LIVE = 8;
const POOL_GHOST = 2;
/** Free models are let go after this long without anyone joining (a stage change, a finished event). */
const POOL_IDLE_MS = 30_000;

interface Shown {
  slot: Slot;
  ghost: boolean;
  text: string; // the tag text as drawn
  accent?: string; // the tag's colour stripe as drawn
  model: ModelLike;
  drivetrain: Drivetrain;
  tag: TagLike;
  distance: number;
  lane: number;
  lateral: number;
  seen: number; // performance.now() when last in the list
  look: Look; // their kit as last applied, to notice changes
  emotes: { sprite: THREE.Sprite; age: number }[]; // floating ride-on emoji (age in seconds)
  bubble?: { sprite: THREE.Sprite; text: string }; // the line they are saying (OtherRider.speech)
}

export class OtherRiders {
  readonly group = new THREE.Group();
  private readonly shown = new Map<string, Shown>();
  private list: OtherRider[] = [];
  private readonly pool: Pool<Slot, Look | undefined>;
  private lastTrim = 0;

  constructor(slots: SlotFactory = REAL_SLOTS, free: { live: number; ghost: number } = { live: POOL_LIVE, ghost: POOL_GHOST }) {
    // A ghost is built see-through (its materials differ structurally), so it has its own free list.
    this.pool = new Pool<Slot, Look | undefined>({
      // A new model is built already dressed for its first rider; a pooled one is re-dressed in update().
      make: (key, look) => ({
        model: slots.model(look && key !== 'ghost' ? { frame: look.frame, jersey: look.jersey, kit: look.kit ?? undefined, style: look.style } : { ghost: true }),
        tag: slots.tag(),
        look,
      }),
      dispose: (slot) => { slot.model.dispose(); slot.tag.dispose(); },
      cap: (key) => (key === 'ghost' ? free.ghost : free.live),
      idleMs: POOL_IDLE_MS,
    });
    if (typeof window !== 'undefined') (window as unknown as { __afRiders?: () => PoolStats }).__afRiders = () => ({ ...this.pool.stats });
  }

  /** Models built, reused and disposed so far (tests; `window.__afRiders()` in the console). */
  get poolStats(): PoolStats {
    return this.pool.stats;
  }

  set(list: OtherRider[]) {
    this.list = list;
  }

  /** Where a drawn rider is across the road right now (metres right of the centre line), if they're on screen. */
  lateralOf(id: string): number | undefined {
    return this.shown.get(id)?.lateral;
  }

  /** Floats an emoji up from a rider's head (a ride-on). False if that rider isn't drawn right now. */
  showEmote(id: string, emoji: string) {
    const s = this.shown.get(id);
    if (!s) return false;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture(emoji), transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false }));
    sprite.renderOrder = 12;
    sprite.position.set(0, 2.15, 0);
    s.model.group.add(sprite);
    s.emotes.push({ sprite, age: 0 });
    return true;
  }

  private tickEmotes(s: Shown, dt: number) {
    for (let i = s.emotes.length - 1; i >= 0; i--) {
      const e = s.emotes[i];
      const age = (e.age += dt);
      if (age >= EMOTE_SECONDS) {
        s.model.group.remove(e.sprite);
        e.sprite.material.dispose(); // the texture is shared
        s.emotes.splice(i, 1);
        continue;
      }
      const pop = Math.min(1, age / 0.25);
      const size = 0.085 * (0.6 + 0.4 * (1 - (1 - pop) * (1 - pop)));
      e.sprite.scale.set(size, size, 1);
      e.sprite.position.y = 2.15 + age * 0.3;
      e.sprite.material.opacity = Math.min(1, age / 0.15) * Math.min(1, (EMOTE_SECONDS - age) / 0.7);
    }
  }

  /** `playerLane` is where you are across the road: riders pull out to pass you and line up in front of you by it. */
  update(playerDistance: number, dt: number, camera: THREE.Camera, playerLane = DEFAULT_LANE) {
    const now = performance.now();
    // In a crosswind a rider you're tucked behind sits upwind of you, so the line-up is on the diagonal.
    const shift = draftShift(wind.at(roadPoint(playerDistance, _p).heading).cross);
    // Scratch lists, reused each frame: the nearest MAX_SHOWN riders.
    _cands.length = 0;
    for (const o of this.list) {
      if (o.distance > playerDistance - SHOW_BEHIND && o.distance < playerDistance + SHOW_AHEAD) _cands.push(o);
    }
    _cands.sort((a, b) => Math.abs(a.distance - playerDistance) - Math.abs(b.distance - playerDistance));
    const near = _near;
    near.length = Math.min(_cands.length, MAX_SHOWN);
    for (let i = 0; i < near.length; i++) near[i] = _cands[i];

    for (const o of near) {
      let s = this.shown.get(o.id);
      if (!s) {
        const h = hash(o.id);
        const look = lookOf(o);
        const slot = this.takeSlot(o.ghost ? undefined : look, now);
        // A pooled model still wears its last rider's kit: dress it for this one (a new build already is).
        if (!o.ghost && slot.look !== look && !(slot.look && sameLook(slot.look, look))) slot.model.setLook({ frame: look.frame, jersey: look.jersey, kit: look.kit, style: look.style ?? DEFAULT_STYLE });
        slot.look = o.ghost ? undefined : look;
        const text = o.tag ?? o.name;
        slot.tag.set(text || ' ', !!o.ghost, o.jersey);
        if (text) slot.model.group.add(slot.tag.sprite);
        slot.model.group.visible = true;
        const lane = o.lane ?? (o.ghost ? DEFAULT_LANE - 1.1 : 0.9 + ((h >>> 6) % 5) * 0.6);
        s = { slot, model: slot.model, ghost: !!o.ghost, drivetrain: new Drivetrain(), tag: slot.tag, text, accent: o.jersey, distance: o.distance, lane, lateral: lane, seen: now, look, emotes: [] };
        this.shown.set(o.id, s);
        this.group.add(slot.model.group);
      }
      s.seen = now;
      if (!o.ghost) {
        // A rider who changes their kit mid-ride.
        const look = lookOf(o);
        if (!sameLook(look, s.look)) {
          s.look = s.slot.look = look;
          s.model.setLook({ ...look, style: o.style ?? DEFAULT_STYLE });
        }
      }

      // Move on at their speed, then ease onto the latest prediction.
      s.distance += o.speedMs * dt;
      const err = o.distance - s.distance;
      if (Math.abs(err) > 150) s.distance = o.distance;
      else s.distance += err * (1 - Math.exp(-dt / 0.9));

      // Pull out to pass rather than riding through you.
      const gap = s.distance - playerDistance;
      let target = s.lane;
      if (!o.ghost && Math.abs(gap) < 1.9 && Math.abs(s.lane - playerLane) < 0.9) {
        target = s.lane < playerLane ? playerLane - 1 : playerLane + 1;
      } else if (!o.ghost && !o.team && gap >= 1.9 && gap < 14 && Math.abs(s.lane + shift - playerLane) < 1.3) {
        target = Math.min(4.2, Math.max(0.4, playerLane - shift)); // you're on their wheel: line up in front of you, as in a paceline
      }
      s.lateral += (target - s.lateral) * (1 - Math.exp(-dt / 0.6));

      s.drivetrain.update(dt, o.speedMs, o.cadence, o.power);
      const p = roadPoint(s.distance, _p);
      const g = s.model.group;
      g.position.set(p.x - Math.sin(p.heading) * s.lateral, p.y + 0.02, p.z + Math.cos(p.heading) * s.lateral);
      g.rotation.y = -p.heading;
      s.model.body.rotation.z = Math.atan(gradeAt(s.distance));
      s.model.body.rotation.x = s.drivetrain.rock;
      s.model.update(s.distance, s.drivetrain.crankAngle);
      g.updateMatrixWorld(true);
      // Posing the rigged rider is the costly part: skip it when they're a speck.
      if (Math.abs(gap) < 220) s.model.poseRider();
      // Name tags: one place sets visibility: hidden right by the camera and far up the road, or with no text.
      const fromCam = g.position.distanceTo(camera.position);
      const text = o.tag ?? o.name;
      if (text !== s.text || o.jersey !== s.accent) {
        // Their name (or team colour) changed while they're on the road: redraw the same tag.
        if (!text) g.remove(s.tag.sprite);
        else { s.tag.set(text, s.ghost, o.jersey); if (!s.text) g.add(s.tag.sprite); }
        s.text = text;
        s.accent = o.jersey;
      }
      s.tag.sprite.visible = !!text && fromCam > 3.5 && fromCam < 260;
      if (s.emotes.length) this.tickEmotes(s, dt);
      // Speech bubble (AI rivals): built when the line changes, gone when it clears.
      const say = o.speech ?? '';
      if (say !== (s.bubble?.text ?? '')) {
        if (s.bubble) { g.remove(s.bubble.sprite); s.bubble.sprite.material.map?.dispose(); s.bubble.sprite.material.dispose(); s.bubble = undefined; }
        if (say) { const sprite = speechBubble(say); g.add(sprite); s.bubble = { sprite, text: say }; }
      }
      if (s.bubble) s.bubble.sprite.visible = fromCam > 3.5 && fromCam < 260;
    }

    // Drop riders who've left, gone out of range, or haven't been heard from: their models go back to the pool.
    for (const [id, s] of this.shown) {
      if (now - s.seen < 400) continue;
      this.retire(id, s);
    }
    if (now - this.lastTrim > 5000) { this.lastTrim = now; this.pool.trim(now); }
  }

  /** A model for a rider joining: a free one from the pool, else the stalest rider who has just left the shown set, else a new build. */
  private takeSlot(look: Look | undefined, now: number): Slot {
    const ghost = !look;
    const key = ghost ? 'ghost' : 'live';
    if (!this.pool.freeCount(key)) {
      // Riders linger 400 ms after dropping out of the nearest few; in a churning field reclaim the oldest one rather than build.
      let stale: [string, Shown] | undefined;
      for (const e of this.shown) if (e[1].ghost === ghost && e[1].seen !== now && (!stale || e[1].seen < stale[1].seen)) stale = e;
      if (stale) this.retire(stale[0], stale[1]);
    }
    return this.pool.acquire(key, now, look);
  }

  /** Takes a rider off the road and puts their model back in the pool with nothing of theirs left on it. */
  private retire(id: string, s: Shown) {
    const g = s.model.group;
    this.group.remove(g);
    g.remove(s.tag.sprite);
    for (const e of s.emotes) { g.remove(e.sprite); e.sprite.material.dispose(); } // the emoji texture is shared
    s.emotes.length = 0;
    if (s.bubble) { g.remove(s.bubble.sprite); s.bubble.sprite.material.map?.dispose(); s.bubble.sprite.material.dispose(); s.bubble = undefined; }
    // Level and still, so nothing of the last ride shows if this model is picked up before its first update().
    g.visible = false;
    s.model.body.rotation.set(0, 0, 0);
    this.shown.delete(id);
    this.pool.release(s.ghost ? 'ghost' : 'live', s.slot);
  }
}
