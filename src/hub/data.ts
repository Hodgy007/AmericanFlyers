// The hub's pure logic: no DOM, no network. Weekly totals, best times, the plan's next
// session, the next scheduled events, what "Ride" will start, and the summary that is
// cached between visits. Everything here is unit-tested in tests/unit/hub.test.ts.

import { achievements, type Achievement } from '../cloud/achievements';
import type { EventRow } from '../cloud/events';
import type { Activity, FtpEntry } from '../cloud/sync';
import { nextSession, sessions, type Plan, type PlanProgress } from '../plans';
import { dailySchedule, joinState, RACE_MINUTES, RIDE_MINUTES } from '../schedule';
import type { Stage } from '../stages';

const KM_PER_MI = 1.609344;

/** The free-ride stage: endless Heartland Rollers. */
export const FREE_RIDE_STAGE = 'heartland';

// -------------------------------------------------------------- choice ----

/** What the big Ride button starts: a stage, and optionally a workout to do on it. */
export interface Choice {
  stageId: string;
  workoutId: string | null;
}

/**
 * The stage a workout is ridden on. A workout is a timed block of effort, so it needs a road
 * with no finish line: keep the stage you picked if it is endless, otherwise the free-ride stage.
 */
export function stageForWorkout(currentId: string, stages: Pick<Stage, 'id' | 'finish'>[]): string {
  const cur = stages.find((s) => s.id === currentId);
  return cur && cur.finish === null ? cur.id : FREE_RIDE_STAGE;
}

/** Picking a route clears any workout: you want to ride that route. */
export function pickStage(_c: Choice, stageId: string): Choice {
  return { stageId, workoutId: null };
}

/** Picking a workout keeps an endless stage and otherwise falls back to the free-ride stage. */
export function pickWorkout(c: Choice, workoutId: string, stages: Pick<Stage, 'id' | 'finish'>[]): Choice {
  return { stageId: stageForWorkout(c.stageId, stages), workoutId };
}

// ------------------------------------------------------------- figures ----

/** Total climbing in metres over a stage (its first 20 km if endless). Same sums as stageClimbing() in main.ts. */
export function stageClimb(stage: Pick<Stage, 'finish' | 'elevationAt'>): number {
  let total = 0;
  let last = stage.elevationAt(0);
  for (let d = 10; d <= (stage.finish ?? 20000); d += 10) {
    const e = stage.elevationAt(d);
    if (e > last) total += e - last;
    last = e;
  }
  return total;
}

export interface StageFigures { lengthM: number | null; climbM: number }

const figureCache = new WeakMap<object, StageFigures>();
/** Length (null = endless) and climbing of a stage, worked out once. */
export function stageFigures(stage: Pick<Stage, 'finish' | 'elevationAt'>): StageFigures {
  let f = figureCache.get(stage);
  if (!f) {
    f = { lengthM: stage.finish, climbM: stageClimb(stage) };
    figureCache.set(stage, f);
  }
  return f;
}

// ---------------------------------------------------------- formatting ----

export function distanceText(m: number, imperial: boolean, dp = 1): string {
  return imperial ? `${(m / 1000 / KM_PER_MI).toFixed(dp)} mi` : `${(m / 1000).toFixed(dp)} km`;
}

export function climbText(m: number, imperial: boolean): string {
  return imperial ? `${Math.round(m * 3.28084).toLocaleString('en-US')} ft` : `${Math.round(m).toLocaleString('en-US')} m`;
}

/** "2 h 05 min", "45 min", "0 min". */
export function durationText(s: number): string {
  const mins = Math.round(s / 60);
  const h = Math.floor(mins / 60);
  return h ? `${h} h ${String(mins % 60).padStart(2, '0')} min` : `${mins} min`;
}

/** "2h 05m", "45m": short enough for a stat tile. */
export function durationShort(s: number): string {
  const mins = Math.round(s / 60);
  const h = Math.floor(mins / 60);
  return h ? `${h}h ${String(mins % 60).padStart(2, '0')}m` : `${mins}m`;
}

export function firstName(name: string): string {
  const first = name.trim().split(/\s+/)[0] ?? '';
  return first.includes('@') ? first.split('@')[0] : first;
}

export function greeting(hour: number): string {
  return hour < 5 ? 'Late night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

// -------------------------------------------------------------- totals ----

type Ride = Pick<Activity, 'started_at' | 'duration_s' | 'distance_m' | 'climbed_m' | 'tss'>;

export interface Totals {
  rides: number;
  timeS: number;
  distanceM: number;
  climbedM: number;
  /** Null when none of the rides has a TSS (no power data). */
  tss: number | null;
}

/** Monday 00:00 (local time) of the week `now` falls in, in ms. */
export function weekStart(now: Date): number {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** Midnight (local time) `days` days before today. */
function daysAgo(now: Date, days: number): number {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - days);
  return d.getTime();
}

/** Totals for rides that started in [from, to). */
export function totalsBetween(acts: Ride[], from: number, to = Infinity): Totals {
  const t: Totals = { rides: 0, timeS: 0, distanceM: 0, climbedM: 0, tss: null };
  for (const a of acts) {
    const at = new Date(a.started_at).getTime();
    if (!(at >= from && at < to)) continue;
    t.rides++;
    t.timeS += a.duration_s ?? 0;
    t.distanceM += a.distance_m ?? 0;
    t.climbedM += a.climbed_m ?? 0;
    if (a.tss !== null && a.tss !== undefined) t.tss = (t.tss ?? 0) + a.tss;
  }
  if (t.tss !== null) t.tss = Math.round(t.tss);
  return t;
}

/** This week (since Monday) and the last four weeks (the 28 days up to and including today). */
export function periodTotals(acts: Ride[], now = new Date()): { week: Totals; last4: Totals } {
  return {
    week: totalsBetween(acts, weekStart(now)),
    last4: totalsBetween(acts, daysAgo(now, 27)),
  };
}

/** Distance in each of the last `n` weeks, oldest first (the last one is this week). */
export function weeklyDistances(acts: Ride[], now = new Date(), n = 8): { start: number; distanceM: number }[] {
  const thisWeek = weekStart(now);
  return Array.from({ length: n }, (_, i) => {
    const start = new Date(thisWeek);
    start.setDate(start.getDate() - 7 * (n - 1 - i));
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start: start.getTime(), distanceM: totalsBetween(acts, start.getTime(), end.getTime()).distanceM };
  });
}

// --------------------------------------------------------------- rides ----

export interface BestTime { finishS: number; activityId: string; at: string }

/** Your fastest whole-stage time on each stage (rides that count for a leaderboard have a `finish_s`). */
export function bestTimes(acts: Pick<Activity, 'id' | 'started_at' | 'stage_id' | 'finished' | 'finish_s'>[]): Record<string, BestTime> {
  const out: Record<string, BestTime> = {};
  for (const a of acts) {
    if (!a.stage_id || !a.finished || !a.finish_s || a.finish_s <= 0) continue;
    const cur = out[a.stage_id];
    if (!cur || a.finish_s < cur.finishS) out[a.stage_id] = { finishS: a.finish_s, activityId: a.id, at: a.started_at };
  }
  return out;
}

export interface RideRow {
  id: string;
  startedAt: string;
  title: string;
  durationS: number;
  distanceM: number;
  climbedM: number;
  avgPower: number | null;
  finished: boolean;
}

/** The newest `n` rides, newest first. */
export function recentRides(acts: Pick<Activity, 'id' | 'started_at' | 'title' | 'duration_s' | 'distance_m' | 'climbed_m' | 'avg_power' | 'finished'>[], n = 5): RideRow[] {
  return [...acts]
    .sort((a, b) => b.started_at.localeCompare(a.started_at))
    .slice(0, n)
    .map((a) => ({ id: a.id, startedAt: a.started_at, title: a.title, durationS: a.duration_s, distanceM: a.distance_m, climbedM: a.climbed_m, avgPower: a.avg_power, finished: a.finished }));
}

// ----------------------------------------------------------------- FTP ----

export interface FtpSummary {
  current: number;
  /** The first recorded FTP, if the history has any entries. */
  first: number | null;
  /** Current minus first (0 with no history). */
  change: number;
  points: { t: number; w: number }[];
}

export function ftpSummary(history: Pick<FtpEntry, 'ftp' | 'recorded_at'>[], current: number): FtpSummary {
  const points = history.map((f) => ({ t: new Date(f.recorded_at).getTime(), w: f.ftp }));
  const first = points.length ? points[0].w : null;
  return { current, first, change: first === null ? 0 : current - first, points };
}

// ---------------------------------------------------------- achievements ----

export interface AchievementPicks {
  earned: Achievement[];
  total: number;
  /** The ones closest to being earned, most progress first. */
  next: Achievement[];
}

export function achievementPicks(list: Achievement[], nextN = 4): AchievementPicks {
  const earned = list.filter((a) => a.done);
  const next = list.filter((a) => !a.done).sort((a, b) => b.progress - a.progress).slice(0, nextN);
  return { earned, total: list.length, next };
}

// ---------------------------------------------------------------- plan ----

export interface PlanSummary {
  plan: Plan;
  done: number;
  total: number;
  pct: number;
  complete: boolean;
  next: ReturnType<typeof nextSession>;
  /** The sessions after the next one that are not done yet (up to `n`). */
  upcoming: (ReturnType<typeof sessions>[number] & { index: number })[];
}

export function planSummary(plan: Plan, progress: PlanProgress, n = 3): PlanSummary {
  const all = sessions(plan);
  const next = nextSession(plan, progress);
  const done = all.filter((_, i) => progress.done.includes(i)).length;
  const upcoming = all
    .map((s, index) => ({ ...s, index }))
    .filter((s) => !progress.done.includes(s.index) && s.index !== next?.index)
    .slice(0, n);
  return { plan, done, total: all.length, pct: all.length ? Math.round((done / all.length) * 100) : 0, complete: next === null, next, upcoming };
}

// -------------------------------------------------------------- events ----

const durationOf = (kind: EventRow['kind']) => (kind === 'race' ? RACE_MINUTES : RIDE_MINUTES);

/** The daily schedule shaped like server rows, for riders who are signed out (or when the server can't be reached). */
export function scheduleRows(nowMs: number, hours = 48): EventRow[] {
  return dailySchedule(nowMs, hours).map((e, i) => ({
    id: `sched-${i}`, kind: e.kind, stage_id: e.stageId, title: e.title, starts_at: new Date(e.startsAt).toISOString(), seed: 0,
    pace_wkg: e.paceWkg, duration_min: durationOf(e.kind), waiting: 0, results: 0, my_finish_s: null,
  }));
}

/** The next race and the next group ride you could still join (or that have not started yet). */
export function nextEvents(rows: EventRow[], nowMs: number): { race: EventRow | null; groupRide: EventRow | null } {
  const sorted = [...rows].sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  const pick = (kind: EventRow['kind']) =>
    sorted.find((r) => r.kind === kind && joinState(kind, new Date(r.starts_at).getTime(), nowMs) !== 'late') ?? null;
  return { race: pick('race'), groupRide: pick('group_ride') };
}

// ------------------------------------------------------------- summary ----

/** Everything the account-fed cards show, worked out from the rider's rides. Plain JSON, so it can be cached. */
export interface Summary {
  builtAt: number;
  rides: number;
  week: Totals;
  last4: Totals;
  weekly: { start: number; distanceM: number }[];
  bests: Record<string, BestTime>;
  recent: RideRow[];
  ftp: FtpSummary;
  achievements: Achievement[];
}

export function buildSummary(input: { acts: Activity[]; ftp: FtpEntry[]; riderKg: number; ftpNow: number; now?: Date }): Summary {
  const now = input.now ?? new Date();
  const { week, last4 } = periodTotals(input.acts, now);
  return {
    builtAt: now.getTime(),
    rides: input.acts.length,
    week,
    last4,
    weekly: weeklyDistances(input.acts, now, 8),
    bests: bestTimes(input.acts),
    recent: recentRides(input.acts, 5),
    ftp: ftpSummary(input.ftp, input.ftpNow),
    achievements: achievements(input.acts, input.ftp, input.riderKg),
  };
}
