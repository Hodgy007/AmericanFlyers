import { SCALES, TIERS, type Tier } from './quality';

// The adaptive controller: watches frame times and lowers (or raises) quality.
// Loaded by graphics.ts a moment after the first frame (its own small chunk).
// Pure logic, tested in tests/unit/quality.test.ts.

export interface AdaptState {
  tier: Tier;
  scaleIdx: number; // index into SCALES
  noShadows: boolean; // last resort on a device that can't keep up even at Low and the lowest scale
}

export interface AdaptEvent extends AdaptState {
  reason: 'slow' | 'headroom';
}

export const ADAPT = {
  warmupMs: 4000, // shader compiles and the first terrain tiles: don't judge these
  cooldownMs: 6000, // after a change, wait before judging again
  slowWindowMs: 3000,
  slowMs: 22, // median frame above this (45 fps) is slow
  fastWindowMs: 10000,
  fastMs: 11, // median frame below this (90+ fps) is headroom on its own
  fastBusyMs: 19, // on a 60 Hz display frames can't be shorter than ~16.7: then headroom is ...
  fastWorkMs: 4.5, // ... little CPU time spent in the render call
  evalEveryMs: 500,
  minRaiseGapMs: 30000, // after lowering, don't try going up for this long
  backoffMs: [60000, 120000, 300000, 600000], // each time a raise had to be undone, wait longer
  undoWithinMs: 45000, // a lowering this soon after a raise means the raise was a mistake
  maxFrameMs: 400, // longer gaps (tab hidden, hitches) are not samples
};

function median(a: number[]): number {
  if (!a.length) return 0;
  const b = a.slice().sort((x, y) => x - y);
  return b[b.length >> 1];
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
  private lastEval = 0;
  private raiseAfter = 0;
  private raisedAt = -Infinity;
  private backoff = 0;

  constructor(start: Tier, ceiling: Tier, adaptTier: boolean, now = 0, noShadows = false) {
    this.state = { tier: start, scaleIdx: 0, noShadows };
    this.ceiling = ceiling;
    this.adaptTier = adaptTier;
    this.warmUntil = now + ADAPT.warmupMs;
  }

  /** Forget what was measured and wait out a warm-up (a resize, the hub closing, the tab coming back). */
  hold(now: number, ms = ADAPT.warmupMs) {
    this.t = []; this.frame = []; this.work = [];
    this.warmUntil = Math.max(this.warmUntil, now + ms);
  }

  /** The ceiling or the choice changed: start again from this state. */
  reset(state: AdaptState, now: number) {
    this.state = { ...state };
    this.raiseAfter = 0; this.backoff = 0; this.raisedAt = -Infinity;
    this.hold(now);
  }

  /** One frame: its interval since the last, and the time spent in the render call. Returns a change to apply, if any. */
  push(now: number, frameMs: number, workMs: number): AdaptEvent | null {
    if (frameMs > ADAPT.maxFrameMs || frameMs <= 0) { this.hold(now, 1500); return null; }
    if (now < this.warmUntil) return null;
    this.t.push(now); this.frame.push(frameMs); this.work.push(workMs);
    while (this.t.length && now - this.t[0] > ADAPT.fastWindowMs) { this.t.shift(); this.frame.shift(); this.work.shift(); }
    if (now - this.lastEval < ADAPT.evalEveryMs) return null;
    this.lastEval = now;

    const from = this.t.findIndex((x) => now - x <= ADAPT.slowWindowMs);
    const span = now - this.t[0];
    if (from >= 0 && span >= ADAPT.slowWindowMs * 0.9) {
      const recent = this.frame.slice(from);
      if (recent.length >= 20 && median(recent) > ADAPT.slowMs) return this.lower(now);
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

  private lower(now: number): AdaptEvent | null {
    const s = this.state;
    if (s.scaleIdx < SCALES.length - 1) s.scaleIdx++;
    else if (this.adaptTier && s.tier !== 'low') { s.tier = TIERS[TIERS.indexOf(s.tier) - 1]; s.scaleIdx = 0; }
    else if (this.adaptTier && !s.noShadows) s.noShadows = true;
    else { this.hold(now, ADAPT.cooldownMs); return null; } // nothing left to give up
    if (now - this.raisedAt < ADAPT.undoWithinMs) {
      this.raiseAfter = now + ADAPT.backoffMs[Math.min(this.backoff, ADAPT.backoffMs.length - 1)];
      this.backoff++;
    } else {
      this.raiseAfter = now + ADAPT.minRaiseGapMs;
    }
    this.hold(now, ADAPT.cooldownMs);
    return { ...s, reason: 'slow' };
  }

  private raise(now: number): AdaptEvent | null {
    const s = this.state;
    if (s.noShadows) s.noShadows = false;
    else if (s.scaleIdx > 0) s.scaleIdx--;
    else if (this.adaptTier && TIERS.indexOf(s.tier) < TIERS.indexOf(this.ceiling)) { s.tier = TIERS[TIERS.indexOf(s.tier) + 1]; s.scaleIdx = 1; }
    else return null;
    this.raisedAt = now;
    this.hold(now, ADAPT.cooldownMs);
    return { ...s, reason: 'headroom' };
  }
}
