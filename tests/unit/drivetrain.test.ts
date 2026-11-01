import { describe, expect, it } from 'vitest';
import { Drivetrain, MAX_ROCK, GEARS, VIRTUAL_GEARS, VIRTUAL_REF, gearCadence, gearGradeOffset } from '../../src/drivetrain';

describe('gear tables', () => {
  it('GEARS is sorted, unique and spans easy to hard', () => {
    for (let i = 1; i < GEARS.length; i++) expect(GEARS[i]).toBeGreaterThan(GEARS[i - 1]);
    expect(GEARS[0]).toBeCloseTo(1, 1); // 34x34
    expect(GEARS[GEARS.length - 1]).toBeCloseTo(50 / 11, 2);
  });

  it('VIRTUAL_GEARS has 24 evenly (geometrically) spaced gears', () => {
    expect(VIRTUAL_GEARS).toHaveLength(24);
    expect(VIRTUAL_GEARS[0]).toBeCloseTo(0.75, 3);
    expect(VIRTUAL_GEARS[23]).toBeCloseTo(4.8, 2);
    const r = VIRTUAL_GEARS[1] / VIRTUAL_GEARS[0];
    for (let i = 2; i < 24; i++) expect(VIRTUAL_GEARS[i] / VIRTUAL_GEARS[i - 1]).toBeCloseTo(r, 2);
  });
});

describe('gearGradeOffset', () => {
  it('is zero in the neutral gear, positive for harder, negative for easier, and clamped', () => {
    expect(gearGradeOffset(VIRTUAL_REF)).toBeCloseTo(0, 6);
    expect(gearGradeOffset(VIRTUAL_REF + 3)).toBeGreaterThan(0);
    expect(gearGradeOffset(VIRTUAL_REF - 3)).toBeLessThan(0);
    for (let i = 0; i < 24; i++) {
      expect(gearGradeOffset(i)).toBeGreaterThanOrEqual(-6);
      expect(gearGradeOffset(i)).toBeLessThanOrEqual(9);
    }
  });
});

describe('gearCadence', () => {
  it('rises with speed and falls with a harder gear', () => {
    expect(gearCadence(10, 10)).toBeGreaterThan(gearCadence(5, 10));
    expect(gearCadence(10, 15)).toBeLessThan(gearCadence(10, 10));
  });

  it('gives a sensible cadence for 20 km/h in a middle gear', () => {
    const rpm = gearCadence(20 / 3.6, 12);
    expect(rpm).toBeGreaterThan(50);
    expect(rpm).toBeLessThan(120);
  });
});

describe('Drivetrain', () => {
  it('shifts up as speed rises while pedalling at a steady cadence', () => {
    const d = new Drivetrain();
    let v = 0;
    for (let i = 0; i < 600; i++) {
      v = Math.min(12, v + 0.05);
      d.update(0.1, v, 90, 250);
    }
    expect(d.gear).toBeGreaterThan(5);
  });

  it('keeps the legs turning at the cadence the wheel allows', () => {
    const d = new Drivetrain();
    for (let i = 0; i < 400; i++) d.update(0.1, 9, 90, 200);
    const rpm = d.crankRate * 60;
    expect(rpm).toBeGreaterThan(70);
    expect(rpm).toBeLessThan(110);
  });

  it('winds the legs down when you stop pedalling, and resets to the easiest gear at a standstill', () => {
    const d = new Drivetrain();
    for (let i = 0; i < 200; i++) d.update(0.1, 9, 90, 200);
    for (let i = 0; i < 100; i++) d.update(0.1, 9, 0, 0);
    expect(d.crankRate).toBeLessThan(0.1);
    for (let i = 0; i < 20; i++) d.update(0.1, 0, 0, 0);
    expect(d.gear).toBe(0);
  });

  it('virtual gearing is under the rider\'s control', () => {
    const d = new Drivetrain();
    d.virtualGear = 14;
    for (let i = 0; i < 100; i++) d.update(0.1, 8, 90, 200);
    expect(d.gear).toBe(0);
    expect(d.ratio).toBe(VIRTUAL_GEARS[14]);
  });

  it('pedal rock is zero when not pedalling', () => {
    const d = new Drivetrain();
    for (let i = 0; i < 50; i++) d.update(0.1, 5, 0, 0);
    expect(d.rock).toBeCloseTo(0, 6);
  });

  it('pedal rock stays within about a degree, even grinding up a climb', () => {
    const d = new Drivetrain();
    let most = 0;
    for (let i = 0; i < 600; i++) { d.update(1 / 60, 2.5, 55, 450); most = Math.max(most, Math.abs(d.rock)); }
    expect(most).toBeGreaterThan(0);
    expect(most).toBeLessThanOrEqual(MAX_ROCK + 1e-9);
    expect(MAX_ROCK).toBeLessThan((1.2 * Math.PI) / 180);
  });
});
