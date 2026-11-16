// What the app asks of the smart trainer each control tick, and the virtual gears that feed into it. In a workout the trainer is
// held at the target watts (ERG). Otherwise it is sent the road's grade (scaled by the Trainer difficulty setting, plus the
// virtual gear's push), a drag factor (draft, garage aero kit, thinner air) and the headwind. Nothing is sent unless it changed
// enough since the last send. No DOM, no three.js: the decision (`decideTrainerCommand`) is a pure function of its inputs and the
// "last sent" memory, and `createTrainerControl()` keeps that memory, the virtual gear and the clock, and calls the trainer through
// the small `TrainerLike` interface, so both can be driven in a unit test (tests/unit/trainerControl.test.ts). The panel and the
// keys that change gear stay in main.ts.
// The ORDER inside `tick()` matters: the ERG target is read first and corrected for a power meter before it is compared; in
// simulation mode the power-match correction is reset before the road is read.
import type { Trainer } from './ble/trainer';
import type { PowerMatch } from './ble/powerMatch';
import type { LiveInput } from './rideSim';
import { VIRTUAL_GEARS, VIRTUAL_REF, gearGradeOffset } from './drivetrain';

/** A grade within this many percent of the last one sent is not sent again. */
export const GRADE_RESEND_STEP = 0.1;
/** ERG watts within this of the last target sent are not sent again. */
export const WATTS_RESEND_STEP = 1;
/** The steepest descent and climb the trainer is sent, in percent. */
export const MIN_SENT_GRADE = -10;
export const MAX_SENT_GRADE = 20;

/** What was last sent to the trainer. NaN means "send it again at the next tick". */
export interface LastSent {
  /** The grade, in percent. */
  grade: number;
  /** The ERG target, in watts. */
  watts: number;
  /** The drag factor. */
  wind: number;
  /** The headwind, in m/s. */
  headwind: number;
}

/** The memory of a trainer that has not been sent anything yet (the drag factor and headwind start at "no effect"). */
export const freshLastSent = (): LastSent => ({ grade: NaN, watts: NaN, wind: 1, headwind: 0 });

/** What a tick works out when no workout is holding the trainer: raw values, rounded and combined by `decideTrainerCommand`. */
export interface SimInput {
  mode: 'sim';
  /** The road's grade at the rider's distance, as a fraction (0.05 is 5 %). */
  roadGrade: number;
  /** The Trainer difficulty setting, 0 to 100 (%). */
  difficulty: number;
  /** Whether virtual shifting is on, and the gear (an index into `VIRTUAL_GEARS`). */
  virtualShifting: boolean;
  gear: number;
  /** The share of wind resistance the draft takes away (0 to 1). */
  draftSaving: number;
  /** The garage's aero kit factor (1 is none). */
  cdaFactor: number;
  /** Air density now divided by sea-level air density. */
  airDensityRatio: number;
  /** Wind into the rider's face in m/s (negative is a tail wind), unrounded. */
  headwind: number;
}

/** A workout is on: hold these watts (already corrected for a power meter, if one is used). */
export interface ErgInput {
  mode: 'erg';
  watts: number;
}

/** One command for the trainer. */
export type TrainerCommand =
  | { kind: 'power'; watts: number }
  | { kind: 'grade'; grade: number; dragFactor: number; headwind: number };

/** The grade sent, in percent: the road's, scaled by the difficulty, plus the gear's push, kept within limits and rounded to 0.1. */
export function gradeToSend(roadGrade: number, difficulty: number, virtualShifting: boolean, gear: number): number {
  const road = roadGrade * 100 * (difficulty / 100);
  const push = virtualShifting ? gearGradeOffset(gear) : 0;
  return Math.round(Math.max(MIN_SENT_GRADE, Math.min(MAX_SENT_GRADE, road + push)) * 10) / 10;
}

/** The drag factor sent: draft, aero kit and air density together, rounded to 0.02. */
export function dragFactorToSend(draftSaving: number, cdaFactor: number, airDensityRatio: number): number {
  return Math.round((1 - draftSaving) * cdaFactor * airDensityRatio * 50) / 50;
}

/** The headwind sent, in half-metre-per-second steps. */
export function headwindToSend(headwind: number): number {
  return Math.round(headwind * 2) / 2;
}

/**
 * What to send now, if anything, and what to remember afterwards. In ERG the watts go when they differ from the last by a watt or
 * more, and the grade is forgotten so it is sent again when ERG ends. In simulation the grade, drag factor and headwind go when
 * the grade moved by 0.1 % or more or either of the other two changed, and the ERG target is forgotten so a new workout sends its
 * first target. The result is a new memory; the one passed in is not changed.
 */
export function decideTrainerCommand(input: ErgInput | SimInput, last: LastSent): { command: TrainerCommand | null; last: LastSent } {
  if (input.mode === 'erg') {
    const { watts } = input;
    if (Math.abs(watts - last.watts) < WATTS_RESEND_STEP) return { command: null, last };
    return { command: { kind: 'power', watts }, last: { ...last, watts, grade: NaN } };
  }
  const grade = gradeToSend(input.roadGrade, input.difficulty, input.virtualShifting, input.gear);
  const dragFactor = dragFactorToSend(input.draftSaving, input.cdaFactor, input.airDensityRatio);
  const headwind = headwindToSend(input.headwind);
  // Compared in tenths: both grades are rounded to 0.1, but 5.1 - 5.0 is 0.0999… in floating point and would slip under a step of 0.1. (NaN, nothing sent yet, is never under.)
  if (Math.round(Math.abs(grade - last.grade) / GRADE_RESEND_STEP) < 1 && dragFactor === last.wind && headwind === last.headwind) return { command: null, last };
  return { command: { kind: 'grade', grade, dragFactor, headwind }, last: { grade, watts: NaN, wind: dragFactor, headwind } };
}

/** The lowest and highest virtual gear (indexes into `VIRTUAL_GEARS`). */
export const MIN_GEAR = 0;
export const MAX_GEAR = VIRTUAL_GEARS.length - 1;

/** The gear after shifting by `by` (positive is harder), stopping at the ends. */
export function shiftGear(gear: number, by: number): number {
  return Math.max(MIN_GEAR, Math.min(MAX_GEAR, gear + by));
}

/** What the gear panel shows for a gear: the number, how far along the range it is (0 to 1) and the ratio. */
export function gearReadout(gear: number): { number: string; fraction: number; ratio: string } {
  return { number: String(gear + 1), fraction: gear / MAX_GEAR, ratio: `${VIRTUAL_GEARS[gear].toFixed(2)} : 1` };
}

/** The trainer, as control needs it (src/ble/trainer.ts's `Trainer`). */
export type TrainerLike = Pick<Trainer, 'canControl' | 'setGrade' | 'setTargetPower'>;

/** The workout player, as control needs it (src/workouts/player.ts's `WorkoutPlayer`). */
export interface ErgPlayerLike {
  done: boolean;
  paused: boolean;
  /** The watts to hold now, or null when this step has no target (the tick then runs the simulation). */
  targetWatts(): number | null;
}

/** The settings a tick reads. main.ts passes a function, because it replaces its settings object when they change. */
export interface TrainerSettings {
  difficulty: number;
  virtualShifting: boolean;
  powerMatch: boolean;
}

/** Everything a tick reads or calls. Each is a read of another subsystem or a side effect on one. */
export interface TrainerControlDeps {
  /** The connected trainer, or null (main.ts replaces it when one connects or goes). */
  trainer(): TrainerLike | null;
  settings(): TrainerSettings;
  /** The clock, in milliseconds (`performance.now`). */
  now(): number;
  /** The power and cadence now (main.ts keeps this object identity for the life of the page). */
  live: Pick<LiveInput, 'power' | 'cadence'>;
  /** The workout player, or null when no workout is on. */
  player(): ErgPlayerLike | null;
  /** Whether a separate power meter, not the trainer, is the source of the rider's watts. */
  powerFromMeter(): boolean;
  /** Corrects the ERG target so a separate power meter sits on it (src/ble/powerMatch.ts); main.ts also resets it when the meter changes. */
  powerMatch: Pick<PowerMatch, 'update' | 'reset'>;
  /** The road's grade at the rider's distance, as a fraction. */
  roadGrade(): number;
  /** The share of wind resistance the draft takes away. */
  draftSaving(): number;
  /** The garage's aero kit factor. */
  cdaFactor(): number;
  /** Air density at the rider's place divided by sea-level air density. */
  airDensityRatio(): number;
  /** Wind into the rider's face at the rider's distance, m/s. */
  headwind(): number;
}

/** The control tick and the virtual gear. */
export interface TrainerControl {
  /** Sends the trainer what it needs now, if it has changed enough. Does nothing unless the trainer can be controlled. */
  tick(): void;
  /** The virtual gear (an index into `VIRTUAL_GEARS`). It is kept whether or not virtual shifting is on. */
  readonly gear: number;
  /** Shifts by `by` (positive is harder). False, and nothing changes, when virtual shifting is off or the gear is at its end. */
  shift(by: number): boolean;
  /** Forgets the grade (and drag factor and headwind stay), so the next simulation tick sends it again. */
  resendGrade(): void;
  /** Forgets the ERG target, so the next ERG tick sends it again. */
  resendWatts(): void;
  /** Forgets both (a trainer was connected or reconnected). */
  resendAll(): void;
}

export function createTrainerControl(deps: TrainerControlDeps): TrainerControl {
  let last = freshLastSent();
  let lastControlAt = 0;
  let gear = VIRTUAL_REF;

  function tick() {
    const trainer = deps.trainer();
    if (!trainer?.canControl) return;
    const settings = deps.settings();
    const now = deps.now();
    const dt = lastControlAt ? Math.min(5, (now - lastControlAt) / 1000) : 0;
    lastControlAt = now;
    const player = deps.player();
    let watts = player && !player.done ? player.targetWatts() : null;
    let decision: ReturnType<typeof decideTrainerCommand>;
    if (watts !== null) {
      // A separate power meter is the source of truth for watts: the trainer is asked for a few percent more or less
      // so that the meter, not the trainer's own reading, sits on the target.
      if (settings.powerMatch && deps.powerFromMeter()) {
        watts = Math.round(deps.powerMatch.update({ target: watts, meterWatts: deps.live.power, pedalling: deps.live.cadence > 0 && !player!.paused, dt }));
      } else deps.powerMatch.reset();
      decision = decideTrainerCommand({ mode: 'erg', watts }, last);
    } else {
      deps.powerMatch.reset();
      // In someone's draft the trainer's wind resistance drops too, so it feels easier; aero kit from the garage trims it
      // a little as well, and so does thinner air at altitude, as in the app's own physics. The road's wind goes to the
      // trainer's simulation too (headwind positive).
      decision = decideTrainerCommand({
        mode: 'sim',
        roadGrade: deps.roadGrade(),
        difficulty: settings.difficulty,
        virtualShifting: settings.virtualShifting,
        gear,
        draftSaving: deps.draftSaving(),
        cdaFactor: deps.cdaFactor(),
        airDensityRatio: deps.airDensityRatio(),
        headwind: deps.headwind(),
      }, last);
    }
    last = decision.last;
    const cmd = decision.command;
    if (!cmd) return;
    // A refused or unanswered command is sent again at the next tick (the trainer layer re-requests control, with a back-off).
    if (cmd.kind === 'power') {
      trainer.setTargetPower(cmd.watts).then((r) => { if (!r.ok) last = { ...last, watts: NaN }; }, () => { last = { ...last, watts: NaN }; });
    } else {
      trainer.setGrade(cmd.grade, cmd.dragFactor, cmd.headwind).then((r) => { if (!r.ok) last = { ...last, grade: NaN }; }, () => { last = { ...last, grade: NaN }; });
    }
  }

  return {
    tick,
    get gear() { return gear; },
    shift(by) {
      if (!deps.settings().virtualShifting) return false;
      const next = shiftGear(gear, by);
      if (next === gear) return false;
      gear = next;
      return true;
    },
    resendGrade() { last = { ...last, grade: NaN }; },
    resendWatts() { last = { ...last, watts: NaN }; },
    resendAll() { last = { ...last, grade: NaN, watts: NaN }; },
  };
}
