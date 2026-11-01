// When a rival speaks. The engine turns the state of the race between you and
// the rival into trigger events (the keys of the lines Claude wrote), and the
// speaker lets at most one line through every 15 seconds so the road isn't a
// chat room. Finish lines always get through. Pure.

import type { RivalTrigger } from './types';

export interface TriggerState {
  /** Metres the rival is ahead of you (negative: you are ahead). */
  gap: number;
  attacking: boolean;
  /** Metres to the finish for you, or null on an endless road. */
  remaining: number | null;
  /** The rival has started moving. */
  started: boolean;
  finished: 'rival' | 'player' | null;
}

const NEAR = 8; // within this many metres counts as level
const DROP = 60;

export class RivalTriggerEngine {
  private began = false;
  private side: 'rival' | 'player' | null = null; // who was clearly ahead last
  private wasAttacking = false;
  private dropFired = false;
  private youDropFired = false;
  private lastKm = false;
  private done = false;

  update(s: TriggerState): RivalTrigger[] {
    const out: RivalTrigger[] = [];
    if (!s.started) return out;
    if (!this.began) { this.began = true; out.push('start'); }
    if (this.done) return out;

    if (s.finished) {
      this.done = true;
      out.push(s.finished === 'rival' ? 'they_win' : 'you_win');
      return out;
    }
    if (s.attacking && !this.wasAttacking) out.push('they_attack');
    this.wasAttacking = s.attacking;

    if (s.gap > NEAR) { this.side = 'rival'; }
    else if (s.gap < -NEAR) {
      if (this.side === 'rival') out.push('you_pass');
      this.side = 'player';
    }
    if (s.gap > DROP && !this.dropFired) { this.dropFired = true; out.push('they_drop_you'); }
    if (s.gap < 20) this.dropFired = false;
    if (s.gap < -DROP && !this.youDropFired) { this.youDropFired = true; out.push('you_drop_them'); }
    if (s.gap > -20) this.youDropFired = false;

    if (s.remaining !== null && s.remaining <= 1000 && !this.lastKm) { this.lastKm = true; out.push('last_km'); }
    return out;
  }
}

const PRIORITY: Record<RivalTrigger, number> = {
  they_win: 3, you_win: 3, they_attack: 2, they_drop_you: 2, you_drop_them: 2, last_km: 2, you_pass: 1, start: 1,
};
export const MIN_LINE_GAP_S = 15;

/** One line at a time, with a pause between lines. */
export class LineLimiter {
  private lastAt = -Infinity;
  /** True if the trigger may speak at `nowS`; remembers it if so. */
  accept(trigger: RivalTrigger, nowS: number): boolean {
    if (PRIORITY[trigger] < 3 && nowS - this.lastAt < MIN_LINE_GAP_S) return false;
    this.lastAt = nowS;
    return true;
  }
}
