// Scheduled group rides and races: the schedule, the server's clock, and the
// results (upcoming_events, server_now, submit_event_result, event_results and
// the admin functions in db/schema.sql).

import type { EventKind } from '../schedule';
import { account } from './account';
import { neon } from './client';

export interface EventRow {
  id: string;
  kind: EventKind;
  stage_id: string;
  title: string;
  starts_at: string;
  seed: number;
  pace_wkg: number | null;
  duration_min: number;
  waiting: number; // riders in the lobby / on the road right now
  results: number;
  my_finish_s: number | null;
}

export interface EventResultRow { rank: number; name: string; finish_s: number; avg_power: number | null; is_me: boolean }

async function check<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>) {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

// ---------------------------------------------------------------- clock ----

let offsetMs = 0; // server time minus this device's clock
let synced = false;

/** Server time in ms. Before the first sync (or if it fails) this is the device clock. */
export const serverNow = () => Date.now() + offsetMs;
export const clockSynced = () => synced;

/**
 * Asks the server what time it is and keeps the offset (server − local), using the middle of the
 * round trip. Takes the best of a few tries (the quickest round trip is the most accurate).
 */
export async function syncServerClock(tries = 3): Promise<number> {
  if (!account()) return offsetMs;
  let best: { rtt: number; offset: number } | null = null;
  for (let i = 0; i < tries; i++) {
    const t0 = Date.now();
    try {
      const iso = (await check(neon.rpc('server_now'))) as unknown as string;
      const t1 = Date.now();
      const server = new Date(iso).getTime();
      if (!Number.isFinite(server)) continue;
      const rtt = t1 - t0;
      if (!best || rtt < best.rtt) best = { rtt, offset: server - (t0 + rtt / 2) };
    } catch {
      break;
    }
  }
  if (best) { offsetMs = best.offset; synced = true; }
  return offsetMs;
}

// -------------------------------------------------------------- events ----

/** Upcoming events (and the last 12 hours'); the server creates the daily schedule on demand. */
export async function upcomingEvents(hours = 48): Promise<EventRow[]> {
  if (!account()) return [];
  return ((await check(neon.rpc('upcoming_events', { p_hours: hours }))) ?? []) as EventRow[];
}

/** Your result for a finished race. Returns false if you already had one. */
export async function submitEventResult(eventId: string, finishS: number, avgPower: number): Promise<boolean> {
  return (await check(neon.rpc('submit_event_result', { p_event: eventId, p_finish_s: Math.round(finishS), p_avg_power: Math.round(avgPower * 10) / 10 }))) === true;
}

export async function eventResults(eventId: string): Promise<EventResultRow[]> {
  if (!account()) return [];
  return ((await check(neon.rpc('event_results', { p_event: eventId }))) ?? []) as EventResultRow[];
}

// ---------------------------------------------------------------- admin ----

export async function adminCreateEvent(kind: EventKind, stageId: string, startsAt: Date, title: string, paceWkg?: number) {
  return (await check(neon.rpc('admin_create_event', { p_kind: kind, p_stage: stageId, p_starts_at: startsAt.toISOString(), p_title: title, p_pace_wkg: paceWkg ?? null }))) as string;
}

export async function adminDeleteEvent(eventId: string) {
  await check(neon.rpc('admin_delete_event', { p_event: eventId }));
}
