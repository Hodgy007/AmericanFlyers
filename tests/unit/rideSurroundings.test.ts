// The ride's surroundings step (src/rideSurroundings.ts), driven with fake hooks: the wind following the stage and weather, the
// `?wind=` override, the riders gathered from presence, the pro teams and the AI rival, the draft easing, the cross-wind shift,
// the demo flag on an event, and the order the hooks are called in.
import { describe, expect, it } from 'vitest';
import { draftFrom } from '../../src/draft';
import { createRideSim } from '../../src/rideSim';
import {
  createRideSurroundings, DRAFT_LOOK_AHEAD, DRAFT_EASE_S, parseUrlWind, type RideSurroundings, type SurroundingsDeps, type SurroundingsSettings,
} from '../../src/rideSurroundings';
import { SHIFT_MAX, WindState, draftShift, type Climate } from '../../src/world/wind';
import type { Stage } from '../../src/stages';
import type { OtherRider } from '../../src/world/others';
import type { AiFrame } from '../../src/ai/aiRide';

const rider = (id: string, distance: number, extra: Partial<OtherRider> = {}): OtherRider => ({
  id, name: id, distance, speedMs: 8, power: 200, cadence: 85, ...extra,
});
const stageOf = (id: string, finish: number | null = 10000): Stage => ({ id, finish } as unknown as Stage);

interface Rig {
  s: RideSurroundings;
  log: string[];
  sim: ReturnType<typeof createRideSim>;
  settings: SurroundingsSettings;
  state: {
    stage: Stage; weather: Climate; race: { holding: boolean; update(dt: number, d: number, v: number): void } | null;
    event: { demoUsed: boolean } | null; eventHolding: boolean; demo: boolean; cross: number; lane: number; target: number | null; elapsed: number | null;
  };
  presence: OtherRider[];
  pros: OtherRider[];
  rival: OtherRider | null;
  aiFrames: AiFrame[];
  aiOn: boolean;
  wet: boolean[];
  lanesSet: number[];
  steerOpts: Parameters<SurroundingsDeps['steering']['update']>[1][];
  wind: WindState;
  heading: (d: number) => number;
  /** The riders handed to the last `steering.update`, by identity. */
  steerRiders(): OtherRider[];
}

function rig(o: { urlWind?: { ms: number; angle: number }; wind?: WindState } = {}): Rig {
  const sim = createRideSim();
  const wind = o.wind ?? new WindState();
  const log: string[] = [];
  const r: Rig = {
    s: undefined as unknown as RideSurroundings, log, sim,
    settings: { wind: true, rideTogether: false, proTeams: false, autoSteer: false },
    state: { stage: stageOf('alpha'), weather: 'clear', race: null, event: null, eventHolding: false, demo: false, cross: 0, lane: 0, target: null, elapsed: null },
    presence: [], pros: [], rival: null, aiFrames: [], aiOn: false, wet: [], lanesSet: [], steerOpts: [], wind,
    heading: () => 0,
    steerRiders: () => r.steerOpts[r.steerOpts.length - 1].riders,
  };
  const loggedWind = {
    get enabled() { return wind.enabled; },
    set enabled(v: boolean) { log.push('wind.enabled'); wind.enabled = v; },
    setStage: (...a: Parameters<WindState['setStage']>) => { log.push('wind.setStage'); wind.setStage(...a); },
    setWeather: (w: Climate) => { log.push('wind.setWeather'); wind.setWeather(w); },
    update: (dt: number) => { log.push('wind.update'); wind.update(dt); },
  };
  r.s = createRideSurroundings({
    ride: sim.ride,
    live: sim.live,
    settings: () => r.settings,
    urlWind: o.urlWind,
    wind: loggedWind,
    setRoadWet: (w) => { log.push('wet'); r.wet.push(w); },
    weather: () => r.state.weather,
    stage: () => r.state.stage,
    headingAt: (d) => r.heading(d),
    gradeAt: () => 0.05,
    roadWind: () => { log.push('roadWind'); return { head: 0, cross: r.state.cross }; },
    presence: { riders: () => { log.push('presence'); return r.presence; } },
    peloton: { update: () => { log.push('peloton.update'); }, riders: () => { log.push('peloton.riders'); return r.pros; } },
    race: () => r.state.race,
    eventState: () => r.state.event,
    eventHolding: () => r.state.eventHolding,
    demo: () => r.state.demo,
    ai: () => (r.aiOn ? { frame: (f) => { log.push('ai'); r.aiFrames.push(f); return r.rival; } } : null),
    workoutTarget: () => r.state.target,
    workoutElapsed: () => r.state.elapsed,
    heartRate: () => 140,
    steering: {
      target: 0.4,
      update: (_dt, opts) => { log.push('steer'); r.steerOpts.push(opts); },
    },
    lane: { current: () => r.state.lane, set: (t) => { log.push('lane.set'); r.lanesSet.push(t); } },
    lateralOf: () => undefined,
  });
  return r;
}

describe('the wind', () => {
  it('is set for the stage once, and again when the stage changes', () => {
    const r = rig();
    r.s.step(0.1);
    r.s.step(0.1);
    expect(r.log.filter((l) => l === 'wind.setStage')).toHaveLength(1);
    expect(r.s.windStage).toBe(r.state.stage);
    r.state.stage = stageOf('beta');
    r.s.step(0.1);
    expect(r.log.filter((l) => l === 'wind.setStage')).toHaveLength(2);
    expect(r.s.windStage?.id).toBe('beta');
  });

  it('starts at the stage wind (a stage with a table entry) from the start heading', () => {
    const r = rig();
    r.state.stage = { id: 'x', wind: { ms: 6, angle: 90 } } as unknown as Stage;
    r.heading = (d) => (d === 0 ? 1 : 99);
    r.s.step(0);
    expect(r.wind.meanSpeed).toBeCloseTo(6 * 0.6, 9); // clear weather scales it by 0.6
    expect(Math.abs(r.wind.toRad - (1 + Math.PI / 2))).toBeLessThan(0.25); // plus the slow wobble (at most 0.24 rad)
  });

  it('is overridden by the URL wind, keeping the stage id', () => {
    const r = rig({ urlWind: { ms: 9, angle: 180 } });
    r.state.stage = { id: 'x', wind: { ms: 2, angle: 0 } } as unknown as Stage;
    r.heading = () => 0.5;
    r.s.step(0);
    expect(r.wind.meanSpeed).toBeCloseTo(9 * 0.6, 9);
    expect(Math.abs(r.wind.toRad - (0.5 + Math.PI))).toBeLessThan(0.25);
  });

  it('follows the weather and the wind setting', () => {
    const r = rig();
    r.state.stage = { id: 'x', wind: { ms: 6, angle: 0 } } as unknown as Stage;
    r.s.step(0);
    const clear = r.wind.meanSpeed;
    r.state.weather = 'rain';
    r.s.step(0);
    expect(r.wind.weather).toBe('rain');
    for (let i = 0; i < 600; i++) r.s.step(1); // the mean eases to the weather's target over about a minute
    expect(r.wind.meanSpeed).not.toBeCloseTo(clear, 3);
    r.settings.wind = false;
    r.s.step(0.1);
    expect(r.wind.enabled).toBe(false);
    expect(r.wind.speed).toBe(0);
  });

  it('marks the road wet in rain only when there is no race or event', () => {
    const r = rig();
    r.state.weather = 'rain';
    r.s.step(0.1);
    r.state.race = { holding: false, update: () => {} };
    r.s.step(0.1);
    r.state.race = null;
    r.state.event = { demoUsed: false };
    r.s.step(0.1);
    r.state.event = null;
    r.state.weather = 'clear';
    r.s.step(0.1);
    expect(r.wet).toEqual([true, false, false, false]);
  });
});

describe('parseUrlWind', () => {
  it('reads speed and angle, defaulting the angle to 90', () => {
    expect(parseUrlWind('?wind=8,45')).toEqual({ ms: 8, angle: 45 });
    expect(parseUrlWind('?wind=8')).toEqual({ ms: 8, angle: 90 });
    expect(parseUrlWind('?wind=8,x')).toEqual({ ms: 8, angle: 90 });
  });
  it('is undefined without a usable speed', () => {
    expect(parseUrlWind('')).toBeUndefined();
    expect(parseUrlWind('?wind=')).toBeUndefined();
    expect(parseUrlWind('?wind=fast')).toBeUndefined();
  });
});

describe('the riders on the road', () => {
  it('are empty with every source off, and a copy of presence with Ride together', () => {
    const r = rig();
    r.presence = [rider('a', 50)];
    r.s.step(0.1);
    expect(r.s.roadRiders).toEqual([]);
    expect(r.log).not.toContain('presence');
    r.settings.rideTogether = true;
    r.s.step(0.1);
    expect(r.s.roadRiders).toEqual(r.presence);
    expect(r.s.roadRiders).not.toBe(r.presence); // a copy: the pros are pushed onto it
    expect(r.steerRiders()).toBe(r.s.roadRiders);
  });

  it('add the pro teams with the setting, a race, or an event', () => {
    const r = rig();
    r.pros = [rider('pro', 80, { team: 'T' })];
    r.s.step(0.1);
    expect(r.s.roadRiders).toEqual([]);
    expect(r.log).not.toContain('peloton.update');
    r.settings.proTeams = true;
    r.s.step(0.1);
    expect(r.s.roadRiders).toEqual(r.pros);
    r.settings.proTeams = false;
    r.state.race = { holding: false, update: () => {} };
    r.s.step(0.1);
    expect(r.s.roadRiders).toEqual(r.pros);
    r.state.race = null;
    r.state.event = { demoUsed: false };
    r.s.step(0.1);
    expect(r.s.roadRiders).toEqual(r.pros);
  });

  it('put presence first, then the pros, then the AI rival', () => {
    const r = rig();
    r.settings.rideTogether = true;
    r.settings.proTeams = true;
    r.aiOn = true;
    r.presence = [rider('live', 10)];
    r.pros = [rider('pro', 20)];
    r.rival = rider('rival', 30);
    r.s.step(0.1);
    expect(r.s.roadRiders.map((x) => x.id)).toEqual(['live', 'pro', 'rival']);
  });

  it('leave the AI out until it has loaded, and an AI that returns no rival adds none', () => {
    const r = rig();
    r.pros = [rider('pro', 20)];
    r.settings.proTeams = true;
    r.s.step(0.1);
    expect(r.aiFrames).toHaveLength(0);
    r.aiOn = true;
    r.s.step(0.1);
    expect(r.aiFrames).toHaveLength(1);
    expect(r.s.roadRiders.map((x) => x.id)).toEqual(['pro']);
  });

  it('move the race with your distance and speed', () => {
    const r = rig();
    const seen: number[][] = [];
    r.state.race = { holding: false, update: (dt, d, v) => { seen.push([dt, d, v]); } };
    r.sim.ride.distance = 123;
    r.sim.ride.speed = 9;
    r.s.step(0.25);
    expect(seen).toEqual([[0.25, 123, 9]]);
  });
});

describe('the AI frame', () => {
  it('carries the ride, the road and the workout, and the gap to the nearest rider ahead', () => {
    const r = rig();
    r.aiOn = true;
    r.settings.proTeams = true;
    r.pros = [rider('behind', 90), rider('far', 150), rider('near', 130)];
    Object.assign(r.sim.ride, { distance: 100, movingTime: 42, finishTime: 7, finished: false });
    Object.assign(r.sim.live, { power: 210, cadence: 88 });
    r.state.stage = stageOf('s', 5000);
    r.state.target = 250;
    r.state.elapsed = 33;
    r.s.step(0.5);
    expect(r.aiFrames[0]).toEqual({
      dt: 0.5, movingTime: 42, distance: 100, watts: 210, cadence: 88, hr: 140, gradePct: 5, finish: 5000, finishS: 7, finished: false,
      targetW: 250, workoutS: 33, gapAheadM: 30, drafting: false, riding: true,
    });
  });

  it('has no gap when nobody is ahead, and is not riding when finished, or held for a race or a group ride', () => {
    const r = rig();
    r.aiOn = true;
    r.s.step(0.1);
    expect(r.aiFrames[0].gapAheadM).toBeNull();
    expect(r.aiFrames[0].riding).toBe(true);
    r.sim.ride.finished = true;
    r.s.step(0.1);
    expect(r.aiFrames[1].riding).toBe(false);
    r.sim.ride.finished = false;
    r.state.race = { holding: true, update: () => {} };
    r.s.step(0.1);
    expect(r.aiFrames[2].riding).toBe(false);
    r.state.race = null;
    r.state.eventHolding = true;
    r.s.step(0.1);
    expect(r.aiFrames[3].riding).toBe(false);
  });

  it('sees the draft as it was at the end of the last step, not this one', () => {
    const r = rig();
    r.aiOn = true;
    r.settings.proTeams = true;
    r.pros = [rider('lead', 4)]; // a few metres ahead: a strong draft
    r.s.step(0.1);
    expect(r.aiFrames[0].drafting).toBe(false); // there was no draft yet
    expect(r.s.draft).not.toBeNull();
    r.s.step(0.1);
    expect(r.aiFrames[1].drafting).toBe(true);
  });
});

describe('steering', () => {
  it('is handed the full list, the auto-steer setting, the cross-wind shift and the heading, and sets the lane from its target', () => {
    const r = rig();
    r.settings.autoSteer = true;
    r.state.cross = 2;
    r.sim.ride.distance = 77;
    r.s.step(0.2);
    const o = r.steerOpts[0];
    expect(o.autoSteer).toBe(true);
    expect(o.distance).toBe(77);
    expect(o.shift).toBe(draftShift(2));
    expect(o.headingAt?.(5)).toBe(0);
    expect(r.lanesSet).toEqual([0.4]);
  });
});

describe('the draft', () => {
  it('eases towards the saving with a 0.6 s time constant', () => {
    const r = rig();
    r.settings.proTeams = true;
    r.pros = [rider('lead', 4)];
    const target = draftFrom(0, r.pros, DRAFT_LOOK_AHEAD, { lane: 0, lateralOf: () => undefined, shift: 0 })!.saving;
    expect(target).toBeGreaterThan(0.2);
    const dt = 0.1;
    r.s.step(dt);
    const k = 1 - Math.exp(-dt / DRAFT_EASE_S);
    expect(DRAFT_EASE_S).toBe(0.6);
    expect(r.s.draftSaving).toBeCloseTo(target * k, 12);
    r.s.step(dt);
    expect(r.s.draftSaving).toBeCloseTo(target * k + (target - target * k) * k, 12);
    for (let i = 0; i < 200; i++) r.s.step(dt);
    expect(r.s.draftSaving).toBeCloseTo(target, 6);
  });

  it('eases back to zero, and clears the draft, once nobody is ahead', () => {
    const r = rig();
    r.settings.proTeams = true;
    r.pros = [rider('lead', 4)];
    for (let i = 0; i < 100; i++) r.s.step(0.1);
    const full = r.s.draftSaving;
    expect(full).toBeGreaterThan(0.2);
    r.pros = [];
    r.s.step(0.1);
    expect(r.s.draft).toBeNull();
    expect(r.s.draftSaving).toBeCloseTo(full * Math.exp(-0.1 / 0.6), 12);
  });

  it('looks 60 m ahead, ignores ghosts, and uses the lane and the cross-wind shift', () => {
    const r = rig();
    r.settings.proTeams = true;
    r.pros = [rider('far', 80), rider('ghost', 5, { ghost: true })];
    r.s.step(0.1);
    expect(r.s.draft).toBeNull();
    r.pros = [rider('lead', 5, { lane: 0 })];
    r.state.lane = 0;
    r.state.cross = 10; // a stiff crosswind: the shelter sits SHIFT_MAX to the right, so a rider on your line shelters you only a little
    r.s.step(0.1);
    expect(r.s.lastCrossShift).toBe(SHIFT_MAX);
    expect(r.s.draft?.offset).toBeCloseTo(SHIFT_MAX, 9);
    expect(r.s.draft?.overlap).toBeLessThan(0.5);
    r.state.lane = SHIFT_MAX; // move across to the sheltered spot
    r.s.step(0.1);
    expect(r.s.draft?.overlap).toBe(1);
  });
});

describe('the cross-wind shift', () => {
  it('is draftShift of the cross wind at the rider\'s distance, kept for the HUD, both signs', () => {
    const r = rig();
    r.state.cross = 1;
    r.s.step(0.1);
    expect(r.s.lastCrossShift).toBe(0.25);
    r.state.cross = -1;
    r.s.step(0.1);
    expect(r.s.lastCrossShift).toBe(-0.25);
    r.state.cross = 0;
    r.s.step(0.1);
    expect(r.s.lastCrossShift).toBe(0);
  });
});

describe('demo riding in an event', () => {
  it('marks the event as demo-used, only with both', () => {
    const r = rig();
    r.s.step(0.1);
    r.state.demo = true;
    r.s.step(0.1); // no event: nothing to mark
    r.state.demo = false;
    r.state.event = { demoUsed: false };
    r.s.step(0.1);
    expect(r.state.event.demoUsed).toBe(false);
    r.state.demo = true;
    r.s.step(0.1);
    expect(r.state.event.demoUsed).toBe(true);
  });
});

describe('the order of the hooks', () => {
  it('is wind, cross wind, presence, race / peloton, AI, steering, lane, then the draft', () => {
    const r = rig();
    r.settings.rideTogether = true;
    r.settings.proTeams = true;
    r.aiOn = true;
    r.state.race = { holding: false, update: () => { r.log.push('race.update'); } };
    r.s.step(0.1);
    expect(r.log).toEqual([
      'wind.setStage', 'wind.enabled', 'wind.setWeather', 'wet', 'wind.update', 'roadWind',
      'presence', 'race.update', 'peloton.update', 'peloton.riders', 'ai', 'steer', 'lane.set',
    ]);
  });
});
