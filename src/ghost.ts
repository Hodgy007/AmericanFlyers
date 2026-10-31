// A ghost: a past whole-stage ride replayed second by second (by moving
// time), so you can race your best, or anyone's on the leaderboard.

import type { GhostTrace } from './cloud/sync';

export class Ghost {
  readonly name: string;
  readonly finishS: number;
  readonly isMe: boolean;
  private readonly d: number[];

  constructor(trace: GhostTrace) {
    this.name = trace.name;
    this.finishS = trace.finish_s;
    this.isMe = trace.is_me;
    this.d = trace.distance;
  }

  /** Metres from the start line after `t` seconds of moving time. */
  distanceAt(t: number) {
    const d = this.d;
    if (t <= 0 || !d.length) return 0;
    const i = Math.floor(t);
    if (i >= d.length - 1) return d[d.length - 1];
    return d[i] + (d[i + 1] - d[i]) * (t - i);
  }

  speedAt(t: number) {
    return Math.max(0, this.distanceAt(t + 0.5) - this.distanceAt(t - 0.5));
  }

  get label() {
    return this.isMe ? 'Your best' : `${this.name} (ghost)`;
  }
}

/** "1:02:03" or "42:10" */
export function raceTime(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
