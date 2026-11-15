// The activities being recorded ("spans") and the second half of the simulation step. A span is a window of the trip with its own
// recorder (second-by-second samples, its own id), its own statistics and "since this started" baselines (src/rideActivity.ts).
// A workout is a clean boundary, so saved activities never overlap in time: while one is on, `workout` records and the ride's span
// waits; before it, the ride so far is saved; afterwards a fresh ride span starts. The trip itself (`ride`: position, time, KOM
// timing, finish line) never breaks. No DOM, no three.js and no module state: `createRideSpans()` makes one object that owns the
// two spans, and main.ts reads and replaces them there. The cloud calls, toasts and summary cards of saving stay in main.ts; what
// is pure (which span is current, which are worth saving, what a span covers, the row to save) is here, so it can be driven directly
// in a unit test (tests/unit/rideSpans.test.ts).
// The ORDER inside `record()` matters: it follows `stepRide()` (src/rideSim.ts) and reads `ride.lastElev` after the step has set it;
// the ride's statistics are added before the recorder ticks, and the workout player is ticked last.
import { RideRecorder } from './cloud/recorder';
import type { Activity } from './cloud/sync';
import { RideStats } from './stats';
import { baselineAt, buildActivityRow, climbedSince, distanceSince, proSince, worthSaving, type Baseline } from './rideActivity';
import { isDemoRide, leaderboardEligible, type RideFlags } from './rideIntegrity';
import type { RideState, LiveInput } from './rideSim';

/** Shorter activities aren't saved, in seconds. */
export const MIN_RIDE_S = 60;
/** Under this speed (m/s) with no power the rider is not moving, so the recorder skips the step. */
export const RECORD_MOVING_MS = 0.3;

/** One activity being recorded: the ride's, or a workout's while one is on. */
export interface Span {
  rec: RideRecorder;
  st: RideStats;
  base: Baseline;
  /** Where the trip was when this window ended (set once it has: a workout's start closes the ride's, its end closes its own). */
  end?: Baseline;
  /** Seconds already saved for this activity (autosave and the like skip it until it has grown). */
  saved: number;
  /** The workout this activity is, by name, if it is a workout's. */
  workout: string | null;
  /** Set when the workout ran to its end (achievements count these). */
  completed: string | null;
}

/** The workout player, as the step needs it (src/workouts/player.ts's `WorkoutPlayer`). */
export interface PlayerLike {
  done: boolean;
  paused: boolean;
  tick(dt: number, pedalling: boolean, power: number): void;
}

/** Everything the spans read or call. Each is a read of another subsystem or a side effect on one. */
export interface RideSpansDeps {
  /** The trip and the live input (main.ts keeps these object identities for the life of the page). */
  ride: RideState;
  live: LiveInput;
  /** The rider's FTP and max heart rate, read when the statistics need them (main.ts replaces its settings object, so a function). */
  zones: () => { ftp: number; maxHr: number };
  /** Heart rate now (0 when the strap has gone quiet). Asked for each use, as the old code did. */
  heartRate(): number;
  /** The current stage, for the row saved and the base altitude of the sample. */
  stage(): { id: string; name: string; baseAltitude?: number };
  /** The workout player, or null when no workout is on. */
  player(): PlayerLike | null;
  /** The workout reached its end (or was skipped past the last step). */
  finishWorkout(): void;
  /** The beeps at the end of an interval (called while a workout runs and is not paused). */
  intervalBeeps(): void;
  /** What makes a ride count for leaderboards, and what the saved row says about demo riding. */
  flags: RideFlags;
  /** The rider's FTP and max heart rate as they are now, for the saved row. */
  settings(): { ftp: number; maxHr: number };
}

/** The spans and what the step and the save paths do with them. */
export interface RideSpans {
  /** The ride's activity (replaced by main.ts when a ride starts over or is resumed). */
  ride: Span;
  /** The workout's activity while one is on, else null. */
  workout: Span | null;
  /** A new span: a fresh recorder and statistics, baselines from the trip so far. */
  create(workout?: string | null): Span;
  /** The activity being recorded now: the workout's while one is on, else the ride's. */
  current(): Span;
  /** Freezes where the trip was when a window ended, so its distance and climbing stay its own however long it waits to be saved. */
  end(sp: Span): Span;
  /** Distance, climbing and pro-team distance within one window. */
  totals(sp: Span): { distance: number; climbed: number; proM: number };
  /** Is the window long enough and not already saved up to now? */
  worthSaving(sp: Span): boolean;
  /** The windows worth saving now: the workout's, then the ride's. */
  unsaved(): Span[];
  /** The row to save for a window: its own id, samples, statistics, distance and climbing (never the whole trip's). */
  activity(sp: Span): Activity;
  /** The recording half of a simulation step: call it right after `stepRide()`. */
  record(dt: number): void;
}

export function createRideSpans(deps: RideSpansDeps): RideSpans {
  const { ride, live } = deps;
  const s: RideSpans = {
    ride: undefined as unknown as Span, // set just below
    workout: null,
    create(workout: string | null = null) {
      return { rec: new RideRecorder(), st: new RideStats(deps.zones), base: baselineAt(ride), saved: 0, workout, completed: null };
    },
    current: () => s.workout ?? s.ride,
    end(sp) {
      sp.end ??= baselineAt(ride);
      return sp;
    },
    totals(sp) {
      if (sp.end) return { distance: Math.max(0, sp.end.dist - sp.base.dist), climbed: Math.max(0, sp.end.climbed - sp.base.climbed), proM: Math.max(0, sp.end.proM - sp.base.proM) };
      return { distance: distanceSince(ride, sp.base), climbed: climbedSince(ride, sp.base), proM: proSince(ride, sp.base) };
    },
    worthSaving: (sp) => worthSaving(sp.st.seconds, sp.saved, MIN_RIDE_S),
    unsaved: () => [s.workout, s.ride].flatMap((sp) => (sp && s.worthSaving(sp) ? [sp] : [])),
    activity(sp) {
      const isWorkout = sp.workout !== null;
      const t = s.totals(sp);
      return buildActivityRow({
        id: sp.rec.id,
        startedAt: sp.rec.startedAt,
        // A copy: the recorder keeps appending while a save is in flight, and the row must hold the window as it was.
        samples: {
          power: [...sp.rec.samples.power], cadence: [...sp.rec.samples.cadence], hr: [...sp.rec.samples.hr],
          speed: [...sp.rec.samples.speed], distance: [...sp.rec.samples.distance], elevation: [...sp.rec.samples.elevation],
        },
        stats: sp.st,
        stage: deps.stage(),
        workout: sp.workout,
        workoutCompleted: sp.completed,
        finished: !isWorkout && ride.finished,
        distanceM: t.distance,
        climbedM: t.climbed,
        // Only a ride whose samples run from the start line gets a whole-stage time (not after a workout split the trip).
        finishS: !isWorkout && ride.finished && ride.finishTime > 0 && leaderboardEligible(deps.flags) ? ride.finishTime : null,
        demo: isDemoRide(deps.flags), // the database also ignores these rides for leaderboards
        racePlace: isWorkout ? null : ride.racePlace, // weekly challenges: race wins and podiums
        raceSize: isWorkout ? null : ride.raceSize,
        proM: t.proM, // metres ridden with a pro team
        ftp: deps.settings().ftp,
        maxHr: deps.settings().maxHr,
      });
    },
    record(dt) {
      const moving = ride.speed > RECORD_MOVING_MS || live.power > 0;
      // The activity being recorded (the ride's, or the workout's while one is on): its statistics and samples, with the
      // distance counted from where that activity began.
      const sp = s.current();
      const sample = {
        power: live.power, cadence: live.cadence, hr: deps.heartRate(), speedMs: ride.speed,
        distance: ride.distance - ride.startDistance - sp.base.dist,
        elevation: (deps.stage().baseAltitude ?? 0) + ride.lastElev, // (the step has just set lastElev to the elevation here)
      };
      if (!s.workout) s.ride.st.add(dt, live.power, live.cadence, deps.heartRate(), moving);
      sp.rec.tick(dt, moving, sample);
      const player = deps.player();
      if (player) {
        const pedalling = live.power > 0 || live.cadence > 0;
        if (!player.done) {
          player.tick(dt, pedalling, live.power);
          if (pedalling && !player.paused) s.workout?.st.add(dt, live.power, live.cadence, deps.heartRate(), true);
        }
        if (player.done) deps.finishWorkout(); // reached the end, or skipped past the last step
        else if (!player.paused) deps.intervalBeeps();
      }
    },
  };
  s.ride = s.create();
  return s;
}
