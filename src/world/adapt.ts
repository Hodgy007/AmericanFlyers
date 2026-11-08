import { SCALES, TIERS, type Tier } from './quality';

// The adaptive controller: watches frame times and lowers (or raises) quality.
// Loaded by graphics.ts a moment after the first frame (its own small chunk).
// Pure logic, tested in tests/unit/quality.test.ts.
//
// "Jerky" is judged on the last 3 s of frames: the median frame time, the share of hitches
// (a frame over 2.5x the median or over 50 ms) and the number of long stalls (over 100 ms).
// Clearly struggling (median over 40 ms, or over 20% hitches) drops a whole tier at once;
// merely jerky takes the gentle path: render scale 1 > 0.85 > 0.7, then a tier.

export interface AdaptState {
  tier: Tier;
  scaleIdx: number; // index into SCALES
  noShadows: boolean; // last resort on a device that can't keep up even at Low and the lowest scale
}

export interface AdaptEvent extends AdaptState {
  reason: 'slow' | 'headroom';
  fast?: boolean; // a slow change that dropped a whole tier at once
}

export const ADAPT = {
  warmupMs: 4000, // shader compiles and the first terrain tiles: don't judge these
  cooldownMs: 6000, // after a change, wait before judging again
  slowWindowMs: 3000,
  slowMs: 22, // median frame above this (45 fps) is slow (jerky)
  hitchRatio: 2.5, // a frame this many times the median is a hitch ...
  hitchMs: 50, // ... and so is any frame over this
  bigMs: 100, // a stall
  hitchShare: 0.08, // more than this share of hitches in the window is jerky
  bigCount: 3, // this many stalls in the window is jerky
  severeMs: 40, // clearly struggling: median over this (25 fps) ...
  severeShare: 0.2, // ... or this share of hitches: drop a whole tier at once
  fastCooldownMs: 3000, // after a whole-tier drop, wait only this long before judging again
  settleMs: 30000, // riding this long without a change counts as settled (and is remembered)
  fastWindowMs: 10000,
  fastMs: 11, // median frame below this (90+ fps) is headroom on its own
  fastBusyMs: 19, // on a 60 Hz display frames can't be shorter than ~16.7: then headroom is ...
  fastWorkMs: 4.5, // ... little CPU time spent in the render call
  evalEveryMs: 500,
  minRaiseGapMs: 30000, // after lowering, don't try going up for this long
  backoffMs: [60000, 120000, 300000, 600000], // each time a raise had to be undone, wait longer
  undoWithinMs: 45000, // a lowering this soon after a raise means the raise was a mistake
  maxFrameMs: 400, // longer gaps (tab hidden, hitches) are not samples ...
  longRun: 3, // ... unless this many come in a row (under 2.5 fps): then it is clearly struggling
  slowFewFrames: 6, // under 20 frames in the slow window (a few fps), judge on this many ...
  slowFewMs: 120, // ... when their median is over this (under ~8 fps)
};

function median(a: number[]): number {
  if (!a.length) return 0;
  const b = a.slice().sort((x, y) => x - y);
  return b[b.length >> 1];
}

export interface Verdict {
  median: number;
  hitchShare: number; // 0..1: frames over 2.5x the median or over 50 ms
  stalls: number; // frames over 100 ms
  jerky: boolean;
  severe: boolean; // clearly struggling
}

/** Judges a window of frame times (ms): slow, hitchy or both. */
export function judge(frames: number[]): Verdict {
  const m = median(frames);
  let hitches = 0, stalls = 0;
  for (const f of frames) {
    if (f > ADAPT.hitchRatio * m || f > ADAPT.hitchMs) hitches++;
    if (f > ADAPT.bigMs) stalls++;
  }
  const share = frames.length ? hitches / frames.length : 0;
  return {
    median: m, hitchShare: share, stalls,
    jerky: m > ADAPT.slowMs || share > ADAPT.hitchShare || stalls >= ADAPT.bigCount,
    severe: m > ADAPT.severeMs || share > ADAPT.severeShare,
  };
}

/**
 * Watches frame times and decides when to lower or raise quality. Lowering goes
 * render scale first (1 → 0.85 → 0.7), then the tier (scale back to 1), then shadows off.
 * Raising reverses that, but only up to the ceiling (the Auto pick, or the fixed tier), only
 * after a long calm stretch, and with growing back-off whenever a raise had to be undone.
 * With `adaptTier` false (a fixed tier) only the render scale moves.
 */
export class Adapter {
  state: AdaptState;
  private readonly ceiling: Tier;
  private readonly adaptTier: boolean;
  private t: number[] = [];
  private frame: number[] = [];
  private work: number[] = [];
  private warmUntil = 0;
  private holdUntil = 0; // like warmUntil, but only set by warm-ups and callers' holds, not by a stray long frame
  private longFrames = 0; // consecutive frames over maxFrameMs
  private lastEval = 0;
  private raiseAfter = 0;
  private raisedAt = -Infinity;
  private backoff = 0;

  /** How long without a change counts as settled; tests and `?settle=` shorten it. */
  settleMs = ADAPT.settleMs;
  private stableMs = 0; // riding time (measured frames) since the last change
  private settledReported = false;

  constructor(start: Tier, ceiling: Tier, adaptTier: boolean, now = 0, noShadows = false, scaleIdx = 0) {
    this.state = { tier: start, scaleIdx, noShadows };
    this.ceiling = ceiling;
    this.adaptTier = adaptTier;
    this.warmUntil = now + ADAPT.warmupMs;
    this.holdUntil = this.warmUntil;
  }

  /** Forget what was measured and wait out a warm-up (a resize, the hub closing, the tab coming back). */
  hold(now: number, ms = ADAPT.warmupMs) {
    this.t = []; this.frame = []; this.work = [];
    this.warmUntil = Math.max(this.warmUntil, now + ms);
    this.holdUntil = Math.max(this.holdUntil, now + ms);
    this.longFrames = 0;
  }

  /** The ceiling or the choice changed: start again from this state. */
  reset(state: AdaptState, now: number) {
    this.state = { ...state };
    this.raiseAfter = 0; this.backoff = 0; this.raisedAt = -Infinity;
    this.stableMs = 0; this.settledReported = false;
    this.hold(now);
  }

  /** One frame: its interval since the last, and the time spent in the render call. Returns a change to apply, if any. */
  push(now: number, frameMs: number, workMs: number): AdaptEvent | null {
    if (frameMs > ADAPT.maxFrameMs || frameMs <= 0) {
      // A gap this long is a stall (a load, a shader compile), not a sample. Several in a row are a device that cannot keep up.
      const counts = frameMs > 0 && now >= this.holdUntil;
      const run = counts ? this.longFrames + 1 : 0;
      this.t = []; this.frame = []; this.work = [];
      this.warmUntil = Math.max(this.warmUntil, now + 1500);
      this.longFrames = run;
      if (run >= ADAPT.longRun) { this.longFrames = 0; return this.lower(now, true); }
      return null;
    }
    this.longFrames = 0;
    if (now < this.warmUntil) return null;
    this.t.push(now); this.frame.push(frameMs); this.work.push(workMs);
    this.stableMs += frameMs;
    while (this.t.length && now - this.t[0] > ADAPT.fastWindowMs) { this.t.shift(); this.frame.shift(); this.work.shift(); }
    if (now - this.lastEval < ADAPT.evalEveryMs) return null;
    this.lastEval = now;

    const from = this.t.findIndex((x) => now - x <= ADAPT.slowWindowMs);
    const span = now - this.t[0];
    if (from >= 0 && span >= ADAPT.slowWindowMs * 0.9) {
      const recent = this.frame.slice(from);
      // 20 frames make a fair verdict; at a few frames a second (150-400 ms each) there are never 20 in the
      // window, so a handful is enough when they are plainly far too slow.
      if (recent.length >= 20 || (recent.length >= ADAPT.slowFewFrames && median(recent) > ADAPT.slowFewMs)) {
        const v = judge(recent);
        if (v.jerky) return this.lower(now, v.severe);
      }
    }
    if (span >= ADAPT.fastWindowMs * 0.95 && now >= this.raiseAfter && this.canRaise()) {
      const mf = median(this.frame);
      if (mf < ADAPT.fastMs || (mf < ADAPT.fastBusyMs && median(this.work) < ADAPT.fastWorkMs)) return this.raise(now);
    }
    return null;
  }

  private canRaise() {
    const s = this.state;
    return s.noShadows || s.scaleIdx > 0 || (this.adaptTier && TIERS.indexOf(s.tier) < TIERS.indexOf(this.ceiling));
  }

  private lower(now: number, severe: boolean): AdaptEvent | null {
    const s = this.state;
    let fast = false;
    if (severe && this.adaptTier && s.tier !== 'low') {
      // Clearly struggling: a whole tier at once, back at full sharpness.
      s.tier = TIERS[TIERS.indexOf(s.tier) - 1]; s.scaleIdx = 0; fast = true;
    } else if (s.scaleIdx < SCALES.length - 1) s.scaleIdx++;
    else if (this.adaptTier && s.tier !== 'low') { s.tier = TIERS[TIERS.indexOf(s.tier) - 1]; s.scaleIdx = 0; }
    else if (this.adaptTier && !s.noShadows) s.noShadows = true;
    else { this.hold(now, ADAPT.cooldownMs); return null; } // nothing left to give up
    if (now - this.raisedAt < ADAPT.undoWithinMs) {
      this.raiseAfter = now + ADAPT.backoffMs[Math.min(this.backoff, ADAPT.backoffMs.length - 1)];
      this.backoff++;
    } else {
      this.raiseAfter = now + ADAPT.minRaiseGapMs;
    }
    this.changed();
    this.hold(now, fast ? ADAPT.fastCooldownMs : ADAPT.cooldownMs);
    return { ...s, reason: 'slow', fast };
  }

  /** A change of state: settling starts again. */
  private changed() { this.stableMs = 0; this.settledReported = false; }

  /** The state, once, after `settleMs` of riding without a change; null otherwise. Graphics remembers it. */
  takeSettled(): AdaptState | null {
    if (this.settledReported || this.stableMs < this.settleMs) return null;
    this.settledReported = true;
    return { ...this.state };
  }

  private raise(now: number): AdaptEvent | null {
    const s = this.state;
    if (s.noShadows) s.noShadows = false;
    else if (s.scaleIdx > 0) s.scaleIdx--;
    else if (this.adaptTier && TIERS.indexOf(s.tier) < TIERS.indexOf(this.ceiling)) { s.tier = TIERS[TIERS.indexOf(s.tier) + 1]; s.scaleIdx = 1; }
    else return null;
    this.raisedAt = now;
    this.changed();
    this.hold(now, ADAPT.cooldownMs);
    return { ...s, reason: 'headroom' };
  }
}
