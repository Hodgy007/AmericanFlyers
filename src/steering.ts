// Steering: where you ride across the road, and the auto-steer that eases you
// into the draft of a rider just ahead. Lanes are metres right of the road's
// centreline (the road is 4.6 m either side); you keep to the right half.

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

export function clampLane(lane: number) {
  return Math.min(LANE_MAX, Math.max(LANE_MIN, lane));
}

export class Steering {
  /** Where you want to be. The world eases the bike there. */
  target = DEFAULT_LANE;
  private idle = AUTO_IDLE; // seconds since the last steering input
  private held: -1 | 0 | 1 = 0;
  private heldFor = 0;
  private repeatIn = 0;

  /** One step left (-1) or right (1). */
  nudge(dir: -1 | 1) {
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
   * Call every frame. With auto-steer on, and no steering for a few seconds,
   * slides towards the line of the nearest rider within 12 m ahead.
   */
  update(dt: number, opts: {
    autoSteer: boolean;
    distance: number;
    riders: OtherRider[];
    lateralOf: (id: string) => number | undefined;
    /** Crosswind echelon: the sheltered spot is this many metres to the right of their line (draft.ts). */
    shift?: number;
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
    if (!opts.autoSteer || this.idle < AUTO_IDLE) return;

    let best: OtherRider | null = null;
    let bestGap = Infinity;
    for (const r of opts.riders) {
      if (r.ghost) continue;
      const gap = r.distance - opts.distance - BIKE_LENGTH;
      if (gap >= 0 && gap <= AUTO_RANGE && gap < bestGap) { best = r; bestGap = gap; }
    }
    if (!best) return;
    const line = clampLane((opts.lateralOf(best.id) ?? best.lane ?? this.target) + (opts.shift ?? 0));
    const diff = line - this.target;
    if (Math.abs(diff) < AUTO_DEADBAND) return;
    this.target = clampLane(this.target + Math.sign(diff) * Math.min(Math.abs(diff), AUTO_SPEED * dt));
  }
}
