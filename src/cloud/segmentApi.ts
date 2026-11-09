// KOM segments in the account: storing an effort, the shared leaderboard, and your own best and latest (db/schema.sql,
// "KOM segments"). Shared boards only exist for built-in stages' segments; the app never sends demo or sped-up efforts.

import { pendingEfforts, setPendingEfforts, type PendingEffort } from '../segmentStore';
import { effortFromRow, type Effort, type EffortRow } from '../segments';
import { account } from './account';
import { neon } from './client';

async function check<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>) {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

export interface SegmentRow {
  rank: number;
  short_name: string;
  elapsed_s: number;
  avg_power: number | null;
  ridden_at: string;
  is_me: boolean;
  /** How many riders are on the board in all (the same on every row). */
  riders: number;
}

/** Each rider's best time (top 10, plus yours), this month or all time. Empty when signed out. */
export async function segmentLeaderboard(segmentId: string, since?: Date): Promise<SegmentRow[]> {
  if (!account()) return [];
  return ((await check(neon.rpc('segment_leaderboard', { p_segment: segmentId, p_since: since?.toISOString() ?? null }))) ?? []) as SegmentRow[];
}


/** Your best and your latest effort on a segment, from your account (null when signed out or none). */
export async function myEfforts(segmentId: string): Promise<{ best: Effort | null; last: Effort | null }> {
  const userId = account()?.id;
  if (!userId) return { best: null, last: null };
  const cols = 'elapsed_s, avg_power, splits, created_at';
  const q = () => neon.from('segment_efforts').select(cols).eq('user_id', userId).eq('segment_id', segmentId).eq('demo', false);
  const [best, last] = await Promise.all([
    check(q().order('elapsed_s', { ascending: true }).limit(1)),
    check(q().order('created_at', { ascending: false }).limit(1)),
  ]);
  const b = (best as EffortRow[] | null)?.[0];
  const l = (last as EffortRow[] | null)?.[0];
  return { best: b ? effortFromRow(b) : null, last: l ? effortFromRow(l) : null };
}

export interface EffortLogRow { segment_id: string; elapsed_s: number; created_at: string }

/** Every effort you have stored (segment, time, when), for achievements. */
export async function myEffortLog(): Promise<EffortLogRow[]> {
  const userId = account()?.id;
  if (!userId) return [];
  return ((await check(neon.from('segment_efforts').select('segment_id, elapsed_s, created_at').eq('user_id', userId).eq('demo', false).order('created_at', { ascending: true }).limit(2000))) ?? []) as EffortLogRow[];
}

/** Stores an effort. If the account can't be reached it waits on this device and goes with the next one. Returns whether it was sent. */
export async function saveSegmentEffort(stageId: string, segmentId: string, e: Effort): Promise<boolean> {
  const user = account()?.id;
  if (!user) return false;
  const item: PendingEffort = { user, stage_id: stageId, segment_id: segmentId, elapsed_s: e.t, avg_power: e.p > 0 ? e.p : null, splits: e.s, at: e.at };
  setPendingEfforts([...pendingEfforts(), item]);
  return flushPendingEfforts();
}

let flushing: Promise<boolean> | null = null;

/** Sends any efforts waiting on this device (this account's only). Returns whether none are left. */
export function flushPendingEfforts(): Promise<boolean> {
  if (flushing) return flushing;
  const run: Promise<boolean> = (flushing = sendPending().finally(() => { if (flushing === run) flushing = null; }));
  return run;
}

async function sendPending(): Promise<boolean> {
  const user = account()?.id;
  if (!user) return false;
  for (const p of pendingEfforts().filter((x) => x.user === user)) {
    try {
      await check(neon.from('segment_efforts').insert({ stage_id: p.stage_id, segment_id: p.segment_id, elapsed_s: p.elapsed_s, avg_power: p.avg_power, splits: p.splits, demo: false, created_at: new Date(p.at).toISOString() }));
    } catch (err) {
      // A row the database rejects for good (bad data) is dropped; anything else (offline) waits for next time.
      if (!/check constraint|violates|invalid/i.test((err as Error).message)) return false;
    }
    setPendingEfforts(pendingEfforts().filter((x) => !(x.user === p.user && x.at === p.at && x.segment_id === p.segment_id)));
  }
  return !pendingEfforts().some((x) => x.user === user);
}
