// The recorded activities and the recording half of the simulation step (src/rideSpans.ts), driven with fake hooks: the sample's
// fields, the statistics going to the ride's span or the workout's, the workout player's tick, finishWorkout and the beeps, new
// spans taking their baselines from the trip so far, which spans are worth saving, and the order of the hooks.
import { describe, expect, it } from 'vitest';
import { createRideSim } from '../../src/rideSim';
import { createRideSpans, MIN_RIDE_S, type PlayerLike, type RideSpans } from '../../src/rideSpans';
import type { RideFlags } from '../../src/rideIntegrity';

interface Rig {
  spans: RideSpans;
  sim: ReturnType<typeof createRideSim>;
  log: string[];
  state: { hr: number; baseAltitude: number | undefined; player: (PlayerLike & { ticks: [number, boolean, number][] }) | null };
}

function rig(): Rig {
  const sim = createRideSim();
  const log: string[] = [];
  const state: Rig['state'] = { hr: 140, baseAltitude: undefined, player: null };
  const flags: RideFlags = { usedDemo: false, timeScale: 1, splitByWorkout: false };
  const spans = createRideSpans({
    ride: sim.ride,
    live: sim.live,
    zones: () => ({ ftp: 200, maxHr: 185 }),
    heartRate: () => { log.push('hr'); return state.hr; },
    stage: () => { log.push('stage'); return { id: 's1', name: 'Stage One', baseAltitude: state.baseAltitude }; },
    player: () => state.player,
    finishWorkout: () => { log.push('finishWorkout'); },
    intervalBeeps: () => { log.push('beeps'); },
    flags,
    settings: () => ({ ftp: 200, maxHr: 185 }),
  });
  return { spans, sim, log, state };
}

const player = (o: Partial<PlayerLike> = {}) => {
  const p = { done: false, paused: false, ticks: [] as [number, boolean, number][], tick(dt: number, ped: boolean, w: number) { p.ticks.push([dt, ped, w]); }, ...o };
  return p;
};

/** Pedalling at `power` W and `speed` m/s for one 1-second step. */
function ride1(r: Rig, power: number, speed: number, cadence = 90) {
  r.sim.live.power = power;
  r.sim.live.cadence = cadence;
  r.sim.ride.speed = speed;
  r.spans.record(1);
}

describe('spans: creation and the current one', () => {
  it('starts with a ride span and no workout span', () => {
    const { spans } = rig();
    expect(spans.workout).toBeNull();
    expect(spans.current()).toBe(spans.ride);
    expect(spans.ride.workout).toBeNull();
    expect(spans.ride.saved).toBe(0);
  });

  it('the workout span is current while it is on', () => {
    const { spans } = rig();
    spans.workout = spans.create('Sweet spot');
    expect(spans.current()).toBe(spans.workout);
    expect(spans.workout.workout).toBe('Sweet spot');
    spans.workout = null;
    expect(spans.current()).toBe(spans.ride);
  });

  it('a new span takes its baselines from the trip so far, and has its own recorder', () => {
    const r = rig();
    Object.assign(r.sim.ride, { distance: 5200, startDistance: 200, climbed: 80, proM: 300 });
    const sp = r.spans.create('W');
    expect(sp.base).toEqual({ dist: 5000, climbed: 80, proM: 300 });
    expect(sp.rec).not.toBe(r.spans.ride.rec);
    expect(sp.rec.id).not.toBe(r.spans.ride.rec.id);
    expect(sp.st).not.toBe(r.spans.ride.st);
  });
});

describe('spans: end, totals and what is worth saving', () => {
  it('end() freezes the baseline once, and totals() stops growing', () => {
    const r = rig();
    const sp = r.spans.create();
    Object.assign(r.sim.ride, { distance: 1000, climbed: 20, proM: 50 });
    expect(r.spans.totals(sp)).toEqual({ distance: 1000, climbed: 20, proM: 50 });
    r.spans.end(sp);
    Object.assign(r.sim.ride, { distance: 4000, climbed: 90, proM: 70 });
    r.spans.end(sp); // second call keeps the first
    expect(sp.end).toEqual({ dist: 1000, climbed: 20, proM: 50 });
    expect(r.spans.totals(sp)).toEqual({ distance: 1000, climbed: 20, proM: 50 });
  });

  it('totals() counts from the span base and never goes negative', () => {
    const r = rig();
    Object.assign(r.sim.ride, { distance: 3000, startDistance: 0, climbed: 10, proM: 5 });
    const sp = r.spans.create();
    Object.assign(r.sim.ride, { distance: 3500, climbed: 40, proM: 5 });
    expect(r.spans.totals(sp)).toEqual({ distance: 500, climbed: 30, proM: 0 });
    r.sim.ride.distance = 100; // the trip went back (reset)
    expect(r.spans.totals(sp).distance).toBe(0);
  });

  it('worthSaving needs MIN_RIDE_S seconds that are not saved yet; unsaved() lists the workout first', () => {
    const r = rig();
    r.spans.workout = r.spans.create('W');
    expect(r.spans.unsaved()).toEqual([]);
    for (let i = 0; i < MIN_RIDE_S; i++) { r.spans.ride.st.add(1, 150, 80, 0, true); r.spans.workout.st.add(1, 150, 80, 0, true); }
    expect(r.spans.unsaved()).toEqual([r.spans.workout, r.spans.ride]);
    r.spans.workout.saved = MIN_RIDE_S;
    expect(r.spans.unsaved()).toEqual([r.spans.ride]);
    expect(r.spans.worthSaving(r.spans.workout)).toBe(false);
    r.spans.workout = null;
    r.spans.ride.saved = MIN_RIDE_S - 1;
    expect(r.spans.unsaved()).toEqual([r.spans.ride]);
  });
});

describe('spans: the sample', () => {
  it('holds the live power, cadence and heart rate, with distance from the span baseline and elevation including the base altitude', () => {
    const r = rig();
    Object.assign(r.sim.ride, { distance: 1000, startDistance: 100 });
    r.spans.ride = r.spans.create(); // base.dist = 900
    r.state.baseAltitude = 1200;
    r.sim.ride.distance = 1250;
    r.sim.ride.lastElev = 12.34;
    ride1(r, 210.4, 7.26, 88.6);
    const x = r.spans.ride.rec.samples;
    expect(x.power).toEqual([210]);
    expect(x.cadence).toEqual([89]);
    expect(x.hr).toEqual([140]);
    expect(x.speed).toEqual([73]); // m/s x 10, rounded
    expect(x.distance).toEqual([250]); // 1250 - 100 - 900
    expect(x.elevation).toEqual([Math.round((1200 + 12.34) * 10)]);
  });

  it('a stage with no base altitude counts from zero', () => {
    const r = rig();
    r.sim.ride.lastElev = 5;
    ride1(r, 150, 6);
    expect(r.spans.ride.rec.samples.elevation).toEqual([50]);
  });

  it('goes to the workout span, with its baseline, while one is on', () => {
    const r = rig();
    r.sim.ride.distance = 2000;
    r.spans.workout = r.spans.create('W'); // base.dist = 2000
    r.sim.ride.distance = 2300;
    ride1(r, 200, 8);
    expect(r.spans.workout.rec.samples.distance).toEqual([300]);
    expect(r.spans.ride.rec.samples.power).toEqual([]);
  });

  it('records nothing when not moving (no power, speed under 0.3 m/s), but does when only power is on', () => {
    const r = rig();
    ride1(r, 0, 0.3, 0);
    expect(r.spans.ride.rec.seconds).toBe(0);
    expect(r.spans.ride.st.seconds).toBe(0);
    ride1(r, 100, 0, 0);
    expect(r.spans.ride.rec.seconds).toBe(1);
  });
});

describe('spans: the statistics', () => {
  it('go to the ride span when no workout span is on', () => {
    const r = rig();
    ride1(r, 200, 8);
    ride1(r, 200, 8);
    expect(r.spans.ride.st.seconds).toBe(2);
    expect(r.spans.ride.st.work).toBe(400);
  });

  it('leave the ride span alone while a workout span is on, and go to it only while pedalling and not paused', () => {
    const r = rig();
    r.spans.workout = r.spans.create('W');
    const p = player();
    r.state.player = p;
    ride1(r, 200, 8); // pedalling: counts
    expect(r.spans.workout.st.seconds).toBe(1);
    expect(r.spans.ride.st.seconds).toBe(0);
    p.paused = true;
    ride1(r, 200, 8); // paused: no
    expect(r.spans.workout.st.seconds).toBe(1);
    p.paused = false;
    ride1(r, 0, 8, 0); // coasting with no cadence: no
    expect(r.spans.workout.st.seconds).toBe(1);
    ride1(r, 0, 8, 80); // cadence alone is pedalling
    expect(r.spans.workout.st.seconds).toBe(2);
    expect(r.spans.ride.st.seconds).toBe(0);
  });

  it('do not go to the workout span once the player is done', () => {
    const r = rig();
    r.spans.workout = r.spans.create('W');
    r.state.player = player({ done: true });
    ride1(r, 200, 8);
    expect(r.spans.workout.st.seconds).toBe(0);
  });

  it('a player with no workout span is ticked and nothing is added', () => {
    const r = rig();
    const p = player();
    r.state.player = p;
    ride1(r, 200, 8);
    expect(p.ticks).toEqual([[1, true, 200]]);
    expect(r.spans.ride.st.seconds).toBe(1); // no workout span: the ride's statistics
  });
});

describe('spans: the workout player', () => {
  it('is ticked with dt, whether the rider is pedalling and the power; beeps follow while running', () => {
    const r = rig();
    const p = player();
    r.state.player = p;
    ride1(r, 180, 7, 0);
    expect(p.ticks).toEqual([[1, true, 180]]);
    expect(r.log.at(-1)).toBe('beeps');
    ride1(r, 0, 0, 0);
    expect(p.ticks[1]).toEqual([1, false, 0]);
  });

  it('paused: ticked, but no beeps and no statistics', () => {
    const r = rig();
    const p = player({ paused: true });
    r.state.player = p;
    r.spans.workout = r.spans.create('W');
    ride1(r, 180, 7);
    expect(p.ticks.length).toBe(1);
    expect(r.log).not.toContain('beeps');
    expect(r.log).not.toContain('finishWorkout');
    expect(r.spans.workout.st.seconds).toBe(0);
  });

  it('done before the tick: not ticked, finishWorkout is called, no beeps', () => {
    const r = rig();
    const p = player({ done: true });
    r.state.player = p;
    ride1(r, 180, 7);
    expect(p.ticks).toEqual([]);
    expect(r.log.filter((x) => x === 'finishWorkout').length).toBe(1);
    expect(r.log).not.toContain('beeps');
  });

  it('finishing on this very tick: the last step is counted, then finishWorkout (no beeps)', () => {
    const r = rig();
    const p = player();
    p.tick = (dt, ped, w) => { p.ticks.push([dt, ped, w]); p.done = true; };
    r.state.player = p;
    r.spans.workout = r.spans.create('W');
    ride1(r, 180, 7);
    expect(r.spans.workout.st.seconds).toBe(1);
    expect(r.log.at(-1)).toBe('finishWorkout');
    expect(r.log).not.toContain('beeps');
  });

  it('with no player there is no finishWorkout and no beeps', () => {
    const r = rig();
    ride1(r, 180, 7);
    expect(r.log).not.toContain('finishWorkout');
    expect(r.log).not.toContain('beeps');
  });
});

describe('spans: the hook order', () => {
  it('reads the heart rate and stage for the sample, then the heart rate again for the ride statistics, then the player hooks', () => {
    const r = rig();
    r.state.player = player();
    ride1(r, 200, 8);
    expect(r.log).toEqual(['hr', 'stage', 'hr', 'beeps']);
  });

  it('with a workout span the heart rate is read for the workout statistics after the player ticks', () => {
    const r = rig();
    r.spans.workout = r.spans.create('W');
    r.state.player = player();
    ride1(r, 200, 8);
    expect(r.log).toEqual(['hr', 'stage', 'hr', 'beeps']);
  });
});

describe('spans: the row to save', () => {
  it('a ride: its own id, samples (copied), distance and climbing from its baseline, the stage and the rider\'s settings', () => {
    const r = rig();
    Object.assign(r.sim.ride, { distance: 4000, climbed: 100 });
    r.spans.ride = r.spans.create();
    Object.assign(r.sim.ride, { distance: 4600, climbed: 130, racePlace: 2, raceSize: 9 });
    for (let i = 0; i < 3; i++) ride1(r, 200, 8);
    const row = r.spans.activity(r.spans.ride);
    expect(row.id).toBe(r.spans.ride.rec.id);
    expect(row.stage_id).toBe('s1');
    expect(row.title).toBe('Stage One');
    expect(row.distance_m).toBe(600);
    expect(row.climbed_m).toBe(30);
    expect(row.duration_s).toBe(3);
    r.spans.ride.rec.samples.power.push(1); // the row holds a copy
    expect(JSON.stringify(row)).not.toContain('"power":[200,200,200,1]');
  });

  it('a workout: titled after it, never finished, no race result', () => {
    const r = rig();
    r.sim.ride.finished = true;
    r.sim.ride.finishTime = 600;
    r.sim.ride.racePlace = 1;
    const sp = r.spans.create('Sweet spot');
    sp.completed = 'Sweet spot';
    const row = r.spans.activity(sp);
    expect(row.title).toBe('Sweet spot · Stage One');
    expect(row.finished).toBe(false);
    expect(row.workout_name).toBe('Sweet spot');
  });

  it('a finished ride keeps its finish flag', () => {
    const r = rig();
    r.sim.ride.finished = true;
    expect(r.spans.activity(r.spans.ride).finished).toBe(true);
  });
});
