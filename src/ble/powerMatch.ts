// "Power match": in ERG the trainer holds ITS OWN measured power at the target, which can differ from a
// separate power meter's by a few percent. This nudges the watts sent to the trainer so the METER'S
// reading settles on the target: a slow integral of (target - meter power), clamped to ±10 % of the target.
// Pure (unit-tested in tests/unit/powerMatch.test.ts); main.ts calls it from the once-a-second control loop.

/** The integral's gain per second: a trainer reading 5 % high is corrected with a time constant of about 12 s. */
const GAIN_PER_S = 1 / 12;
/** The meter's power is smoothed over about this long (s) so one hard pedal stroke doesn't move the target. */
const SMOOTH_S = 4;
/** Largest correction, as a share of the target. */
export const MAX_CORRECTION = 0.1;
/** A target that moves by more than this (W, or the share below) is a new step: the correction starts again. */
const STEP_W = 15;
const STEP_SHARE = 0.08;

export interface MatchInput {
  /** The workout's target watts now. */
  target: number;
  /** The meter's power now (W). */
  meterWatts: number;
  /** False while not pedalling: the correction is held, not wound up against a zero reading. */
  pedalling: boolean;
  /** Seconds since the last call. */
  dt: number;
}

export class PowerMatch {
  private offset = 0; // watts added to the target
  private smooth: number | null = null; // smoothed meter power
  private lastTarget: number | null = null;

  /** The watts to send to the trainer for this target (the target itself until a correction has built up). */
  update(i: MatchInput): number {
    const stepped = this.lastTarget !== null && Math.abs(i.target - this.lastTarget) > Math.max(STEP_W, this.lastTarget * STEP_SHARE);
    if (stepped) this.reset(); // the legs haven't caught up with a new step yet: don't read that gap as a trainer difference
    this.lastTarget = i.target;
    const limit = Math.abs(i.target) * MAX_CORRECTION;
    if (!stepped && i.pedalling && i.dt > 0 && i.target > 0) {
      const k = Math.min(1, i.dt / SMOOTH_S);
      this.smooth = this.smooth === null ? i.meterWatts : this.smooth + (i.meterWatts - this.smooth) * k;
      this.offset += (i.target - this.smooth) * GAIN_PER_S * Math.min(i.dt, 5);
    }
    this.offset = Math.max(-limit, Math.min(limit, this.offset));
    return i.target + this.offset;
  }

  /** Forget the correction (a new step, a new workout, or the meter went away). */
  reset() {
    this.offset = 0;
    this.smooth = null;
  }

  get correction() { return this.offset; }
}
