import * as THREE from 'three';
import { gradeAt, roadPoint } from '../course';
import { Drivetrain } from '../drivetrain';
import { RiderModel } from './rider';
import { modelKit } from '../kit';

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
  lane?: number;
}

const PLAYER_LANE = 1.9; // keep in step with RIDER_LANE_OFFSET in world.ts
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
  };
}

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

function label(text: string, ghost: boolean, accent?: string) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const font = '600 40px Inter, system-ui, sans-serif';
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 44;
  canvas.width = w;
  canvas.height = 64;
  ctx.font = font;
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
  ctx.fillText(text, 22, 34);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Same size on screen near or far (sizeAttenuation off: scale is a fraction of the view).
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true, sizeAttenuation: false }));
  const h = 0.032;
  sprite.scale.set((h * w) / 64, h, 1);
  sprite.position.set(0, 2.05, 0);
  sprite.renderOrder = 10;
  return sprite;
}

interface Shown {
  model: RiderModel;
  drivetrain: Drivetrain;
  tag: THREE.Sprite;
  distance: number;
  lane: number;
  lateral: number;
  seen: number; // performance.now() when last in the list
  look: string; // their kit as last applied, to notice changes
  emotes: { sprite: THREE.Sprite; age: number }[]; // floating ride-on emoji (age in seconds)
}

export class OtherRiders {
  readonly group = new THREE.Group();
  private readonly shown = new Map<string, Shown>();
  private list: OtherRider[] = [];

  set(list: OtherRider[]) {
    this.list = list;
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

  update(playerDistance: number, dt: number, camera: THREE.Camera) {
    const now = performance.now();
    const near = this.list
      .filter((o) => o.distance > playerDistance - SHOW_BEHIND && o.distance < playerDistance + SHOW_AHEAD)
      .sort((a, b) => Math.abs(a.distance - playerDistance) - Math.abs(b.distance - playerDistance))
      .slice(0, MAX_SHOWN);

    for (const o of near) {
      let s = this.shown.get(o.id);
      if (!s) {
        const h = hash(o.id);
        const look = lookOf(o);
        const model = new RiderModel(o.ghost ? { ghost: true } : { frame: look.frame, jersey: look.jersey, kit: look.kit ?? undefined });
        const text = o.tag ?? o.name;
        const tag = label(text || ' ', !!o.ghost, o.jersey);
        tag.visible = !!text;
        if (text) model.group.add(tag);
        const lane = o.lane ?? (o.ghost ? PLAYER_LANE - 1.1 : 0.9 + ((h >>> 6) % 5) * 0.6);
        s = { model, drivetrain: new Drivetrain(), tag, distance: o.distance, lane, lateral: lane, seen: now, look: JSON.stringify(lookOf(o)), emotes: [] };
        this.shown.set(o.id, s);
        this.group.add(model.group);
      }
      s.seen = now;
      if (!o.ghost) {
        // A rider who changes their kit mid-ride.
        const key = JSON.stringify(lookOf(o));
        if (key !== s.look) {
          s.look = key;
          s.model.setLook(lookOf(o));
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
      if (!o.ghost && Math.abs(gap) < 2.6 && Math.abs(s.lane - PLAYER_LANE) < 0.9) {
        target = s.lane < PLAYER_LANE ? PLAYER_LANE - 1 : PLAYER_LANE + 1;
      } else if (!o.ghost && !o.team && gap >= 2.6 && gap < 14) {
        target = PLAYER_LANE; // you're on their wheel: line up in front of you, as in a paceline
      }
      s.lateral += (target - s.lateral) * (1 - Math.exp(-dt / 0.6));

      s.drivetrain.update(dt, o.speedMs, o.cadence, o.power);
      const p = roadPoint(s.distance);
      const g = s.model.group;
      g.position.set(p.x - Math.sin(p.heading) * s.lateral, p.y + 0.02, p.z + Math.cos(p.heading) * s.lateral);
      g.rotation.y = -p.heading;
      s.model.body.rotation.z = Math.atan(gradeAt(s.distance));
      s.model.body.rotation.x = s.drivetrain.rock;
      s.model.update(s.distance, s.drivetrain.crankAngle);
      g.updateMatrixWorld(true);
      // Posing the rigged rider is the costly part: skip it when they're a speck.
      if (Math.abs(gap) < 220) s.model.poseRider();
      // Name tags: hidden right by the camera and far up the road.
      const fromCam = g.position.distanceTo(camera.position);
      s.tag.visible = !!(o.tag ?? o.name) && fromCam > 3.5 && fromCam < 260;
      if (s.emotes.length) this.tickEmotes(s, dt);
    }

    // Drop riders who've left, gone out of range, or haven't been heard from.
    for (const [id, s] of this.shown) {
      if (now - s.seen < 400) continue;
      this.group.remove(s.model.group);
      s.model.dispose();
      s.tag.material.map?.dispose();
      s.tag.material.dispose();
      for (const e of s.emotes) e.sprite.material.dispose();
      this.shown.delete(id);
    }
  }
}
