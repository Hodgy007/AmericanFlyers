// Hands out the coach's ride plan one tip at a time as you reach each place
// (metres along the course, or seconds into a workout). Tips you rode past by a
// long way (you jumped ahead on the profile) are skipped, not read late. Pure.

import type { CoachTip } from './types';

export const STALE_M = 500;

export class PlanRunner {
  private shown = new Set<number>();
  constructor(readonly tips: CoachTip[]) {}

  /** The next tip that is due, if any. Call each frame; it returns each tip once. */
  due(distanceM: number, workoutS: number | null): CoachTip | null {
    for (let i = 0; i < this.tips.length; i++) {
      if (this.shown.has(i)) continue;
      const t = this.tips[i];
      if (t.at_m !== null && distanceM >= t.at_m) {
        this.shown.add(i);
        if (distanceM - t.at_m > STALE_M) continue;
        return t;
      }
      if (t.at_s !== null && workoutS !== null && workoutS >= t.at_s) {
        this.shown.add(i);
        return t;
      }
    }
    return null;
  }

  get remaining() {
    return this.tips.length - this.shown.size;
  }
}
