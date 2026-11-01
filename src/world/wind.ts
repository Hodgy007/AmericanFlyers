// Wind: how hard it blows and which way, for the stage you are riding. One
// shared state (`wind`) that the frame loop steps, and that the physics, the
// draft, the pro teams, the clouds and the rain all read.
//
// Directions. The ground plane uses the same angles as `headingAt`: 0 = +x,
// and "right" of a rider heading `h` is the direction `h + 90°`. The wind is
// stored as the direction it blows TOWARDS (`toRad`). For a rider heading `h`:
//   head  =  -speed * cos(to - h)   metres per second into your face (negative: a tailwind)
//   cross =   speed * sin(to - h)   metres per second towards your right (positive: from your left)
//
// Echelons. Behind another rider in a crosswind, the shelter is on the
// downwind side of their wheel, so the best place to sit moves sideways by
// about a quarter of a metre per m/s of crosswind (capped near 0.8 m). A line
// of riders each tucked into the one ahead becomes a diagonal. See draft.ts.
//
// No DOM and no Three.js, so the race engine can use it too.

import type { Stage } from '../stages';

export type Climate = 'clear' | 'cloudy' | 'rain';

/** A stage's prevailing wind: how hard on a breezy (cloudy) day and which way it blows. */
export interface StageWind {
  /** Speed in m/s on a cloudy, breezy day. Clear days are lighter and rain brings more. */
  ms: number;
  /** Degrees the wind blows towards, turning right from the direction the stage starts off in (0 = a tailwind off the start, 90 = from the left, 180 = a headwind off the start). */
  angle: number;
}

/** Wind for the built-in stages. A stage can also carry its own (`Stage.wind`); anything else gets a mild wind picked from its id. */
export const STAGE_WINDS: Record<string, StageWind> = {
  heartland: { ms: 4.5, angle: 95 }, // open farmland: a steady crosswind from the left
  route66: { ms: 5, angle: 70 }, // flat, exposed highway: crosswind with a touch of tail
  'alpe-dhuez': { ms: 2.5, angle: 140 },
  stelvio: { ms: 4, angle: 200 },
  'hell-of-the-west': { ms: 3, angle: 160 },
  ventoux: { ms: 7.5, angle: 255 }, // the windy one: the mistral
  tourmalet: { ms: 3.5, angle: 20 },
  zoncolan: { ms: 3, angle: 120 },
};

/** Wind speed scale by weather: lighter on clear days, much more when it rains. */
const WEATHER_SCALE: Record<Climate, number> = { clear: 0.6, cloudy: 1, rain: 1.5 };
/** How gusty it is, as a share of the mean speed. */
const GUSTINESS: Record<Climate, number> = { clear: 0.15, cloudy: 0.25, rain: 0.4 };
const DEFAULT_MS = 3.5;
const MAX_MS = 14;

export const SHIFT_PER_MS = 0.25; // metres the sheltered spot moves per m/s of crosswind
export const SHIFT_MAX = 0.8; // metres

/** How far to the right of the rider ahead's line the sheltered spot is (negative: to the left), for a crosswind towards your right of `cross` m/s. */
export function draftShift(cross: number) {
  return Math.max(-SHIFT_MAX, Math.min(SHIFT_MAX, cross * SHIFT_PER_MS));
}

/** Headwind and crosswind (m/s) for a rider heading `heading`, in wind blowing `speed` m/s towards `toRad`. */
export function windComponents(speed: number, toRad: number, heading: number): { head: number; cross: number } {
  const a = toRad - heading;
  return { head: -speed * Math.cos(a), cross: speed * Math.sin(a) };
}

/**
 * Lane (metres right of the centre line) for a rider in a two-by-two line of
 * `row` rows back, `side` -1 or 1, when the sheltered spot is `shift` metres
 * to one side. The front of the line sits upwind so the diagonal fits the road.
 */
export function echelonLane(row: number, side: number, shift: number, base = 2.6, sideGap = 0.42) {
  const k = Math.min(1, Math.abs(shift) / SHIFT_MAX);
  const front = base - Math.sign(shift) * 0.9 * k;
  return front + row * shift + side * sideGap;
}

/** Plain words for the wind, as met by a rider: "Headwind", "Crosswind from the left" and so on. */
export function describeWind(speedMs: number, head: number, cross: number): { text: string; kind: 'calm' | 'head' | 'tail' | 'cross' } {
  if (speedMs < 1) return { text: 'Calm', kind: 'calm' };
  // Bearing the wind comes FROM, relative to the bike: 0 = dead ahead, +90 = from the right.
  const from = Math.atan2(-cross, head) * (180 / Math.PI);
  const a = Math.abs(from);
  const side = from > 0 ? 'right' : 'left';
  if (a <= 30) return { text: 'Headwind', kind: 'head' };
  if (a >= 150) return { text: 'Tailwind', kind: 'tail' };
  if (a < 60) return { text: `Headwind from the ${side}`, kind: 'head' };
  if (a > 120) return { text: `Tailwind from the ${side}`, kind: 'tail' };
  return { text: `Crosswind from the ${side}`, kind: 'cross' };
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The wind of the stage being ridden. Step it with `update`, read it with `at`. */
export class WindState {
  /** Off (Settings): no wind at all, the way it was before wind existed. */
  enabled = true;
  private stageMs = DEFAULT_MS;
  private stageTo = 0; // radians the wind blows towards, before wobble
  private climate: Climate = 'clear';
  private mean = 0; // m/s, eased towards the weather's target
  private t = 0;
  private gust = 1;
  private wobble = 0;

  /** A new stage: its wind (from `Stage.wind`, the built-in table, or a mild one picked from its id). `startHeading` is the direction the road runs off in. */
  setStage(stage: Pick<Stage, 'id'> & { wind?: StageWind }, startHeading: number) {
    const spec = stage.wind ?? STAGE_WINDS[stage.id];
    if (spec) {
      this.stageMs = spec.ms;
      this.stageTo = startHeading + (spec.angle * Math.PI) / 180;
    } else {
      const h = hash(stage.id);
      this.stageMs = DEFAULT_MS * (0.6 + 0.8 * (((h >>> 4) % 100) / 100));
      this.stageTo = startHeading + (((h >>> 12) % 360) * Math.PI) / 180;
    }
    this.mean = this.targetMean(); // straight to it: a new stage starts blowing at once
  }

  setWeather(w: Climate) {
    this.climate = w;
  }

  get weather() {
    return this.climate;
  }

  private targetMean() {
    return Math.min(MAX_MS, this.stageMs * WEATHER_SCALE[this.climate]);
  }

  /** Call every frame with the (ride-clock) seconds that passed. */
  update(dt: number) {
    this.t += dt;
    this.mean += (this.targetMean() - this.mean) * (1 - Math.exp(-dt / 20)); // a weather change builds over ~a minute
    const amp = GUSTINESS[this.climate];
    this.gust = 1 + amp * (0.6 * Math.sin(this.t / 6.1 + 1.3) + 0.4 * Math.sin(this.t / 2.3 + 4));
    this.wobble = 0.18 * Math.sin(this.t / 37 + 2) + 0.06 * Math.sin(this.t / 11);
  }

  /** Speed right now, m/s (0 when wind is off). */
  get speed() {
    return this.enabled ? Math.max(0, this.mean * this.gust) : 0;
  }

  /** The mean speed without gusts, for words like "calm" and "windy". */
  get meanSpeed() {
    return this.enabled ? this.mean : 0;
  }

  /** Direction it blows towards, radians on the ground plane. */
  get toRad() {
    return this.stageTo + this.wobble;
  }

  /** The wind as a world vector (m/s on x and z), for the clouds and rain. */
  vector(): { x: number; z: number } {
    const s = this.speed;
    return { x: Math.cos(this.toRad) * s, z: Math.sin(this.toRad) * s };
  }

  /** Headwind (m/s into your face; negative = tailwind) and crosswind (m/s towards your right) for a rider heading `heading`. */
  at(heading: number) {
    return windComponents(this.speed, this.toRad, heading);
  }

  /** "Calm", "Breezy" or "Windy". */
  get level(): 'calm' | 'breezy' | 'windy' {
    const m = this.meanSpeed;
    return m < 1.5 ? 'calm' : m < 5 ? 'breezy' : 'windy';
  }
}

export const wind = new WindState();
