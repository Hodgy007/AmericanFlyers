// Steering: where you ride across the road, the racing line through the bends,
// and the auto-steer that eases you into the draft of a rider just ahead. Lanes
// are metres right of the road's centreline (the road is 4.6 m either side);
// you keep to the right half.

import type { OtherRider } from './world/others';
import { BIKE_LENGTH } from './draft';

export const DEFAULT_LANE = 1.9;
export const LANE_MIN = 0.5; // near the centre line
export const LANE_MAX = 4.0; // near the right-hand edge
export const STEER_STEP = 0.7; // metres per press

const REPEAT_DELAY = 0.35; // seconds held before it repeats
const REPEAT_EVERY = 0.22; // seconds between repeats once it does
const AUTO_IDLE = 3; // seconds without steering before auto-steer takes over
const AUTO_RANGE = 12; // metres ahead (wheel to wheel) to look for a wheel to follow
const AUTO_SPEED = 1.1; // metres per second the target slides towards their line
const AUTO_DEADBAND = 0.12;

// The racing line: wide into a bend (the outside of the turn), then the inside of it, and back out afterwards.
// Curvature comes from the road's heading (course.ts's headingAt).
const CURVE_STEP = 2; // metres between heading samples
const LOOK_BACK = 4; // samples behind: a 8 m of turn just entered still counts
const CURVE_RAMP = 8; // samples ahead: a bend this close (16 m) is set up for
const FULL = 0.004; // rad/m: below this a bend is too gentle to ride a line through
const LINE_SNAP = 0.6; // metres per second the racing line may move the target (visual only, so it may be free)

export function clampLane(lane: number) {
  return Math.min(LANE_MAX, Math.max(LANE_MIN, lane));
}

/** Signed curvature of the road at `d` (rad/m): positive to the right, as heading grows. */
export function curvatureAt(headingAt: (d: number) => number, d: number) {
  return (headingAt(d + CURVE_STEP) - headingAt(d - CURVE_STEP)) / (2 * CURVE_STEP);
}

/** How hard the road bends over the next 8 m, from -1 (left) to 1 (right): signed curvature, capped at FULL. */
export function bendAt(headingAt: (d: number) => number, d: number) {
  let k = 0;
  for (let i = 1; i <= 4; i++) k += curvatureAt(headingAt, d + i * 2);
  return Math.max(-1, Math.min(1, k / 4 / FULL));
}

/**
 * Where the racing line is at `d`, in metres right of the centre: wide in, the apex of the next bend,
 * then out wide again. With no bend near, the middle of the right-hand half (DEFAULT_LANE).
 */
export function racingLane(headingAt: (d: number) => number, d: number) {
  // How hard the road turns here and a little behind (a bend just entered counts): positive right, negative left.
  let k = 0;
  for (let i = -LOOK_BACK; i <= 0; i++) k += curvatureAt(headingAt, d + i * CURVE_STEP);
  k /= LOOK_BACK + 1;
  // How hard it turns just ahead: with a bend coming, the line is set up wide for it before the bend takes over.
  let ahead = 0;
  for (let i = 1; i <= CURVE_RAMP; i++) ahead += curvatureAt(headingAt, d + i * CURVE_STEP);
  ahead /= CURVE_RAMP;
  // The bend that matters now: the one underfoot if it is a bend, else the one coming up.
  const inBend = Math.abs(k) >= Math.abs(ahead) && Math.abs(k) >= FULL / 4;
  const bend = inBend ? k : ahead;
  if (Math.abs(bend) < FULL / 4) return DEFAULT_LANE; // no bend near
  const dir = Math.sign(bend);
  const depth = Math.min(1, (Math.abs(bend) / FULL) * 3);
  // In the bend, the racing line is the inside of the turn: towards the centre line round a right-hander, and
  // out towards the edge round a left-hander. Coming up to one, it is wide: the outside of the turn.
  const towardsCentre = inBend ? dir > 0 : dir < 0;
  const room = towardsCentre ? DEFAULT_LANE - LANE_MIN : LANE_MAX - DEFAULT_LANE;
  return clampLane(DEFAULT_LANE + (towardsCentre ? -1 : 1) * depth * room);
}

export class Steering {
  /** Where you want to be. The world eases the bike there. */
  target = DEFAULT_LANE;
  /** Riding the racing line through the bends: on until a steering input takes over. */
  racingLine = true;
  private idle = AUTO_IDLE; // seconds since the last steering input
  private held: -1 | 0 | 1 = 0;
  private heldFor = 0;
  private repeatIn = 0;

  /** Hand steering takes over from the racing line until `backToRacingLine` is called. */
  manual() {
    this.racingLine = false;
  }

  /** Back onto the racing line (says whether this changed anything). */
  backToRacingLine() {
    if (this.racingLine) return false;
    this.racingLine = true;
    this.idle = 0;
    return true;
  }

  /** One step left (-1) or right (1). */
  nudge(dir: -1 | 1) {
    this.manual();
    this.target = clampLane(this.target + dir * STEER_STEP);
    this.idle = 0;
  }

  /** A key or button went down (steps once, then repeats while held). */
  press(dir: -1 | 1) {
    if (this.held === dir) return;
    this.held = dir;
    this.heldFor = 0;
    this.repeatIn = REPEAT_DELAY;
    this.nudge(dir);
  }

  release(dir?: -1 | 1) {
    if (dir === undefined || this.held === dir) this.held = 0;
  }

  /**
   * Call every frame. On the racing line, the target follows the bend ahead. With
   * auto-steer on, and no steering for a few seconds, it slides towards the line
   * of the nearest rider within 12 m ahead.
   */
  update(dt: number, opts: {
    autoSteer: boolean;
    distance: number;
    riders: OtherRider[];
    lateralOf: (id: string) => number | undefined;
    /** Crosswind echelon: the sheltered spot is this many metres to the right of their line (draft.ts). */
    shift?: number;
    /** The road's heading at a distance (course.ts's headingAt), for the racing line. */
    headingAt?: (d: number) => number;
  }) {
    if (this.held) {
      this.heldFor += dt;
      this.repeatIn -= dt;
      this.idle = 0;
      while (this.repeatIn <= 0) {
        this.target = clampLane(this.target + this.held * STEER_STEP);
        this.repeatIn += REPEAT_EVERY;
      }
      return;
    }
    this.idle += dt;
    // A wheel just ahead wins over the racing line: that is where the shelter is.
    if (this.racingLine && opts.headingAt) {
      if (!this.followWheel(dt, opts)) this.driveRacingLine(dt, opts.headingAt, opts.distance);
      return;
    }
    if (!opts.autoSteer || this.idle < AUTO_IDLE) return;
    this.followWheel(dt, opts);
  }

  /** Slides the target towards the racing line, no faster than LINE_SNAP. */
  private driveRacingLine(dt: number, headingAt: (d: number) => number, distance: number) {
    const diff = racingLane(headingAt, distance) - this.target;
    if (Math.abs(diff) < 1e-3) return;
    this.target = clampLane(this.target + Math.sign(diff) * Math.min(Math.abs(diff), LINE_SNAP * dt));
  }

  /** With auto-steer on, and no steering for a few seconds, eases onto the line of the nearest rider within 12 m ahead. True if one was there. */
  private followWheel(dt: number, opts: { autoSteer: boolean; distance: number; riders: OtherRider[]; lateralOf: (id: string) => number | undefined; shift?: number }) {
    if (!opts.autoSteer || this.idle < AUTO_IDLE) return false;

    let best: OtherRider | null = null;
    let bestGap = Infinity;
    for (const r of opts.riders) {
      if (r.ghost) continue;
      const gap = r.distance - opts.distance - BIKE_LENGTH;
      if (gap >= 0 && gap <= AUTO_RANGE && gap < bestGap) { best = r; bestGap = gap; }
    }
    if (!best) return false;
    const line = clampLane((opts.lateralOf(best.id) ?? best.lane ?? this.target) + (opts.shift ?? 0));
    const diff = line - this.target;
    if (Math.abs(diff) < AUTO_DEADBAND) return true;
    this.target = clampLane(this.target + Math.sign(diff) * Math.min(Math.abs(diff), AUTO_SPEED * dt));
    return true;
  }
}
