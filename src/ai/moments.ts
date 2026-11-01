// Spots the few moments worth a coach's word while you ride: a slow cadence on
// a climb, heart rate drifting at steady power, going over a workout's target,
// and riding just behind someone without being in their draft. At most one tip
// every five minutes, and none of the same kind within ten. Pure: it only sees
// numbers, one frame at a time.

import type { CoachMoment } from './types';

export interface MomentSample {
  /** Seconds since the last sample. */
  dt: number;
  /** False when the ride is paused or over: nothing counts. */
  riding: boolean;
  gradePct: number;
  cadence: number;
  watts: number;
  /** The workout's target power, if a workout is running. */
  targetW: number | null;
  /** Heart rate (0 when there is none). */
  hr: number;
  /** Metres to the nearest rider ahead, if any. */
  gapAheadM: number | null;
  drafting: boolean;
}

export interface MomentHit {
  moment: CoachMoment;
  /** How long the moment has lasted, in seconds. */
  seconds: number;
  hrDriftPct: number | null;
}

export const TIP_GAP_S = 300; // at most one tip per five minutes
export const SAME_MOMENT_S = 600;
export const LOW_CADENCE_RPM = 60;
export const HR_DRIFT_LIMIT = 0.08;

interface Bucket { p: number; hr: number }

export class MomentDetector {
  private clock = 0;
  private lastAny = -Infinity;
  private last: Partial<Record<CoachMoment, number>> = {};
  private run: Record<'low_cadence_climb' | 'over_target' | 'no_draft', number> = { low_cadence_climb: 0, over_target: 0, no_draft: 0 };
  private buckets: Bucket[] = [];
  private acc = { s: 0, p: 0, hr: 0, hrS: 0 };

  reset() {
    this.clock = 0;
    this.lastAny = -Infinity;
    this.last = {};
    this.run = { low_cadence_climb: 0, over_target: 0, no_draft: 0 };
    this.buckets = [];
    this.acc = { s: 0, p: 0, hr: 0, hrS: 0 };
  }

  private allowed(m: CoachMoment) {
    return this.clock - this.lastAny >= TIP_GAP_S && this.clock - (this.last[m] ?? -Infinity) >= SAME_MOMENT_S;
  }

  private fire(m: CoachMoment, seconds: number, hrDriftPct: number | null = null): MomentHit | null {
    if (!this.allowed(m)) { if (m !== 'hr_drift') this.run[m] = 0; return null; }
    this.lastAny = this.last[m] = this.clock;
    if (m !== 'hr_drift') this.run[m] = 0;
    return { moment: m, seconds: Math.round(seconds), hrDriftPct };
  }

  update(s: MomentSample): MomentHit | null {
    if (!s.riding || s.dt <= 0) return null;
    this.clock += s.dt;
    const r = this.run;
    r.low_cadence_climb = s.cadence > 0 && s.cadence < LOW_CADENCE_RPM && s.gradePct >= 3 && s.watts > 0 ? r.low_cadence_climb + s.dt : 0;
    r.over_target = s.targetW !== null && s.targetW >= 50 && s.watts > s.targetW * 1.2 ? r.over_target + s.dt : 0;
    r.no_draft = s.gapAheadM !== null && s.gapAheadM > 0.5 && s.gapAheadM < 5 && !s.drafting && s.watts > 0 ? r.no_draft + s.dt : 0;

    // Heart rate against power, a minute at a time.
    this.acc.s += s.dt; this.acc.p += s.watts * s.dt;
    if (s.hr > 0) { this.acc.hr += s.hr * s.dt; this.acc.hrS += s.dt; }
    let drift: MomentHit | null = null;
    if (this.acc.s >= 60) {
      if (this.acc.hrS >= 40) this.buckets.push({ p: this.acc.p / this.acc.s, hr: this.acc.hr / this.acc.hrS });
      else this.buckets = []; // a gap in the heart-rate data: start again
      if (this.buckets.length > 14) this.buckets.shift();
      this.acc = { s: 0, p: 0, hr: 0, hrS: 0 };
      drift = this.checkDrift();
    }

    if (r.low_cadence_climb >= 30) return this.fire('low_cadence_climb', r.low_cadence_climb);
    if (r.over_target >= 20) return this.fire('over_target', r.over_target);
    if (r.no_draft >= 10) return this.fire('no_draft', r.no_draft);
    return drift;
  }

  /** Heart rate more than 8% higher at the same power, comparing the first and last five minutes of the last twelve. */
  private checkDrift(): MomentHit | null {
    const b = this.buckets;
    if (b.length < 12) return null;
    const w = b.slice(-12);
    const avg = (xs: Bucket[], k: keyof Bucket) => xs.reduce((a, x) => a + x[k], 0) / xs.length;
    const [p1, p2, h1, h2] = [avg(w.slice(0, 5), 'p'), avg(w.slice(-5), 'p'), avg(w.slice(0, 5), 'hr'), avg(w.slice(-5), 'hr')];
    if (p1 < 80 || Math.abs(p2 - p1) / p1 > 0.06) return null;
    const drift = (h2 - h1) / h1;
    if (drift <= HR_DRIFT_LIMIT) return null;
    return this.fire('hr_drift', 12 * 60, Math.round(drift * 100));
  }
}
