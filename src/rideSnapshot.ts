// A safety copy of the ride in progress, kept in localStorage, so a crash or a closed tab doesn't lose it.
// It is rewritten every ~20 s while riding (and when the page is hidden or closed) and offered back at the next
// visit: Resume, Save it and start fresh, or Discard. Pure save/restore logic lives here; main.ts does the wiring.

import type { Samples } from './cloud/sync';
import type { RideStats } from './stats';

export const SNAPSHOT_KEY = 'americanflyers.rideSnapshot';
/** How often the copy is rewritten while riding. */
export const SNAPSHOT_EVERY_MS = 20_000;
/** A copy older than this is not offered for resuming (it is saved quietly instead). */
export const SNAPSHOT_MAX_AGE_MS = 3 * 60 * 60 * 1000;
/** Shorter rides are not worth offering (or saving). */
export const SNAPSHOT_MIN_S = 60;

export interface SnapshotRide {
  distance: number;
  startDistance: number;
  movingTime: number;
  climbed: number;
  work: number;
  proM: number;
  planCounted: boolean;
}

export interface RideSnapshot {
  v: 1;
  /** Date.now() when written. */
  takenAt: number;
  accountId: string;
  stageId: string;
  /** For saving the ride if the stage has since been deleted. */
  stageName: string;
  ride: SnapshotRide;
  flags: { usedDemo: boolean; timeScale: number; splitByWorkout: boolean };
  span: {
    /** The activity's id: a resumed ride keeps it, so later saves update the same activity. */
    id: string;
    startedAt: string | null;
    samples: Samples;
    /** Baselines (see rideActivity.ts): where the trip was when this activity began. */
    dist0: number;
    climb0: number;
    proM0: number;
    /** The workout this activity was (not resumed as a workout: it carries on as a ride). */
    workout: string | null;
    workoutCompleted: string | null;
    /** Distance and climbing in this activity so far (for saving it without resuming). */
    distanceM: number;
    climbedM: number;
  };
}

export function serialiseSnapshot(s: RideSnapshot): string {
  return JSON.stringify(s);
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNumArray = (v: unknown): v is number[] => Array.isArray(v) && v.every(isNum);

/** The snapshot in `raw`, or null if it is missing or not what we wrote (another version, a half-written value). */
export function parseSnapshot(raw: string | null | undefined): RideSnapshot | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<RideSnapshot> | null;
    if (!s || s.v !== 1 || !isNum(s.takenAt) || typeof s.accountId !== 'string' || typeof s.stageId !== 'string' || typeof s.stageName !== 'string') return null;
    const r = s.ride;
    if (!r || !isNum(r.distance) || !isNum(r.startDistance) || !isNum(r.movingTime) || !isNum(r.climbed) || !isNum(r.work) || !isNum(r.proM)) return null;
    const f = s.flags;
    if (!f || !isNum(f.timeScale)) return null;
    const p = s.span;
    if (!p || typeof p.id !== 'string' || !isNum(p.dist0) || !isNum(p.climb0) || !isNum(p.proM0) || !isNum(p.distanceM) || !isNum(p.climbedM)) return null;
    const x = p.samples;
    if (!x || !isNumArray(x.power) || !isNumArray(x.cadence) || !isNumArray(x.hr) || !isNumArray(x.speed) || !isNumArray(x.distance) || !isNumArray(x.elevation)) return null;
    const n = x.power.length;
    if ([x.cadence, x.hr, x.speed, x.distance, x.elevation].some((a) => a.length !== n)) return null;
    return {
      v: 1,
      takenAt: s.takenAt,
      accountId: s.accountId,
      stageId: s.stageId,
      stageName: s.stageName,
      ride: { distance: r.distance, startDistance: r.startDistance, movingTime: r.movingTime, climbed: r.climbed, work: r.work, proM: r.proM, planCounted: r.planCounted === true },
      flags: { usedDemo: f.usedDemo === true, timeScale: f.timeScale, splitByWorkout: f.splitByWorkout === true },
      span: {
        id: p.id,
        startedAt: typeof p.startedAt === 'string' ? p.startedAt : null,
        samples: x as Samples,
        dist0: p.dist0, climb0: p.climb0, proM0: p.proM0,
        workout: typeof p.workout === 'string' ? p.workout : null,
        workoutCompleted: typeof p.workoutCompleted === 'string' ? p.workoutCompleted : null,
        distanceM: p.distanceM, climbedM: p.climbedM,
      },
    };
  } catch {
    return null;
  }
}

export type SnapshotVerdict = 'offer' | 'save' | 'drop';

/**
 * What to do with a snapshot found at start-up for `accountId`:
 * - `offer`: young enough (under 3 hours), at least a minute recorded and its stage still exists: ask the rider.
 * - `save`: worth keeping but too old, or its stage is gone: save it to the account quietly rather than lose it.
 * - `drop`: too short, or another rider's (never touched: it is theirs).
 */
export function judgeSnapshot(s: RideSnapshot, now: number, accountId: string, stageExists: (id: string) => boolean): SnapshotVerdict {
  if (s.accountId !== accountId) return 'drop';
  if (s.span.samples.power.length < SNAPSHOT_MIN_S) return 'drop';
  if (now - s.takenAt > SNAPSHOT_MAX_AGE_MS || now < s.takenAt - 60_000 || !stageExists(s.stageId)) return 'save';
  return 'offer';
}

/** Is this snapshot usable for the rider to pick up (the "offer" verdict)? */
export function snapshotUsable(s: RideSnapshot, now: number, accountId: string, stageExists: (id: string) => boolean): boolean {
  return judgeSnapshot(s, now, accountId, stageExists) === 'offer';
}

const KM_PER_MI = 1.609344;

/** "32:10 · 14.2 km, interrupted 7 min ago" for the resume prompt. */
export function snapshotSummary(s: RideSnapshot, now: number, imperial: boolean): string {
  const secs = s.span.samples.power.length;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const sec = secs % 60;
  const time = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  const km = s.span.distanceM / 1000;
  const dist = imperial ? `${(km / KM_PER_MI).toFixed(1)} mi` : `${km.toFixed(1)} km`;
  return `${time} · ${dist}, interrupted ${ago(now - s.takenAt)}`;
}

function ago(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 1) return 'moments ago';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h} h ${rest} min ago` : `${h} h ago`;
}

/**
 * Rebuilds ride statistics from the recorded one-second samples. Good enough rather than exact: averages, normalised
 * power, best efforts and zones come out right to within a second; only what the recorder never kept differs (a fraction
 * of a second carried between samples, and the moments the rider was not moving, which were never sampled).
 */
export function replayStats(samples: Samples, stats: RideStats): RideStats {
  for (let i = 0; i < samples.power.length; i++) stats.add(1, samples.power[i], samples.cadence[i], samples.hr[i], true);
  return stats;
}
