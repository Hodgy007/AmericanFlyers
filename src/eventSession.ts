// The logic of riding a scheduled event, kept free of the DOM and the 3D scene
// so it can be unit-tested: the shared clock, the "you've been dropped" watcher
// for group rides, and merging real riders' results with the bots'.

import type { EventRow } from './cloud/events';
import { countdownLabel, type EventKind } from './schedule';
import type { Stage } from './stages';

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

/** The event a joined row becomes. `startsAtMs` is the row's start as milliseconds since the epoch. */
export function activeEvent(row: EventRow, startsAtMs: number): ActiveEvent {
  return {
    id: row.id, kind: row.kind, stageId: row.stage_id, title: row.title, startsAtMs, seed: row.seed, paceWkg: row.pace_wkg, durationMin: row.duration_min,
  };
}

/**
 * Is the event's stage here to ride? `stage` is what the library gave for the row's stage id: it comes back as
 * another stage when the id is unknown, and a race needs a stage with a finish line.
 */
export const eventStageAvailable = (row: Pick<EventRow, 'stage_id' | 'kind'>, stage: Pick<Stage, 'id' | 'finish'>) =>
  stage.id === row.stage_id && !(row.kind === 'race' && stage.finish === null);

/** A group ride holds the rider on the line until its start; a race holds through the race's own countdown instead. */
export const eventHolding = (ev: Pick<ActiveEvent, 'kind' | 'startsAtMs'>, serverNowMs: number) =>
  ev.kind === 'group_ride' && secondsSinceStart(ev, serverNowMs) < 0;

/** What the toast says on joining: `t` is `secondsSinceStart` at that moment. */
export const joinMessage = (title: string, t: number) =>
  t < 0 ? `You’re on the line for ${title}. The start is synchronised for everyone.` : `${title} is under way. Go!`;

// ---------------------------------------------------------- lobby strip ----

/** Minutes and seconds, for the lobby strip: 4:07. */
export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** The lobby strip's status before the start: `t` is `secondsSinceStart` (negative), `others` the other riders on the line. */
export function lobbyStatus(t: number, others: number): string {
  const where = others > 0 ? ` · ${others} other rider${others === 1 ? '' : 's'} on the line` : '';
  return `${t > -3600 ? `Starts in ${mmss(-t)}` : countdownLabel(-t * 1000)}${where}`;
}

export const GROUP_RIDE_OVER_MESSAGE = 'The group ride is over. Thanks for riding!';

/** What the rider is told when a `DropWatcher` note comes up. */
export function dropMessage(note: 'dropped' | 'back'): { text: string; ms: number } {
  return note === 'dropped'
    ? { text: 'You’ve been dropped. The group keeps its pace and won’t wait: dig in to get back on, or ride your own ride.', ms: 6000 }
    : { text: 'Back with the group. Nice work!', ms: 3500 };
}

/** The lobby strip's status on a group ride: where the rider is against the back of the group (`gapM`, negative if ahead of it) and the ride's clock. */
export function groupRideStatus(gapM: number, dropped: boolean, t: number): string {
  const where = dropped
    ? `${Math.round(gapM)} m off the back`
    : gapM > 8 ? `${Math.round(gapM)} m behind the group` : gapM < -8 ? `${Math.round(-gapM)} m ahead of the group` : 'with the group';
  return `${where} · ${mmss(t)} in`;
}

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

/** Does this ride count towards the event results? Not a demo ride, not a sped-up clock, and only if the rider pedalled. */
export const eventResultEligible = (demoUsed: boolean, timeScale: number, avgPower: number) => !demoUsed && timeScale === 1 && avgPower > 0;

export const INELIGIBLE_NOTE = 'Demo rides and sped-up clocks don’t count towards the event results.';

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
