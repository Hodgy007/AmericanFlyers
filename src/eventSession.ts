// The logic of riding a scheduled event, kept free of the DOM and the 3D scene
// so it can be unit-tested: the shared clock, the "you've been dropped" watcher
// for group rides, and merging real riders' results with the bots'.

import type { EventKind } from './schedule';

/** A scheduled event you have joined. */
export interface ActiveEvent {
  id: string;
  kind: EventKind;
  stageId: string;
  title: string;
  startsAtMs: number;
  seed: number;
  paceWkg: number | null;
  durationMin: number;
}

/**
 * Everyone in a scheduled race sees the same bots, so the field is scaled to this fixed
 * watts per kilo rather than to each rider's own. (A 2.5 W/kg rider will find it hard; that
 * is racing.)
 */
export const EVENT_REF_WKG = 3.4;

/** Seconds since the event's start by the server's clock (negative before it). */
export const secondsSinceStart = (ev: Pick<ActiveEvent, 'startsAtMs'>, serverNowMs: number) => (serverNowMs - ev.startsAtMs) / 1000;

/** Has the event run its course (a group ride ends after its duration)? */
export const eventOver = (ev: Pick<ActiveEvent, 'startsAtMs' | 'durationMin'>, serverNowMs: number) =>
  serverNowMs > ev.startsAtMs + ev.durationMin * 60000;

// ------------------------------------------------------------ group ride ----

export const DROPPED_GAP_M = 100; // further behind the back of the group than this and you are dropped
export const BACK_GAP_M = 30; // closer than this and you are back
const NOTE_EVERY_S = 90;

/** Watches how far you are behind the pace group and says when you are dropped, and when you are back. */
export class DropWatcher {
  private dropped = false;
  private lastNote = -Infinity;

  /**
   * `gapM` is how far you are behind the back of the group (negative if you are ahead of it);
   * `nowS` is any steady clock. Returns what to tell the rider, if anything.
   */
  update(gapM: number, nowS: number): 'dropped' | 'back' | null {
    if (!this.dropped && gapM > DROPPED_GAP_M && nowS - this.lastNote >= NOTE_EVERY_S) {
      this.dropped = true;
      this.lastNote = nowS;
      return 'dropped';
    }
    if (this.dropped && gapM < BACK_GAP_M) {
      this.dropped = false;
      return 'back';
    }
    // Still off the back: remind them now and then, gently.
    if (this.dropped && gapM > DROPPED_GAP_M && nowS - this.lastNote >= NOTE_EVERY_S * 2) {
      this.lastNote = nowS;
      return 'dropped';
    }
    return null;
  }

  get isDropped() {
    return this.dropped;
  }
}

// ---------------------------------------------------------------- results ----

export interface BotResult { name: string; time: number; team: number; you: boolean }
export interface RealResult { name: string; finish_s: number; is_me: boolean }
export interface MergedResult { name: string; time: number; kind: 'bot' | 'real' | 'you'; team: number }

/**
 * One table for the finish card: the computer-ridden field, the real riders who have
 * submitted a time, and you (from your own time), fastest first. You are shown once, even
 * if the server already has your result.
 */
export function mergeEventResults(bots: BotResult[], real: RealResult[], myTime: number): MergedResult[] {
  const rows: MergedResult[] = [];
  for (const b of bots) if (!b.you) rows.push({ name: b.name, time: b.time, kind: 'bot', team: b.team });
  for (const r of real) if (!r.is_me) rows.push({ name: r.name, time: r.finish_s, kind: 'real', team: -1 });
  rows.push({ name: 'You', time: myTime, kind: 'you', team: -1 });
  // Stable for equal times, with real riders ahead of bots and you ahead of everyone.
  const rank = { you: 0, real: 1, bot: 2 } as const;
  return rows.sort((a, b) => a.time - b.time || rank[a.kind] - rank[b.kind]);
}
