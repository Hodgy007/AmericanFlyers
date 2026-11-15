// A safety copy of the ride in progress, kept in localStorage, so a crash or a closed tab doesn't lose it.
// It is rewritten every ~20 s while riding (and when the page is hidden or closed) and offered back at the next
// visit: Resume, Save it and start fresh, or Discard. The format, the rules and the timing live here: what a copy holds
// (`buildSnapshot`), when one is written or cleared and what happens to a leftover one at start-up (`createSnapshotKeeper`),
// and what resuming or saving one means (`resumedRide`, `restoreSpan`, `interruptedActivity`). No DOM and no three.js: the keeper
// reads and acts on the rest of the app through `SnapshotKeeperDeps`, so it can be driven in a unit test
// (tests/unit/rideSnapshot.test.ts). Putting the values back into the live ride and world, the dialog, the toasts and the cloud
// save stay in main.ts.

import { RideRecorder } from './cloud/recorder';
import type { Activity, Samples } from './cloud/sync';
import { RideStats } from './stats';
import { buildActivityRow } from './rideActivity';
import { isDemoRide, type RideFlags } from './rideIntegrity';
import type { RideState } from './rideSim';
import type { Span } from './rideSpans';

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

/** What goes into a copy, as plain values: the ride, the stage, the flags and the activity being recorded. */
export interface SnapshotInput {
  /** Date.now() at the time of writing. */
  now: number;
  accountId: string;
  stage: { id: string; name: string };
  ride: SnapshotRide;
  flags: RideFlags;
  span: {
    id: string;
    startedAt: Date | null;
    samples: Samples;
    /** Where the trip was when this activity began. */
    base: { dist: number; climbed: number; proM: number };
    workout: string | null;
    completed: string | null;
    /** Distance and climbing in this activity so far. */
    distanceM: number;
    climbedM: number;
  };
}

/** The copy to store for these inputs. */
export function buildSnapshot(i: SnapshotInput): RideSnapshot {
  return {
    v: 1, takenAt: i.now, accountId: i.accountId, stageId: i.stage.id, stageName: i.stage.name,
    ride: { distance: i.ride.distance, startDistance: i.ride.startDistance, movingTime: i.ride.movingTime, climbed: i.ride.climbed, work: i.ride.work, proM: i.ride.proM, planCounted: i.ride.planCounted },
    flags: { usedDemo: i.flags.usedDemo, timeScale: i.flags.timeScale, splitByWorkout: !!i.flags.splitByWorkout },
    span: {
      id: i.span.id, startedAt: i.span.startedAt?.toISOString() ?? null, samples: i.span.samples,
      dist0: i.span.base.dist, climb0: i.span.base.climbed, proM0: i.span.base.proM,
      workout: i.span.workout, workoutCompleted: i.span.completed, distanceM: i.span.distanceM, climbedM: i.span.climbedM,
    },
  };
}

/** The ride fields a resumed ride is given (the caller then sets `lastElev` from the road at that distance). */
export function resumedRide(s: RideSnapshot): Omit<RideState, 'lastElev'> {
  return {
    distance: s.ride.distance, startDistance: s.ride.startDistance, speed: 0, movingTime: s.ride.movingTime,
    climbed: s.ride.climbed, work: s.ride.work, proM: s.ride.proM, planCounted: s.ride.planCounted,
    finished: false, finishTime: 0, racePlace: 0, raceSize: 0,
  };
}

/** The flags a resumed ride starts with. */
export function resumedFlags(s: RideSnapshot): { usedDemo: boolean; splitByWorkout: boolean } {
  return {
    usedDemo: s.flags.usedDemo || s.flags.timeScale !== 1, // a sped-up clock is not a ride for the leaderboards
    splitByWorkout: s.flags.splitByWorkout || s.span.workout !== null,
  };
}

/**
 * The activity's span as it was: the recorder with the same id, its baselines, and statistics rebuilt by replaying the samples
 * (good enough, see `replayStats`). A workout that was under way is not resumed as one: it carries on as a ride, same id and title.
 */
export function restoreSpan(s: RideSnapshot, zones: () => { ftp: number; maxHr: number }): Span {
  return {
    rec: RideRecorder.restore(s.span.id, s.span.startedAt, s.span.samples),
    st: replayStats(s.span.samples, new RideStats(zones)),
    base: { dist: s.span.dist0, climbed: s.span.climb0, proM: s.span.proM0 },
    saved: 0, workout: s.span.workout, completed: s.span.workoutCompleted,
  };
}

/** The row to save for an interrupted ride, as it was (not finished, no race), the same as any other ride. */
export function interruptedActivity(s: RideSnapshot, zones: () => { ftp: number; maxHr: number }): Activity {
  const flags: RideFlags = { usedDemo: s.flags.usedDemo, timeScale: s.flags.timeScale, splitByWorkout: s.flags.splitByWorkout };
  const z = zones();
  return buildActivityRow({
    id: s.span.id, startedAt: s.span.startedAt ? new Date(s.span.startedAt) : null, samples: s.span.samples, stats: replayStats(s.span.samples, new RideStats(zones)),
    stage: { id: s.stageId, name: s.stageName }, workout: s.span.workout, workoutCompleted: s.span.workoutCompleted,
    finished: false, distanceM: s.span.distanceM, climbedM: s.span.climbedM, finishS: null, demo: isDemoRide(flags),
    racePlace: null, raceSize: null, proM: Math.max(0, s.ride.proM - s.span.proM0), ftp: z.ftp, maxHr: z.maxHr,
  });
}

/** The storage the copy is kept in (a `Storage`, or a stand-in). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** What the rider answers when offered a leftover copy. */
export type ResumeChoice = 'resume' | 'save' | 'discard';

/** Everything the keeper reads or calls. Each is a read of another subsystem or a side effect on one. */
export interface SnapshotKeeperDeps {
  /** The storage, asked for on each use (reaching `localStorage` can throw when site data is blocked). */
  storage(): StorageLike;
  /** Date.now(). */
  now(): number;
  /** The signed-in account's id, if any. */
  accountId(): string | undefined;
  /** The hub is open or the rider is at home: not riding, so no copy is written. */
  idle(): boolean;
  /** A race or scheduled event is on, or the ride is finished: not resumable (a finished ride is already saved). */
  notResumable(): boolean;
  /** Seconds recorded in the activity being recorded. */
  seconds(): number;
  /** The inputs for a copy of the activity being recorded (asked for only when one is to be written). */
  input(me: string): SnapshotInput;
  /** Does this stage still exist? */
  stageExists(id: string): boolean;
  /** A ride has been started this visit (so a leftover copy is saved rather than offered). */
  rideStarted(): boolean;
  /** Metric or imperial, for the offer's summary. */
  imperial(): boolean;
  /** Asks the rider (the resume dialog). */
  ask(info: { stageName: string; summary: string }): Promise<ResumeChoice>;
  /** Puts the ride back (the world, the stage, the toast). The keeper has already removed the stored copy. */
  resume(s: RideSnapshot): void;
  /** Saves the interrupted ride as it was (the cloud, or the offline queue, and the toasts). */
  saveInterrupted(s: RideSnapshot): Promise<void>;
}

/** The copy's owner: when it is written, cleared, and what is done with one left by an earlier run. */
export interface SnapshotKeeper {
  /** Called every frame and every background tick: writes the copy about every 20 s. */
  tick(now: number): void;
  /** Writes the copy of the activity being recorded now, if a ride is under way (also on hiding or closing the page). */
  write(): void;
  /** Deletes this run's copy: the ride was saved and ended, reset, or is too short. Never touches one left by an earlier run. */
  clear(): void;
  /** This run now writes the copy (after a resume), so it may delete it. */
  adopt(): void;
  /** The account changed: the next account's leftover copy (if any) is dealt with afresh. */
  forgetHandled(): void;
  /** Once the session has settled for an account: offers a leftover copy, saves it quietly, or drops it. */
  offer(): Promise<void>;
}

export function createSnapshotKeeper(deps: SnapshotKeeperDeps): SnapshotKeeper {
  let owned = false; // this run has written the copy: only then may it delete it (an earlier run's copy waits for the rider's answer)
  let handledFor: string | null = null; // the account whose leftover copy has been dealt with: writing starts after that, so it can't overwrite one
  let lastAt = 0;
  let offering = false;

  const read = () => { try { return deps.storage().getItem(SNAPSHOT_KEY); } catch { return null; } };
  const remove = () => { try { deps.storage().removeItem(SNAPSHOT_KEY); } catch { /* storage blocked */ } };

  const clear = () => {
    if (!owned) return;
    owned = false;
    remove();
  };

  const write = () => {
    const me = deps.accountId();
    if (!me || handledFor !== me || deps.idle()) return;
    if (deps.notResumable()) return;
    if (deps.seconds() < SNAPSHOT_MIN_S) { clear(); return; }
    const snap = buildSnapshot(deps.input(me));
    try {
      deps.storage().setItem(SNAPSHOT_KEY, serialiseSnapshot(snap));
      owned = true;
    } catch {
      remove(); // it didn't fit (or storage is blocked): drop it silently rather than leave an old one that looks current
      owned = false;
    }
  };

  const offer = async () => {
    const me = deps.accountId();
    if (!me || offering || handledFor === me) return;
    offering = true;
    try {
      const raw = read();
      if (!raw) return;
      const snap = parseSnapshot(raw);
      if (!snap) { remove(); return; } // not ours to read (another version, damaged)
      if (snap.accountId !== me) return; // another rider's: leave it for them
      const verdict = judgeSnapshot(snap, deps.now(), me, deps.stageExists);
      if (verdict === 'drop') { remove(); return; }
      // Too old, its stage gone, or a ride already started this visit: keep it rather than ask. It is saved as it was.
      if (verdict === 'save' || deps.rideStarted()) {
        await deps.saveInterrupted(snap);
        remove();
        return;
      }
      const choice = await deps.ask({ stageName: snap.stageName, summary: snapshotSummary(snap, deps.now(), deps.imperial()) });
      if (deps.accountId() !== me) return; // signed out while the question was open
      if (choice === 'resume') { remove(); deps.resume(snap); }
      else if (choice === 'save') { remove(); await deps.saveInterrupted(snap); }
      else remove();
    } finally {
      offering = false;
      if (deps.accountId() === me) handledFor = me;
    }
  };

  return {
    tick(now) {
      if (now - lastAt < SNAPSHOT_EVERY_MS) return;
      lastAt = now;
      write();
    },
    write,
    clear,
    adopt() { owned = true; },
    forgetHandled() { handledFor = null; },
    offer,
  };
}
