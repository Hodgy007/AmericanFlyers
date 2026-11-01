// What happened between you and a rival during a ride, boiled down to the few
// facts the rival's memory note is written from. Pure.

import type { RivalMoment, RivalTrigger } from './types';

export class RideStory {
  private flags = new Set<'cracked' | 'dropped_rival' | 'was_dropped'>();
  private maxGap = 0;

  /** A trigger fired; `gradePct` is the road's gradient at that moment. */
  trigger(t: RivalTrigger, gradePct: number) {
    if (t === 'they_drop_you') {
      this.flags.add('was_dropped');
      if (gradePct >= 5) this.flags.add('cracked');
    }
    if (t === 'you_drop_them') this.flags.add('dropped_rival');
  }

  /** Call every frame with the gap between you and the rival (metres). */
  gap(metres: number) {
    this.maxGap = Math.max(this.maxGap, Math.abs(metres));
  }

  /** The list for the post-ride request, given how it ended. */
  moments(won: boolean, gapS: number): RivalMoment[] {
    const out: RivalMoment[] = [];
    if (this.flags.has('cracked')) out.push('cracked_on_climb');
    if (this.flags.has('dropped_rival')) out.push('dropped_rival');
    if (this.flags.has('was_dropped')) out.push('was_dropped');
    if (gapS > 60) out.push(won ? 'solo_win' : 'solo_loss');
    else if (gapS < 6) out.push(won ? 'won_sprint' : 'lost_sprint');
    if (this.maxGap < 40) out.push('stayed_close');
    return out.slice(0, 6);
  }
}
