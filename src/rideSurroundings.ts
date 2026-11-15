// What moves around the rider with the clock: the wind, the other riders (live riders, the pro teams, the AI rival), the race, steering
// and the draft. It is the "surroundings" hook of the simulation step (src/rideSim.ts). No DOM, no three.js, and no module state:
// `createRideSurroundings()` makes one object that owns the state (the road's riders, the draft, the eased draft saving, the
// cross-wind shift, the stage the wind was last set for) and main.ts reads it from there. Everything else (settings, presence, the
// race, the peloton, the AI, steering, the world's lane and weather, the course) arrives through `SurroundingsDeps`, so it can be
// driven directly in a unit test (tests/unit/rideSurroundings.test.ts).
// The ORDER inside `step()` matters: the wind is settled first (the cross-wind shift needs it), then the race and the peloton move,
// the AI sees the riders gathered so far (and last step's draft), and steering and the draft use the full list.
import { draftFrom, type Draft } from './draft';
import { draftShift, type Climate, type StageWind } from './world/wind';
import type { RideState, LiveInput } from './rideSim';
import type { Stage } from './stages';
import type { OtherRider } from './world/others';
import type { AiFrame } from './ai/aiRide';
import type { Steering } from './steering';

/** The draft looks this far ahead of the rider, in metres. */
export const DRAFT_LOOK_AHEAD = 60;
/** The draft saving eases towards its target with this time constant, in seconds. */
export const DRAFT_EASE_S = 0.6;

/** The settings the step reads. main.ts passes a function, because it replaces its settings object when they change. */
export interface SurroundingsSettings {
  wind: boolean;
  rideTogether: boolean;
  proTeams: boolean;
  autoSteer: boolean;
}

/** The wind, as the step drives it (src/world/wind.ts's `WindState`). */
export interface WindLike {
  enabled: boolean;
  setStage(stage: Pick<Stage, 'id'> & { wind?: StageWind }, startHeading: number): void;
  setWeather(w: Climate): void;
  update(dt: number): void;
}

/** The race being ridden, as the step needs it. */
export interface RaceLike {
  holding: boolean;
  update(dt: number, distance: number, speed: number): void;
}

/** What steering needs from the step (src/steering.ts's `Steering`). */
export type SteeringLike = Pick<Steering, 'update' | 'target'>;

/** The AI coach and rival (src/ai/aiRide.ts): given the frame it may hand back a rider to put on the road. */
export interface AiLike {
  frame(f: AiFrame): OtherRider | null;
}

/** Everything the step reads or calls. Each is a read of another subsystem or a side effect on one. */
export interface SurroundingsDeps {
  /** The ride and the live input (main.ts keeps these object identities for the life of the page). */
  ride: RideState;
  live: LiveInput;
  settings(): SurroundingsSettings;
  /** The wind forced by `?wind=` (see `parseUrlWind`), if any. */
  urlWind: StageWind | undefined;
  wind: WindLike;
  /** Wet bends are slower: tells the cornering code. */
  setRoadWet(wet: boolean): void;
  /** The weather being shown. */
  weather(): Climate;
  /** The current stage. */
  stage(): Stage;
  /** The current stage's heading at a distance (course.ts's `headingAt`). */
  headingAt(d: number): number;
  gradeAt(d: number): number;
  /** Head and cross wind at a distance on the current stage. */
  roadWind(d: number): { head: number; cross: number };
  /** Other riders on the road with you (Ride together). Its array is reused, so the step copies it. */
  presence: { riders(): OtherRider[] };
  /** The pro teams. */
  peloton: { update(dt: number): void; riders(): OtherRider[] };
  /** The race being ridden, or null. */
  race(): RaceLike | null;
  /** The scheduled event joined, or null: the step marks it when a demo ride is used. */
  eventState(): { demoUsed: boolean } | null;
  /** A group ride that has not started yet (the rider waits on the line). */
  eventHolding(): boolean;
  /** Whether the demo slider is on. */
  demo(): boolean;
  /** The AI controller, or null until it has loaded. */
  ai(): AiLike | null;
  /** The workout's target watts, or null when no workout is running (not done, not paused). */
  workoutTarget(): number | null;
  /** Seconds into the workout, or null when there is none. */
  workoutElapsed(): number | null;
  /** Heart rate now (0 when the strap has gone quiet). */
  heartRate(): number;
  steering: SteeringLike;
  /** The world's lane: where the rider is drawn across the road, and where steering wants it. */
  lane: { current(): number; set(target: number): void };
  /** A rider's drawn lane, if known. */
  lateralOf(id: string): number | undefined;
}

/** The state the step owns, and what the rest of main.ts reads. */
export interface RideSurroundings {
  /** The rider just ahead, if any (as of the last step). */
  draft: Draft | null;
  /** Fraction of air drag saved by the draft, eased. */
  draftSaving: number;
  /** Crosswind echelon: metres right of a rider's line the shelter sat, last step. */
  lastCrossShift: number;
  /** Live riders, the pro teams and the AI rival on the road as of the last step (not the ghost). */
  roadRiders: OtherRider[];
  /** The stage the wind was last set for. */
  windStage: Stage | null;
  /** Advances the surroundings by `dt` simulated seconds. */
  step(dt: number): void;
}

/** Reads `?wind=8,90`: speed in m/s, then the degrees it blows towards (default 90). `search` is `location.search`. */
export function parseUrlWind(search: string): StageWind | undefined {
  const raw = new URLSearchParams(search).get('wind');
  if (!raw) return undefined;
  const [ms, angle] = raw.split(',').map(Number);
  return Number.isFinite(ms) ? { ms, angle: Number.isFinite(angle) ? angle : 90 } : undefined;
}

export function createRideSurroundings(deps: SurroundingsDeps): RideSurroundings {
  const { ride, live } = deps;
  const s: RideSurroundings = {
    draft: null,
    draftSaving: 0,
    lastCrossShift: 0,
    roadRiders: [],
    windStage: null,
    step(dt: number) {
      // The wind: follows the stage and the weather being shown.
      if (s.windStage !== deps.stage()) {
        s.windStage = deps.stage();
        deps.wind.setStage(deps.urlWind ? { id: s.windStage.id, wind: deps.urlWind } : s.windStage, deps.headingAt(0));
      }
      deps.wind.enabled = deps.settings().wind;
      deps.wind.setWeather(deps.weather());
      deps.setRoadWet(deps.weather() === 'rain' && !deps.race() && !deps.eventState()); // wet bends are slower; races and events share one field, so they stay on dry rules
      deps.wind.update(dt);
      const crossShift = draftShift(deps.roadWind(ride.distance).cross); // the sheltered spot sits this far to the right of a rider's line
      s.lastCrossShift = crossShift;

      // Other riders on the road, and the draft from the one just ahead.
      // A copy: presence.riders() returns its own reused array, and the pro teams and the AI rival are added to this one.
      const liveRiders: OtherRider[] = deps.settings().rideTogether ? deps.presence.riders().slice() : [];
      const race = deps.race();
      if (race) race.update(dt, ride.distance, ride.speed); // the field races with you
      if (deps.settings().proTeams || deps.race() || deps.eventState()) {
        deps.peloton.update(dt);
        liveRiders.push(...deps.peloton.riders());
      }
      // The AI coach and rival: tips as you ride, and a rival on the road.
      const ai = deps.ai();
      if (ai) {
        const ahead = liveRiders.reduce((m, r) => (r.distance > ride.distance && r.distance - ride.distance < m ? r.distance - ride.distance : m), Infinity);
        const target = deps.workoutTarget();
        const rival = ai.frame({
          dt, movingTime: ride.movingTime, distance: ride.distance, watts: live.power, cadence: live.cadence, hr: deps.heartRate(),
          gradePct: deps.gradeAt(ride.distance) * 100, finish: deps.stage().finish, finishS: ride.finishTime, finished: ride.finished,
          targetW: target, workoutS: deps.workoutElapsed(), gapAheadM: Number.isFinite(ahead) ? ahead : null,
          drafting: !!s.draft && s.draft.saving > 0.01, riding: !ride.finished && !deps.race()?.holding && !deps.eventHolding(),
        });
        if (rival) liveRiders.push(rival);
      }
      s.roadRiders = liveRiders;
      deps.steering.update(dt, {
        autoSteer: deps.settings().autoSteer, distance: ride.distance, riders: liveRiders, lateralOf: deps.lateralOf, shift: crossShift, headingAt: deps.headingAt,
      });
      deps.lane.set(deps.steering.target);
      s.draft = draftFrom(ride.distance, liveRiders, DRAFT_LOOK_AHEAD, { lane: deps.lane.current(), lateralOf: deps.lateralOf, shift: crossShift });
      s.draftSaving += ((s.draft?.saving ?? 0) - s.draftSaving) * (1 - Math.exp(-dt / DRAFT_EASE_S));
      if (deps.eventState() && deps.demo()) deps.eventState()!.demoUsed = true; // demo riding keeps you off the event results
    },
  };
  return s;
}
