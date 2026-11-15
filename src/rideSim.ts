// The ride simulation: the state of the ride (position, speed, time, work, climbing, finish) and the one step that advances it.
// No DOM, no three.js and no module-level state: main.ts owns the instances and hands the step its collaborators, so it can be
// driven directly in a unit test (tests/unit/rideSim.test.ts). The step runs once per simulation substep (src/rideClock.ts),
// and the ORDER of what it does matters: the KOM tracker watches the distance before the finish check, the finish check runs
// before the climbing is totalled, and the recorder (in main.ts) reads the numbers this leaves behind.
import { DEFAULT_PARAMS, stepSpeed } from './physics';
import { limitCornerSpeed } from './cornering';

/** Treat the trainer as idle (power and cadence zero) if no reading has arrived for this long, in ms. */
export const STALE_MS = 3000;
/** Under this speed (m/s) the rider is not moving: no moving time, work or KOM progress. */
export const MOVING_MS = 0.3;
/** How many 3-second-average power samples the ring holds (one per simulation step). */
export const POWER_SAMPLES = 3000;
/** The window of the power average, in ms. */
export const POWER_WINDOW_MS = 3000;

/** What the trainer, power meter and heart-rate strap last told us (written by the device callbacks, read by the step). */
export interface LiveInput {
  power: number;
  cadence: number;
  heartRate: number;
  trainerHr: number;
  lastReadingAt: number;
  lastHrAt: number;
}

/** The ride so far. Fields are used all over main.ts and the saved-ride code: do not rename them. */
export interface RideState {
  distance: number;
  startDistance: number;
  speed: number;
  movingTime: number;
  climbed: number;
  lastElev: number;
  work: number;
  finished: boolean;
  finishTime: number;
  planCounted: boolean;
  proM: number;
  racePlace: number;
  raceSize: number;
}

export const freshRide = (): RideState => ({
  distance: 0, startDistance: 0, speed: 0, movingTime: 0, climbed: 0, lastElev: 0, work: 0,
  finished: false, finishTime: 0, planCounted: false, proM: 0, racePlace: 0, raceSize: 0,
});

export const freshLive = (): LiveInput => ({ power: 0, cadence: 0, heartRate: 0, trainerHr: 0, lastReadingAt: 0, lastHrAt: 0 });

/** The last few seconds of power for the 3 s average: a fixed-size ring, oldest first (no shift() per step). */
export class PowerRing {
  private readonly ring: { t: number; p: number }[] = Array.from({ length: POWER_SAMPLES }, () => ({ t: -Infinity, p: 0 }));
  private head = 0; // where the next sample goes
  private n = 0; // how many of the ring's slots hold a sample

  /** How many samples are held. */
  get count() { return this.n; }

  /** Adds a sample at `now` (ms) and drops those older than the window. */
  push(now: number, power: number) {
    const s = this.ring[this.head];
    s.t = now;
    s.p = power;
    this.head = (this.head + 1) % POWER_SAMPLES;
    if (this.n < POWER_SAMPLES) this.n++;
    let oldest = (this.head - this.n + POWER_SAMPLES) % POWER_SAMPLES;
    while (this.n && now - this.ring[oldest].t > POWER_WINDOW_MS) {
      this.n--;
      oldest = (oldest + 1) % POWER_SAMPLES;
    }
  }

  /** Callbacks over the live samples, oldest first. */
  each(fn: (s: { t: number; p: number }) => void) {
    const start = (this.head - this.n + POWER_SAMPLES) % POWER_SAMPLES;
    for (let i = 0; i < this.n; i++) fn(this.ring[(start + i) % POWER_SAMPLES]);
  }

  /** The average power over the window (0 when empty). */
  mean() {
    let sum = 0;
    this.each((s) => { sum += s.p; });
    return sum / Math.max(1, this.n);
  }

  reset() {
    this.head = 0;
    this.n = 0;
  }
}

/** Everything the step reads and writes: main.ts keeps these object identities for the life of the page. */
export interface RideSim {
  ride: RideState;
  live: LiveInput;
  power: PowerRing;
}

export const createRideSim = (): RideSim => ({ ride: freshRide(), live: freshLive(), power: new PowerRing() });

/** Starts the ride over: zero position, time and counters, and an empty power average. `live` (the devices) is left alone. */
export function resetRideState(sim: RideSim) {
  Object.assign(sim.ride, freshRide());
  sim.power.reset();
}

/** The road under the rider, as the step needs it (main.ts binds these to the current stage and the wind). */
export interface RideCourse {
  /** Metres to the finish line, or null on an endless stage. Read each step (the stage can change). */
  finish(): number | null;
  /** Road grade as a fraction at a distance. */
  gradeAt(d: number): number;
  /** Elevation above the start, metres. */
  elevationAt(d: number): number;
  /** Air density (kg/m³) at a distance (thinner up high). */
  airDensityAt(d: number): number;
  /** Wind into the rider's face at a distance, m/s (negative: a tail wind). */
  headwindAt(d: number): number;
  /** The current stage's own heading function (corner braking caches by its identity). */
  headingAt(): (d: number) => number;
}

/** What the rider and the garage add up to. */
export interface RiderSetup {
  /** Rider + bike + equipment, kg. */
  massKg: number;
  /** Multiplier on the drag area from the equipment (1 = none). */
  cdaFactor: number;
  /** Added to the rolling resistance coefficient. */
  crrDelta: number;
}

/** The hooks the step calls. Each is a side effect on another subsystem (or a read of a setting), so the step itself stays free of them. */
export interface RideDeps {
  course: RideCourse;
  /**
   * Demo ride: when on, sets `live` from the demo slider and returns true (the step then skips the stale check). Off: returns false.
   */
  demoInput(now: number): boolean;
  /**
   * Everything around the rider that moves with the clock: the wind, the other riders, the race, the AI rival, steering, the draft.
   * Runs after the live input is settled and before the rider's own motion, so it sees the position the step is about to advance from.
   */
  surroundings(dt: number): void;
  /** The fraction of air drag the draft saves right now (eased by `surroundings`). */
  draftSaving(): number;
  /** Mass, drag and rolling resistance of the rider and their kit. */
  rider(): RiderSetup;
  /** Whether a pro team is within reach (called only for a moving, unfinished rider, after the speed is known). */
  proNearby(): boolean;
  /** Waiting on the line for a race or group ride to start: speed is held at zero. Asked twice a step, as the old code did. */
  holding(): boolean;
  /** Called with the new position, moving time and work, before the finish check, so a climb that tops out at the line still counts. */
  segmentFrame(distance: number, movingTime: number, work: number, riding: boolean): void;
  /** The rider crossed the finish line (once: `ride.finished` is already true). */
  onFinish(): void;
  /** Keeps the legs in step with the wheels. */
  drivetrain: { update(dt: number, speedMs: number, cadence: number, power: number): void };
}

/**
 * One simulation step: `dt` simulated seconds, ending at `now` (a performance.now() reading). Does, in order:
 * power and cadence (demo, or zeroed once the trainer has been silent for STALE_MS); the surroundings; speed from physics and corner
 * braking; distance ridden near a pro team; the start-line hold; distance, moving time and work; the KOM hook; the finish check;
 * climbing; the drivetrain; the power average. The recorder and the workout player follow in main.ts, reading what this leaves.
 */
export function stepRide(sim: RideSim, deps: RideDeps, dt: number, now: number) {
  const { ride, live } = sim;
  const { course } = deps;

  if (!deps.demoInput(now) && now - live.lastReadingAt > STALE_MS) {
    live.power = 0;
    live.cadence = 0;
  }

  deps.surroundings(dt);

  const grade = course.gradeAt(ride.distance);
  const equipment = deps.rider();
  ride.speed = stepSpeed(ride.speed, live.power, grade, dt, {
    ...DEFAULT_PARAMS,
    massKg: equipment.massKg,
    cda: DEFAULT_PARAMS.cda * equipment.cdaFactor * (1 - deps.draftSaving()),
    crr: DEFAULT_PARAMS.crr + equipment.crrDelta,
    airDensity: course.airDensityAt(ride.distance), // thinner air up high
  }, course.headwindAt(ride.distance)); // air speed = road speed + headwind
  ride.speed = limitCornerSpeed(ride.speed, ride.distance, dt, { headingAt: course.headingAt() }); // brake into bends
  // Distance ridden within 30 m of a pro team (a weekly challenge).
  if (!ride.finished && ride.speed > MOVING_MS && deps.proNearby()) ride.proM += ride.speed * dt;
  if (deps.holding()) ride.speed = 0; // waiting on the line for the start
  ride.distance += ride.speed * dt;
  if (ride.speed > MOVING_MS && !ride.finished) {
    ride.movingTime += dt;
    ride.work += live.power * dt;
  }
  deps.segmentFrame(ride.distance, ride.movingTime, ride.work, ride.speed > MOVING_MS && !ride.finished && !deps.holding());
  const finish = course.finish();
  if (finish !== null && !ride.finished && ride.distance >= finish) {
    ride.finished = true;
    deps.onFinish();
  }
  const elev = course.elevationAt(ride.distance);
  if (elev > ride.lastElev && !ride.finished) ride.climbed += elev - ride.lastElev;
  ride.lastElev = elev;
  deps.drivetrain.update(dt, ride.speed, live.cadence, live.power);
  sim.power.push(now, live.power);
}
