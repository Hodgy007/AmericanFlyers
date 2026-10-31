// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_WORKOUTS, RAMP_TEST_ID, estimateTss, expand, stepAt, targetAt, totalDuration, zoneColor, type Block,
} from '../../src/workouts/model';
import { parseWorkoutFile, toZwo } from '../../src/workouts/files';

describe('expand', () => {
  it('lays steps end to end with running start times', () => {
    const steps = expand([
      { kind: 'steady', duration: 60, power: 0.5 },
      { kind: 'ramp', duration: 120, from: 0.5, to: 0.9 },
      { kind: 'free', duration: 30 },
    ]);
    expect(steps.map((s) => s.at)).toEqual([0, 60, 180]);
    expect(totalDuration(steps)).toBe(210);
    expect(steps[2].free).toBe(true);
    expect(steps[1].label).toBe('Ramp up');
  });

  it('expands intervals into labelled on/off pairs, with surges when the off is harder', () => {
    const steps = expand([{ kind: 'intervals', repeats: 3, onDuration: 120, onPower: 0.95, offDuration: 60, offPower: 1.05 }]);
    expect(steps).toHaveLength(6);
    expect(steps[0].label).toBe('Interval 1/3');
    expect(steps[1].label).toBe('Surge 1/3');
    expect(totalDuration(steps)).toBe(3 * 180);
    const rec = expand([{ kind: 'intervals', repeats: 2, onDuration: 60, onPower: 1, offDuration: 60, offPower: 0.5 }]);
    expect(rec[1].label).toBe('Recovery 1/2');
  });

  it('drops zero-length blocks and handles an empty workout', () => {
    expect(expand([{ kind: 'steady', duration: 0, power: 1 }])).toEqual([]);
    expect(totalDuration([])).toBe(0);
    expect(estimateTss([])).toBe(0);
  });
});

describe('targetAt / stepAt', () => {
  const steps = expand([
    { kind: 'steady', duration: 60, power: 0.6 },
    { kind: 'ramp', duration: 100, from: 0.5, to: 1.0 },
    { kind: 'free', duration: 30 },
  ]);

  it('returns the steady target, interpolates ramps, and null in free rides or past the end', () => {
    expect(targetAt(steps, 10)).toBeCloseTo(0.6, 9);
    expect(targetAt(steps, 60)).toBeCloseTo(0.5, 9);
    expect(targetAt(steps, 110)).toBeCloseTo(0.75, 9);
    expect(targetAt(steps, 170)).toBeNull();
    expect(targetAt(steps, 500)).toBeNull();
  });

  it('finds the step covering a time (end exclusive)', () => {
    expect(stepAt(steps, 59.9)?.label).toBe('Steady');
    expect(stepAt(steps, 60)?.label).toBe('Ramp up');
    expect(stepAt(steps, 190)).toBeUndefined();
  });
});

describe('estimateTss', () => {
  it('is 100 for an hour at FTP', () => {
    expect(estimateTss(expand([{ kind: 'steady', duration: 3600, power: 1 }]))).toBe(100);
  });
  it('scales with intensity squared and with time', () => {
    const hour75 = estimateTss(expand([{ kind: 'steady', duration: 3600, power: 0.75 }]));
    expect(hour75).toBeGreaterThanOrEqual(55);
    expect(hour75).toBeLessThanOrEqual(58);
    expect(estimateTss(expand([{ kind: 'steady', duration: 1800, power: 1 }]))).toBe(50);
  });
});

describe('built-in workouts', () => {
  it('have unique ids, are non-empty, and have sane durations and TSS', () => {
    const ids = BUILTIN_WORKOUTS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(RAMP_TEST_ID);
    for (const w of BUILTIN_WORKOUTS) {
      const steps = expand(w.blocks);
      const T = totalDuration(steps);
      expect(T, w.name).toBeGreaterThan(10 * 60);
      expect(T, w.name).toBeLessThan(3 * 3600);
      const tss = estimateTss(steps);
      expect(tss, w.name).toBeGreaterThan(5);
      expect(tss, w.name).toBeLessThan(200);
      for (const s of steps) {
        expect(s.start).toBeGreaterThanOrEqual(0);
        expect(s.end).toBeLessThanOrEqual(2);
      }
    }
  });

  it('the ramp test climbs 6% of FTP every minute', () => {
    const w = BUILTIN_WORKOUTS.find((x) => x.id === RAMP_TEST_ID)!;
    const steps = expand(w.blocks);
    expect(steps[1].duration).toBe(60);
    expect(steps[2].start - steps[1].start).toBeCloseTo(0.06, 6);
  });

  it('zone colours differ across the range', () => {
    expect(zoneColor(0.4)).not.toBe(zoneColor(1.3));
  });
});

describe('.zwo round trip', () => {
  const blocks: Block[] = [
    { kind: 'ramp', duration: 300, from: 0.4, to: 0.7 },
    { kind: 'steady', duration: 600, power: 0.85, cadence: 90 },
    { kind: 'intervals', repeats: 4, onDuration: 120, onPower: 1.1, offDuration: 60, offPower: 0.5 },
    { kind: 'free', duration: 120 },
  ];

  it('writes XML that parses back to the same blocks', () => {
    const xml = toZwo({ id: 'x', name: 'Test & "Quote"', description: 'A <b> test', blocks, source: 'custom' });
    expect(xml).toContain('<workout_file>');
    const w = parseWorkoutFile('test.zwo', xml, 250);
    expect(w.name).toBe('Test & "Quote"');
    expect(w.description).toBe('A <b> test');
    expect(w.source).toBe('uploaded');
    expect(w.blocks).toEqual(blocks);
    expect(totalDuration(expand(w.blocks))).toBe(totalDuration(expand(blocks)));
  });
});

describe('parseWorkoutFile', () => {
  it('reads a Zwift file with warmup, cooldown and unknown elements', () => {
    const xml = `<workout_file><name>Z</name><workout>
      <Warmup Duration="300" PowerLow="0.3" PowerHigh="0.6"/>
      <SteadyState Duration="120" Power="0.9"/>
      <textevent timeoffset="0" message="hi"/>
      <Cooldown Duration="200" PowerLow="0.6" PowerHigh="0.3"/>
    </workout></workout_file>`;
    const w = parseWorkoutFile('z.zwo', xml, 250);
    expect(w.blocks).toHaveLength(3);
    expect(w.blocks[0]).toMatchObject({ kind: 'ramp', from: 0.3, to: 0.6 });
    expect(w.blocks[2]).toMatchObject({ kind: 'ramp', from: 0.6, to: 0.3 });
  });

  it('rejects bad XML, a missing workout, and unsupported extensions', () => {
    expect(() => parseWorkoutFile('a.zwo', '<workout_file><oops></workout_file>', 250)).toThrow(/not valid XML/);
    expect(() => parseWorkoutFile('a.zwo', '<workout_file></workout_file>', 250)).toThrow(/No <workout>/);
    expect(() => parseWorkoutFile('a.zwo', '<workout_file><workout></workout></workout_file>', 250)).toThrow(/no workout steps/);
    expect(() => parseWorkoutFile('a.txt', '', 250)).toThrow(/Unsupported/);
  });

  it('reads an .mrc (percent) file into steady blocks and ramps', () => {
    const mrc = `[COURSE HEADER]
VERSION = 2
UNITS = ENGLISH
DESCRIPTION = Short one
FILE NAME = short.mrc
MINUTES PERCENT
[END COURSE HEADER]
[COURSE DATA]
0 50
5 50
5 100
10 100
10 50
15 100
[END COURSE DATA]`;
    const w = parseWorkoutFile('short.mrc', mrc, 250);
    expect(w.name).toBe('short');
    expect(w.description).toBe('Short one');
    expect(w.blocks).toEqual([
      { kind: 'steady', duration: 300, power: 0.5 },
      { kind: 'steady', duration: 300, power: 1 },
      { kind: 'ramp', duration: 300, from: 0.5, to: 1 },
    ]);
  });

  it('reads an .erg (watts) file relative to the FTP in the file, else the rider\'s', () => {
    const erg = `[COURSE HEADER]
FTP = 200
MINUTES WATTS
[END COURSE HEADER]
[COURSE DATA]
0 100
10 200
[END COURSE DATA]`;
    const w = parseWorkoutFile('r.erg', erg, 300);
    expect(w.blocks).toEqual([{ kind: 'ramp', duration: 600, from: 0.5, to: 1 }]);
    const noFtp = erg.replace('FTP = 200', 'X = 1');
    expect(parseWorkoutFile('r.erg', noFtp, 400).blocks[0]).toMatchObject({ from: 0.25, to: 0.5 });
    expect(() => parseWorkoutFile('e.erg', '[COURSE DATA]\n[END COURSE DATA]', 250)).toThrow(/No power data/);
  });
});
