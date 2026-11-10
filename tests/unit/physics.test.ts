import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, airDensity, airDensityAt, stepSpeed } from '../../src/physics';

/** Runs the integrator until speed settles (or `seconds` pass). */
function settle(power: number, grade: number, from = 0, seconds = 600, p = DEFAULT_PARAMS) {
  let v = from;
  for (let i = 0; i < seconds * 10; i++) v = stepSpeed(v, power, grade, 0.1, p);
  return v;
}

const kmh = (ms: number) => ms * 3.6;

describe('stepSpeed', () => {
  it('settles to a plausible flat-road speed for 200 W', () => {
    const v = kmh(settle(200, 0));
    expect(v).toBeGreaterThan(28);
    expect(v).toBeLessThan(36);
  });

  it('is faster with more power, and slower uphill', () => {
    expect(settle(300, 0)).toBeGreaterThan(settle(200, 0));
    expect(settle(200, 0.06)).toBeLessThan(settle(200, 0));
  });

  it('climbs a 8% grade at 250 W at a realistic 10-15 km/h', () => {
    const v = kmh(settle(250, 0.08));
    expect(v).toBeGreaterThan(10);
    expect(v).toBeLessThan(16);
  });

  it('a lighter rider climbs faster, an aero rider is faster on the flat', () => {
    const light = { ...DEFAULT_PARAMS, massKg: 65 };
    const aero = { ...DEFAULT_PARAMS, cda: 0.25 };
    expect(settle(250, 0.08, 0, 600, light)).toBeGreaterThan(settle(250, 0.08));
    expect(settle(250, 0, 0, 600, aero)).toBeGreaterThan(settle(250, 0));
  });

  it('terminal speed matches the steady-state power balance', () => {
    const v = settle(220, 0);
    const p = DEFAULT_PARAMS;
    const needed = (0.5 * 1.225 * p.cda * v ** 3 + p.crr * p.massKg * 9.81 * v) / 0.976;
    expect(needed).toBeGreaterThan(210);
    expect(needed).toBeLessThan(230);
  });

  it('keeps momentum: coasting over a flat slows gradually, not instantly', () => {
    const v0 = 10;
    const v1 = stepSpeed(v0, 0, 0, 1);
    expect(v1).toBeLessThan(v0);
    expect(v1).toBeGreaterThan(v0 * 0.95);
  });

  it('picks up speed on a descent with no pedalling', () => {
    const v = settle(0, -0.07, 5, 120);
    expect(kmh(v)).toBeGreaterThan(40);
  });

  it('never goes negative and starts from a standstill', () => {
    expect(stepSpeed(0, 0, 0.1, 1)).toBe(0);
    expect(stepSpeed(0, 200, 0, 0.5)).toBeGreaterThan(0);
    expect(stepSpeed(0.2, 0, 0.2, 5)).toBeGreaterThanOrEqual(0);
  });

  it('ignores negative power', () => {
    expect(stepSpeed(5, -100, 0, 1)).toBeCloseTo(stepSpeed(5, 0, 0, 1), 10);
  });
});

describe('airDensity', () => {
  it('follows the ISA table', () => {
    expect(airDensity(0)).toBeCloseTo(1.225, 3);
    expect(airDensity(1000)).toBeCloseTo(1.112, 2);
    expect(airDensity(2000)).toBeCloseTo(1.007, 2);
    expect(airDensity(3000)).toBeCloseTo(0.909, 2);
    expect(airDensity(4000)).toBeCloseTo(0.819, 2);
  });

  it('is clamped to a sensible range', () => {
    expect(airDensity(-5000)).toBe(airDensity(-400));
    expect(airDensity(50000)).toBe(airDensity(6000));
    expect(airDensity(NaN)).toBeCloseTo(1.225, 3);
  });

  it('is worked out from a stage’s start altitude plus the climb so far', () => {
    const stage = { baseAltitude: 3000, elevationAt: (d: number) => d / 10 };
    expect(airDensityAt(stage, 10000)).toBeCloseTo(airDensity(4000), 10);
    expect(airDensityAt({ elevationAt: () => 0 }, 0)).toBeCloseTo(1.225, 3);
  });
});

describe('stepSpeed at altitude', () => {
  it('leaves callers that give no density unchanged (sea level)', () => {
    expect(settle(220, 0, 0, 120, { ...DEFAULT_PARAMS, airDensity: 1.225 })).toBeCloseTo(settle(220, 0, 0, 120), 10);
  });

  it('is faster on the flat at the same watts the higher you go', () => {
    const sea = settle(250, 0);
    const mile = settle(250, 0, 0, 600, { ...DEFAULT_PARAMS, airDensity: airDensity(1600) });
    const high = settle(250, 0, 0, 600, { ...DEFAULT_PARAMS, airDensity: airDensity(4000) });
    expect(mile).toBeGreaterThan(sea);
    expect(high).toBeGreaterThan(mile);
    expect(high / sea).toBeGreaterThan(1.1); // a third less air: about 12% faster at a steady 250 W
  });

  it('barely changes a steep climb, where drag is a small part of the load', () => {
    const sea = settle(300, 0.1);
    const high = settle(300, 0.1, 0, 600, { ...DEFAULT_PARAMS, airDensity: airDensity(4000) });
    expect(high / sea).toBeGreaterThan(1);
    expect(high / sea).toBeLessThan(1.02);
  });
});
