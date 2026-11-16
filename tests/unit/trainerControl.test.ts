// What is sent to the trainer each tick (src/trainerControl.ts): the rounding steps, the resend thresholds, the difficulty and the
// virtual gear's effect on the grade, ERG against simulation, what clears the "last sent" memory, and the virtual gear itself.
import { describe, expect, it } from 'vitest';
import { VIRTUAL_GEARS, VIRTUAL_REF, gearGradeOffset } from '../../src/drivetrain';
import {
  createTrainerControl, decideTrainerCommand, dragFactorToSend, freshLastSent, gearReadout, gradeToSend, headwindToSend, shiftGear,
  MAX_GEAR, MIN_GEAR, type SimInput, type TrainerControlDeps, type TrainerLike, type LastSent,
} from '../../src/trainerControl';

const sim = (o: Partial<SimInput> = {}): SimInput => ({
  mode: 'sim', roadGrade: 0.05, difficulty: 100, virtualShifting: false, gear: VIRTUAL_REF,
  draftSaving: 0, cdaFactor: 1, airDensityRatio: 1, headwind: 0, ...o,
});
const sent = (o: Partial<LastSent> = {}): LastSent => ({ grade: 5, watts: NaN, wind: 1, headwind: 0, ...o });

describe('gradeToSend', () => {
  it('is the road grade in percent, rounded to 0.1', () => {
    expect(gradeToSend(0.0534, 100, false, VIRTUAL_REF)).toBe(5.3);
    expect(gradeToSend(0.0536, 100, false, VIRTUAL_REF)).toBe(5.4);
    expect(gradeToSend(-0.0234, 100, false, VIRTUAL_REF)).toBe(-2.3);
  });
  it('scales by the difficulty', () => {
    expect(gradeToSend(0.08, 50, false, VIRTUAL_REF)).toBe(4);
    expect(gradeToSend(0.08, 0, false, VIRTUAL_REF)).toBe(0);
    expect(gradeToSend(0.08, 25, false, VIRTUAL_REF)).toBe(2);
  });
  it('adds the gear only when virtual shifting is on, after the difficulty', () => {
    expect(gradeToSend(0.04, 50, true, 20)).toBeCloseTo(Math.round((2 + gearGradeOffset(20)) * 10) / 10, 10);
    expect(gradeToSend(0.04, 50, false, 20)).toBe(2);
    expect(gradeToSend(0.04, 100, true, VIRTUAL_REF)).toBe(4);
    expect(gradeToSend(0, 100, true, 0)).toBeLessThan(0);
  });
  it('is kept between -10 and 20', () => {
    expect(gradeToSend(0.5, 100, false, VIRTUAL_REF)).toBe(20);
    expect(gradeToSend(-0.5, 100, false, VIRTUAL_REF)).toBe(-10);
    expect(gradeToSend(0.2, 100, true, MAX_GEAR)).toBe(20);
    expect(gradeToSend(-0.095, 100, true, 0)).toBe(-10);
  });
});

describe('dragFactorToSend and headwindToSend', () => {
  it('multiplies draft, aero kit and air, rounded to 0.02', () => {
    expect(dragFactorToSend(0, 1, 1)).toBe(1);
    expect(dragFactorToSend(0.3, 1, 1)).toBe(0.7);
    expect(dragFactorToSend(0.3, 0.88, 1)).toBe(0.62);
    expect(dragFactorToSend(0, 1, 0.8412)).toBe(0.84);
    expect(dragFactorToSend(0.123, 1, 1)).toBe(0.88);
  });
  it('rounds the headwind to half a metre per second, either way', () => {
    expect(headwindToSend(0)).toBe(0);
    expect(headwindToSend(0.24)).toBe(0);
    expect(headwindToSend(0.26)).toBe(0.5);
    expect(headwindToSend(3.7)).toBe(3.5);
    expect(headwindToSend(-2.8)).toBe(-3);
  });
});

describe('decideTrainerCommand in ERG', () => {
  it('sends the watts the first time, and forgets the grade', () => {
    const d = decideTrainerCommand({ mode: 'erg', watts: 200 }, sent());
    expect(d.command).toEqual({ kind: 'power', watts: 200 });
    expect(d.last.watts).toBe(200);
    expect(Number.isNaN(d.last.grade)).toBe(true);
    expect(d.last.wind).toBe(1);
  });
  it('does not resend within a watt, and does at a watt', () => {
    const l = sent({ watts: 200 });
    expect(decideTrainerCommand({ mode: 'erg', watts: 200 }, l)).toEqual({ command: null, last: l });
    expect(decideTrainerCommand({ mode: 'erg', watts: 200.9 }, l).command).toBeNull();
    expect(decideTrainerCommand({ mode: 'erg', watts: 199.1 }, l).command).toBeNull();
    expect(decideTrainerCommand({ mode: 'erg', watts: 201 }, l).command).toEqual({ kind: 'power', watts: 201 });
    expect(decideTrainerCommand({ mode: 'erg', watts: 199 }, l).command).toEqual({ kind: 'power', watts: 199 });
  });
  it('keeps the grade memory when nothing is sent', () => {
    const l = sent({ watts: 200 });
    expect(decideTrainerCommand({ mode: 'erg', watts: 200 }, l).last.grade).toBe(5);
  });
  it('sends a target of 0 W after a forgotten one, and does not change the memory passed in', () => {
    const l = sent({ watts: NaN });
    const copy = { ...l };
    expect(decideTrainerCommand({ mode: 'erg', watts: 0 }, l).command).toEqual({ kind: 'power', watts: 0 });
    expect(l).toEqual(copy);
  });
});

describe('decideTrainerCommand in simulation', () => {
  it('sends the first grade, drag factor and headwind, and forgets the ERG target', () => {
    const d = decideTrainerCommand(sim({ draftSaving: 0.3, headwind: 3.7 }), freshLastSent());
    expect(d.command).toEqual({ kind: 'grade', grade: 5, dragFactor: 0.7, headwind: 3.5 });
    expect(d.last).toEqual({ grade: 5, watts: NaN, wind: 0.7, headwind: 3.5 });
  });
  it('starts from a neutral drag factor and headwind', () => {
    expect(freshLastSent()).toEqual({ grade: NaN, watts: NaN, wind: 1, headwind: 0 });
  });
  it('does not resend when nothing moved enough', () => {
    const l = sent();
    expect(decideTrainerCommand(sim(), l)).toEqual({ command: null, last: l });
    expect(decideTrainerCommand(sim({ roadGrade: 0.0504 }), l).command).toBeNull(); // 5.0 after rounding
  });
  it('resends when the rounded grade moves by about 0.1 or more', () => {
    expect(decideTrainerCommand(sim({ roadGrade: 0.052 }), sent()).command).toEqual({ kind: 'grade', grade: 5.2, dragFactor: 1, headwind: 0 });
    expect(decideTrainerCommand(sim({ roadGrade: 0.048 }), sent()).command).toEqual({ kind: 'grade', grade: 4.8, dragFactor: 1, headwind: 0 });
    // A single 0.1 step (5.1 − 5.0 is 0.0999… in floating point) is sent: the change is compared in tenths.
    expect(decideTrainerCommand(sim({ roadGrade: 0.051 }), sent()).command).toEqual({ kind: 'grade', grade: 5.1, dragFactor: 1, headwind: 0 });
    expect(decideTrainerCommand(sim({ roadGrade: 0.049 }), sent()).command).toEqual({ kind: 'grade', grade: 4.9, dragFactor: 1, headwind: 0 });
  });
  it('sends a step of 0.1 up or down from every tenth between -10 and 20, and never resends the same value', () => {
    for (let t = -100; t <= 200; t++) {
      const g = t / 10;
      const last = sent({ grade: g });
      expect(decideTrainerCommand(sim({ roadGrade: g / 100 }), last).command, `${g} again`).toBeNull();
      if (t < 200) expect(decideTrainerCommand(sim({ roadGrade: (t + 1) / 1000 }), last).command, `${g} up`).toMatchObject({ kind: 'grade', grade: (t + 1) / 10 });
      if (t > -100) expect(decideTrainerCommand(sim({ roadGrade: (t - 1) / 1000 }), last).command, `${g} down`).toMatchObject({ kind: 'grade', grade: (t - 1) / 10 });
    }
  });
  it('sends the first grade whatever it is (nothing sent yet)', () => {
    expect(decideTrainerCommand(sim({ roadGrade: 0 }), freshLastSent()).command).toEqual({ kind: 'grade', grade: 0, dragFactor: 1, headwind: 0 });
  });
  it('resends when only the drag factor changes', () => {
    expect(decideTrainerCommand(sim({ draftSaving: 0.2 }), sent()).command).toEqual({ kind: 'grade', grade: 5, dragFactor: 0.8, headwind: 0 });
    expect(decideTrainerCommand(sim({ cdaFactor: 0.97 }), sent()).command).not.toBeNull();
    expect(decideTrainerCommand(sim({ airDensityRatio: 0.9 }), sent()).command).not.toBeNull();
  });
  it('does not resend for a drag change smaller than its 0.02 step', () => {
    expect(decideTrainerCommand(sim({ draftSaving: 0.004 }), sent()).command).toBeNull();
  });
  it('resends when only the headwind changes by a rounded half metre per second', () => {
    expect(decideTrainerCommand(sim({ headwind: 0.2 }), sent()).command).toBeNull();
    expect(decideTrainerCommand(sim({ headwind: 0.3 }), sent()).command).toEqual({ kind: 'grade', grade: 5, dragFactor: 1, headwind: 0.5 });
    expect(decideTrainerCommand(sim({ headwind: -1 }), sent()).command).not.toBeNull();
  });
  it('sends after the grade was forgotten, whatever the rest', () => {
    expect(decideTrainerCommand(sim(), sent({ grade: NaN })).command).not.toBeNull();
  });
  it('sends after ERG even for the same grade', () => {
    const afterErg = decideTrainerCommand({ mode: 'erg', watts: 150 }, sent()).last;
    expect(decideTrainerCommand(sim(), afterErg).command).not.toBeNull();
  });
  it('uses the difficulty and the gear', () => {
    expect(decideTrainerCommand(sim({ difficulty: 50 }), sent({ grade: NaN })).command).toMatchObject({ grade: 2.5 });
    const hard = decideTrainerCommand(sim({ virtualShifting: true, gear: 20 }), sent({ grade: NaN })).command;
    expect(hard).toMatchObject({ kind: 'grade', grade: Math.round((5 + gearGradeOffset(20)) * 10) / 10 });
  });
});

describe('the virtual gear', () => {
  it('has 24 gears and starts at the neutral one', () => {
    expect(MIN_GEAR).toBe(0);
    expect(MAX_GEAR).toBe(VIRTUAL_GEARS.length - 1);
    expect(MAX_GEAR).toBe(23);
  });
  it('shifts and stops at the ends', () => {
    expect(shiftGear(11, 1)).toBe(12);
    expect(shiftGear(11, -1)).toBe(10);
    expect(shiftGear(MAX_GEAR, 1)).toBe(MAX_GEAR);
    expect(shiftGear(MIN_GEAR, -1)).toBe(MIN_GEAR);
    expect(shiftGear(22, 5)).toBe(MAX_GEAR);
  });
  it('reads out for the panel', () => {
    expect(gearReadout(0)).toEqual({ number: '1', fraction: 0, ratio: '0.75 : 1' });
    expect(gearReadout(MAX_GEAR)).toEqual({ number: '24', fraction: 1, ratio: '4.80 : 1' });
    expect(gearReadout(VIRTUAL_REF).number).toBe('12');
    expect(gearReadout(VIRTUAL_REF).fraction).toBeCloseTo(11 / 23, 12);
  });
});

// ---- the wrapper ----

type Result = { ok: boolean };
interface Rig {
  tc: ReturnType<typeof createTrainerControl>;
  calls: string[];
  /** Resolvers of pending trainer calls, oldest first. */
  answers: ((r: Result) => void)[];
  s: { trainer: TrainerLike | null; difficulty: number; virtualShifting: boolean; powerMatch: boolean; now: number; player: { done: boolean; paused: boolean; target: number | null } | null; meter: boolean; grade: number; draft: number; cda: number; air: number; head: number };
  live: { power: number; cadence: number };
  pm: { updates: unknown[]; resets: number };
}

function rig(): Rig {
  const calls: string[] = [];
  const answers: ((r: Result) => void)[] = [];
  const ask = () => new Promise<Result>((res) => { answers.push(res); });
  const trainer = {
    canControl: true,
    setGrade: (g: number, w?: number, h?: number) => { calls.push(`grade ${g} ${w} ${h}`); return ask(); },
    setTargetPower: (w: number) => { calls.push(`power ${w}`); return ask(); },
  } as unknown as TrainerLike;
  const s: Rig['s'] = { trainer, difficulty: 100, virtualShifting: false, powerMatch: false, now: 1000, player: null, meter: false, grade: 0.05, draft: 0, cda: 1, air: 1, head: 0 };
  const live = { power: 0, cadence: 0 };
  const pm = { updates: [] as unknown[], resets: 0 };
  const deps: TrainerControlDeps = {
    trainer: () => s.trainer,
    settings: () => s,
    now: () => s.now,
    live,
    player: () => (s.player ? { get done() { return s.player!.done; }, get paused() { return s.player!.paused; }, targetWatts: () => s.player!.target } : null),
    powerFromMeter: () => s.meter,
    powerMatch: { update: (i) => { pm.updates.push(i); return i.target + 7; }, reset: () => { pm.resets++; } },
    roadGrade: () => s.grade,
    draftSaving: () => s.draft,
    cdaFactor: () => s.cda,
    airDensityRatio: () => s.air,
    headwind: () => s.head,
  };
  return { tc: createTrainerControl(deps), calls, answers, s, live, pm };
}
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('createTrainerControl', () => {
  it('does nothing without a controllable trainer', () => {
    const r = rig();
    r.s.trainer = null;
    r.tc.tick();
    r.s.trainer = { canControl: false } as unknown as TrainerLike;
    r.tc.tick();
    expect(r.calls).toEqual([]);
  });

  it('sends the grade once, then only when it changes', () => {
    const r = rig();
    r.tc.tick();
    r.tc.tick();
    expect(r.calls).toEqual(['grade 5 1 0']);
    r.s.grade = 0.06;
    r.tc.tick();
    expect(r.calls).toEqual(['grade 5 1 0', 'grade 6 1 0']);
  });

  it('holds the workout target in ERG, then sends the grade again when it ends', () => {
    const r = rig();
    r.tc.tick();
    r.s.player = { done: false, paused: false, target: 180 };
    r.tc.tick();
    r.tc.tick();
    r.s.player = null;
    r.tc.tick();
    expect(r.calls).toEqual(['grade 5 1 0', 'power 180', 'grade 5 1 0']);
  });

  it('treats a player with no target, or one that is done, as simulation', () => {
    const r = rig();
    r.s.player = { done: false, paused: false, target: null };
    r.tc.tick();
    r.s.player = { done: true, paused: false, target: 200 };
    r.s.grade = 0.07;
    r.tc.tick();
    expect(r.calls).toEqual(['grade 5 1 0', 'grade 7 1 0']);
  });

  it('corrects the ERG target for a separate power meter only when asked to', () => {
    const r = rig();
    r.s.player = { done: false, paused: false, target: 200 };
    r.s.meter = true;
    r.tc.tick(); // power match off: reset, target as it is
    expect(r.calls).toEqual(['power 200']);
    expect(r.pm.updates).toEqual([]);
    r.s.powerMatch = true;
    r.live.power = 190;
    r.live.cadence = 80;
    r.tc.tick();
    expect(r.calls).toEqual(['power 200', 'power 207']);
    expect(r.pm.updates).toEqual([{ target: 200, meterWatts: 190, pedalling: true, dt: 0 }]);
  });

  it('gives the power match the seconds since the last tick, up to 5, and says not pedalling when paused or still', () => {
    const r = rig();
    r.s.player = { done: false, paused: false, target: 200 };
    r.s.meter = true;
    r.s.powerMatch = true;
    r.live.cadence = 80;
    r.tc.tick();
    r.s.now += 2500;
    r.s.player.paused = true;
    r.tc.tick();
    r.s.now += 60000;
    r.s.player.paused = false;
    r.live.cadence = 0;
    r.tc.tick();
    expect(r.pm.updates).toEqual([
      { target: 200, meterWatts: 0, pedalling: true, dt: 0 },
      { target: 200, meterWatts: 0, pedalling: false, dt: 2.5 },
      { target: 200, meterWatts: 0, pedalling: false, dt: 5 },
    ]);
  });

  it('resets the power match in simulation and when the meter is not the source', () => {
    const r = rig();
    r.tc.tick();
    expect(r.pm.resets).toBe(1);
    r.s.player = { done: false, paused: false, target: 100 };
    r.s.powerMatch = true;
    r.tc.tick();
    expect(r.pm.resets).toBe(2);
  });

  it('sends the draft, aero kit, air and headwind', () => {
    const r = rig();
    r.s.draft = 0.3;
    r.s.cda = 0.88;
    r.s.head = 2.8;
    r.tc.tick();
    expect(r.calls).toEqual(['grade 5 0.62 3']);
  });

  it('sends again at the next tick when the trainer refuses or throws away a grade', async () => {
    const r = rig();
    r.tc.tick();
    r.answers[0]({ ok: false });
    await flush();
    r.tc.tick();
    expect(r.calls).toHaveLength(2);
    r.answers[1]({ ok: true });
    await flush();
    r.tc.tick();
    expect(r.calls).toHaveLength(2);
  });

  it('sends again after a refused ERG target', async () => {
    const r = rig();
    r.s.player = { done: false, paused: false, target: 150 };
    r.tc.tick();
    r.answers[0]({ ok: false });
    await flush();
    r.tc.tick();
    expect(r.calls).toEqual(['power 150', 'power 150']);
    // the second call is still unanswered: nothing is resent
    r.tc.tick();
    expect(r.calls).toHaveLength(2);
  });

  it('forgets what was sent on resendGrade, resendWatts and resendAll', () => {
    const r = rig();
    r.tc.tick();
    r.tc.resendWatts(); // the grade is still known
    r.tc.tick();
    expect(r.calls).toHaveLength(1);
    r.tc.resendGrade();
    r.tc.tick();
    expect(r.calls).toHaveLength(2);
    r.s.player = { done: false, paused: false, target: 150 };
    r.tc.tick();
    r.tc.tick();
    expect(r.calls).toHaveLength(3);
    r.tc.resendWatts();
    r.tc.tick();
    expect(r.calls).toHaveLength(4);
    r.tc.resendAll();
    r.tc.tick();
    expect(r.calls).toHaveLength(5);
  });

  it('shifts only with virtual shifting on, and the gear changes the grade sent', () => {
    const r = rig();
    expect(r.tc.gear).toBe(VIRTUAL_REF);
    expect(r.tc.shift(1)).toBe(false);
    expect(r.tc.gear).toBe(VIRTUAL_REF);
    r.s.virtualShifting = true;
    r.tc.tick();
    expect(r.calls).toEqual(['grade 5 1 0']);
    expect(r.tc.shift(2)).toBe(true);
    expect(r.tc.gear).toBe(VIRTUAL_REF + 2);
    r.tc.tick();
    expect(r.calls[1]).toBe(`grade ${Math.round((5 + gearGradeOffset(VIRTUAL_REF + 2)) * 10) / 10} 1 0`);
  });

  it('stops shifting at the ends and keeps the gear when shifting is switched off', () => {
    const r = rig();
    r.s.virtualShifting = true;
    expect(r.tc.shift(-20)).toBe(true);
    expect(r.tc.gear).toBe(MIN_GEAR);
    expect(r.tc.shift(-1)).toBe(false);
    r.s.virtualShifting = false;
    expect(r.tc.gear).toBe(MIN_GEAR);
  });
});
