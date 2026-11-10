import { describe, expect, it } from 'vitest';
import { BRAKE_DECEL, MAX_DECEL, cornerSpeedForRadius, cornerSpeedLimit, limitCornerSpeed, setRoadWet } from '../../src/cornering';
import { DEFAULT_PARAMS, airDensityAt, stepSpeed } from '../../src/physics';
import { STAGES, stageById } from '../../src/stages';

const kmh = (ms: number) => ms * 3.6;

/** A straight road with one circular bend of radius `r` metres turning `turn` radians, starting at `at`. */
const bend = (at: number, r: number, turn: number) => (d: number) => Math.min(turn, Math.max(0, (d - at) / r));
const straight = () => 0;

describe('cornerSpeedForRadius', () => {
  it('lets a 10 m hairpin through at about 32 km/h dry', () => {
    expect(kmh(cornerSpeedForRadius(10))).toBeGreaterThan(30);
    expect(kmh(cornerSpeedForRadius(10))).toBeLessThan(34);
  });
  it('is slower wet, and faster in a wider bend', () => {
    expect(cornerSpeedForRadius(10, true)).toBeLessThan(cornerSpeedForRadius(10));
    expect(cornerSpeedForRadius(40)).toBeGreaterThan(cornerSpeedForRadius(10));
  });
});

describe('cornerSpeedLimit', () => {
  it('has no limit on a straight road', () => {
    for (const d of [0, 10, 999, 1000, 1001, 5000]) expect(cornerSpeedLimit(d, { headingAt: straight, wet: false })).toBe(Infinity);
  });

  it('limits a 10 m radius hairpin to about 32 km/h dry, less wet', () => {
    const headingAt = bend(500, 10, Math.PI);
    const apex = 500 + 5 * Math.PI;
    const dry = kmh(cornerSpeedLimit(apex, { headingAt, wet: false }));
    expect(dry).toBeGreaterThan(30);
    expect(dry).toBeLessThan(34);
    expect(kmh(cornerSpeedLimit(apex, { headingAt, wet: true }))).toBeLessThan(dry * 0.85);
  });

  it('does not touch a 200 m radius sweeper at 60 km/h', () => {
    const headingAt = bend(500, 200, Math.PI / 2);
    expect(cornerSpeedLimit(600, { headingAt, wet: false })).toBeGreaterThan(60 / 3.6 * 2);
    for (let d = 300; d < 800; d += 7) expect(limitCornerSpeed(60 / 3.6, d, 0.1, { headingAt, wet: false })).toBe(60 / 3.6);
  });

  it('asks for less the nearer a hairpin gets, by no more than the comfortable braking', () => {
    const headingAt = bend(500, 10, Math.PI);
    let prev = Infinity;
    for (let d = 300; d < 500; d += 1) {
      const v = cornerSpeedLimit(d, { headingAt, wet: false });
      expect(v).toBeLessThanOrEqual(prev + 1e-3);
      if (Number.isFinite(prev) && Number.isFinite(v)) {
        // v² falls by 2·a per metre at most (a little slack for the table's 5 m cells)
        expect(prev * prev - v * v).toBeLessThanOrEqual(2 * BRAKE_DECEL * 1.15 + 1e-6);
      }
      prev = v;
    }
  });

  it('keeps GPS-style wiggles from reading as bends', () => {
    const wiggly = (d: number) => 0.08 * Math.sin(d * 2.1) + 0.05 * Math.sin(d * 3.7 + 1);
    for (let d = 0; d < 3000; d += 5) expect(cornerSpeedLimit(d, { headingAt: wiggly, wet: false }), `d=${d}`).toBeGreaterThan(25);
  });

  it('brakes before a bend that sits past a table block boundary', () => {
    const headingAt = bend(1015, 10, Math.PI);
    const early = cornerSpeedLimit(940, { headingAt, wet: false });
    expect(early).toBeLessThan(30);
    expect(early).toBeGreaterThan(cornerSpeedLimit(1000, { headingAt, wet: false }));
  });

  it('is cached: after the first lookup it does not call headingAt again', () => {
    let calls = 0;
    const headingAt = (d: number) => { calls++; return bend(400, 15, Math.PI)(d); };
    cornerSpeedLimit(100, { headingAt, wet: false });
    const first = calls;
    expect(first).toBeLessThan(700); // one 1 km block with its overhang, not one call per lookup
    for (let i = 0; i < 2000; i++) cornerSpeedLimit(Math.random() * 990, { headingAt, wet: false });
    expect(calls).toBe(first);
  });

  it('uses the road’s wetness from setRoadWet when not told', () => {
    const headingAt = bend(500, 10, Math.PI);
    const dry = cornerSpeedLimit(510, { headingAt });
    setRoadWet(true);
    try { expect(cornerSpeedLimit(510, { headingAt })).toBeLessThan(dry); } finally { setRoadWet(false); }
    expect(cornerSpeedLimit(510, { headingAt })).toBe(dry);
  });
});

describe('limitCornerSpeed', () => {
  it('leaves a slow rider and a rider under the limit alone', () => {
    const headingAt = bend(500, 10, Math.PI);
    expect(limitCornerSpeed(2, 510, 0.1, { headingAt, wet: false })).toBe(2);
    expect(limitCornerSpeed(5, 510, 0.1, { headingAt, wet: false })).toBe(5);
  });

  it('brings a 70 km/h rider down smoothly to the hairpin speed, never harder than the cap', () => {
    const headingAt = bend(500, 10, Math.PI);
    const dt = 0.1;
    let d = 300;
    let v = 70 / 3.6;
    let speedInBend = Infinity;
    for (let i = 0; i < 400 && d < 520; i++) {
      const free = stepSpeed(v, 0, 0, dt);
      const limited = limitCornerSpeed(free, d, dt, { headingAt, wet: false });
      expect(free - limited, `step ${i}`).toBeLessThanOrEqual(MAX_DECEL * dt + 1e-9);
      v = limited;
      d += v * dt;
      if (d >= 512 && speedInBend === Infinity) speedInBend = v; // the curvature is measured over 20 m, so it builds up over the first 10 m
    }
    expect(kmh(speedInBend)).toBeLessThan(35); // down to about the hairpin speed by the bend
    expect(kmh(speedInBend)).toBeGreaterThan(28); // and not far below it
  });

  it('lets the normal physics speed the rider up again after the bend', () => {
    const headingAt = bend(500, 10, Math.PI);
    let d = 540; // just out of the hairpin, on the road that now runs the other way
    let v = 9;
    let free = 9;
    for (let i = 0; i < 150; i++) {
      v = limitCornerSpeed(stepSpeed(v, 300, 0, 0.1), d, 0.1, { headingAt, wet: false });
      free = stepSpeed(free, 300, 0, 0.1);
      d += v * 0.1;
    }
    expect(v).toBeCloseTo(free, 10); // nothing holds a rider back on a straight
    expect(v).toBeGreaterThan(10);
  });
});

describe('on the real stages', () => {
  /** Rides a stage at a steady power (the garage's 1 s steps), soft-pedalling steep descents. Returns seconds and whether a step braked on a real climb. */
  function ride(id: string, watts: number, limit: boolean) {
    const s = stageById(id);
    const grade = (d: number) => (s.elevationAt(d + 2) - s.elevationAt(d - 2)) / 4;
    let d = 0, v = 0, t = 0, brakedOnClimb = false;
    while (d < s.finish! && t < 4 * 3600) {
      const g = grade(d);
      const free = stepSpeed(v, watts * (g < -0.04 ? 0.35 : 1), g, 1, { ...DEFAULT_PARAMS, massKg: 83, airDensity: airDensityAt(s, d) });
      v = limit ? limitCornerSpeed(free, d, 1, { headingAt: s.headingAt, wet: false }) : free;
      if (v < free - 1e-9 && g > 0.02) brakedOnClimb = true;
      d += v;
      t += 1;
    }
    return { t, brakedOnClimb };
  }

  it('does not slow a 300 W ride up Alpe d’Huez at all', () => {
    const a = ride('alpe-dhuez', 300, false);
    const b = ride('alpe-dhuez', 300, true);
    expect(b.t).toBe(a.t);
    expect(b.brakedOnClimb).toBe(false);
  });

  it('never brakes a 300 W rider on the Stelvio’s climbing grades (only on its flat first kilometre)', () => {
    const a = ride('stelvio', 300, false);
    const b = ride('stelvio', 300, true);
    expect(b.brakedOnClimb).toBe(false);
    expect(b.t - a.t).toBeLessThanOrEqual(3); // two bends in the flat valley road, about 2 s over 95 minutes
  });

  it('keeps a fast descent under the corner speed in the tightest bends of Tour of the Moon', () => {
    const s = stageById('hotw-tour-of-the-moon');
    const opts = { headingAt: s.headingAt, wet: false };
    let d = 0, v = 0, worst = 0;
    while (d < s.finish!) {
      const g = (s.elevationAt(d + 2) - s.elevationAt(d - 2)) / 4;
      v = limitCornerSpeed(stepSpeed(v, 250 * (g < -0.04 ? 0.35 : 1), g, 0.1, { ...DEFAULT_PARAMS, massKg: 83 }), d, 0.1, opts);
      const lim = cornerSpeedLimit(d, opts);
      if (v > lim) worst = Math.max(worst, v - lim);
      d += v * 0.1;
    }
    expect(worst).toBeLessThan(0.6); // the cap lets a rider overshoot by a hair on a very sharp onset, no more
  });

  it('finds no bend tighter than the ones a rider can actually take (no stage limit under 30 km/h)', () => {
    for (const s of STAGES) {
      const opts = { headingAt: s.headingAt, wet: false };
      for (let d = 0; d < (s.finish ?? 10000); d += 10) expect(kmh(cornerSpeedLimit(d, opts)), `${s.id} @ ${d}`).toBeGreaterThan(30);
    }
  });
});
