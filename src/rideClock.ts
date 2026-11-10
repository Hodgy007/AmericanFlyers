// The ride clock: turns real elapsed time into simulation substeps, so the ride runs at the same speed whatever the
// frame rate (and keeps running when the tab is hidden and only a timer is driving it). Pure: feed it timestamps.

/** Longest real time one substep covers (the old per-frame clamp). Physics stays stable with steps this small. */
export const MAX_STEP_S = 0.1;
/** The most real time one rAF-driven catch-up simulates (a debugger pause or a stalled tab must not explode). */
export const RAF_CATCHUP_MS = 5000;
/** A gap with no timer tick at all longer than this was the machine asleep or the page frozen: it is dropped, not simulated. */
export const TICK_GAP_MS = 10_000;

export interface Steps {
  /** How many substeps to run. */
  count: number;
  /** Simulated seconds in each (real seconds × the clock's time scale). */
  dt: number;
  /** Real milliseconds in each: step i ends at `startMs + (i + 1) * realMs`. */
  realMs: number;
  /** The real timestamp the first step starts at. */
  startMs: number;
}

export interface Limits {
  /** Simulate at most this much real time; the rest of a longer gap is skipped. */
  maxCatchUpMs?: number;
  /** A gap longer than this is dropped entirely (nothing simulated). */
  dropAboveMs?: number;
}

const NONE = (startMs: number): Steps => ({ count: 0, dt: 0, realMs: 0, startMs });

export class RideClock {
  private last: number | null = null;

  /** `timeScale` multiplies the clock (the `?timescale=` test option); 1 is real time. */
  constructor(private readonly timeScale = 1) {}

  /** Starts counting from `now` (the ride was paused: first frame, hub closed). Nothing is owed for the time before. */
  reset(now: number) {
    this.last = now;
  }

  /** The substeps to run to bring the simulation up to `now`. Moves the clock to `now` whatever the answer. */
  advance(now: number, limits: Limits = {}): Steps {
    const from = this.last ?? now;
    this.last = now;
    let ms = now - from;
    if (!(ms > 0)) return NONE(from); // no time has passed, or the clock went backwards
    if (limits.dropAboveMs !== undefined && ms > limits.dropAboveMs) return NONE(from);
    if (limits.maxCatchUpMs !== undefined && ms > limits.maxCatchUpMs) ms = limits.maxCatchUpMs;
    const count = Math.max(1, Math.ceil(ms / 1000 / MAX_STEP_S - 1e-9));
    const realMs = ms / count;
    return { count, dt: (realMs / 1000) * this.timeScale, realMs, startMs: now - ms };
  }
}
