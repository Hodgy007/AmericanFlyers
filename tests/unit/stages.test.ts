import { describe, expect, it } from 'vitest';
import { STAGES, stageById } from '../../src/stages';
import { TOUR_STAGE_IDS } from '../../src/tour';

/** Published figures the mountain climbs are built from: [id, length m, total gain m]. */
const CLIMBS: [string, number, number][] = [
  ['alpe-dhuez', 14000, 1118],
  ['stelvio', 24500, 1843],
  ['hell-of-the-west', 20800, 942],
  ['ventoux', 21400, 1610],
  ['tourmalet', 19000, 1404],
  ['zoncolan', 10100, 1210],
];

describe('stage list', () => {
  it('has unique ids and every stage has the basics', () => {
    const ids = STAGES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of STAGES) {
      expect(s.name.length).toBeGreaterThan(2);
      expect(typeof s.elevationAt(100)).toBe('number');
      expect(Number.isFinite(s.headingAt(100))).toBe(true);
      expect(s.landmarks.length).toBeGreaterThan(0);
    }
  });

  it('stageById falls back to Heartland for unknown or null ids', () => {
    expect(stageById(null).id).toBe('heartland');
    expect(stageById('nope').id).toBe('heartland');
    expect(stageById('stelvio').id).toBe('stelvio');
  });

  it('starts every stage at elevation 0 and keeps elevation continuous', () => {
    for (const s of STAGES) {
      expect(s.elevationAt(0)).toBeCloseTo(0, 6);
      const end = s.finish ?? 20000;
      let prev = s.elevationAt(0);
      for (let d = 10; d <= end; d += 10) {
        const e = s.elevationAt(d);
        expect(Math.abs(e - prev), `${s.id} at ${d} m`).toBeLessThan(5); // < 50% grade per 10 m
        prev = e;
      }
    }
  });
});

describe('mountain climbs', () => {
  for (const [id, length, gain] of CLIMBS) {
    it(`${id}: finishes at ${length} m and gains ${gain} m`, () => {
      const s = stageById(id);
      expect(s.id).toBe(id);
      expect(s.finish).toBe(length);
      expect(s.elevationAt(length)).toBeCloseTo(gain, 3);
      // Mostly uphill all the way: never lower than the start, average grade matches.
      expect(s.elevationAt(length / 2)).toBeGreaterThan(0);
      expect(s.elevationAt(length / 2)).toBeLessThan(gain);
      const avg = gain / length;
      expect(avg).toBeGreaterThan(0.04);
      expect(avg).toBeLessThan(0.12);
    });

    it(`${id}: climbs monotonically and the grade stays physical`, () => {
      const s = stageById(id);
      let prev = 0;
      for (let d = 0; d <= length; d += 25) {
        const e = s.elevationAt(d);
        expect(e).toBeGreaterThanOrEqual(prev - 1e-6);
        prev = e;
      }
      for (let d = 50; d < length - 50; d += 50) {
        const g = (s.elevationAt(d + 2) - s.elevationAt(d - 2)) / 4;
        expect(g, `${id} at ${d} m`).toBeLessThan(0.25);
      }
    });
  }

  it('numbered hairpin signs count down to 1 at the top', () => {
    const s = stageById('alpe-dhuez');
    expect(s.signs).toHaveLength(21);
    expect(s.signs[0].label).toBe('21');
    expect(s.signs[s.signs.length - 1].label).toBe('1');
    for (let i = 1; i < s.signs.length; i++) expect(s.signs[i].d).toBeGreaterThan(s.signs[i - 1].d);
  });
});

describe('flat stages', () => {
  it('Heartland is endless and rolling', () => {
    const s = stageById('heartland');
    expect(s.finish).toBeNull();
    const es = Array.from({ length: 200 }, (_, i) => s.elevationAt(i * 50));
    expect(Math.max(...es) - Math.min(...es)).toBeGreaterThan(20);
    expect(Math.max(...es) - Math.min(...es)).toBeLessThan(120);
  });

  it('Route 66 is a flat 25 km time trial', () => {
    const s = stageById('route66');
    expect(s.finish).toBe(25000);
    const es = Array.from({ length: 501 }, (_, i) => s.elevationAt(i * 50));
    expect(Math.max(...es) - Math.min(...es)).toBeLessThan(30);
  });
});

describe('Hell of the West tour stages', () => {
  it('lists three stages that exist, in order, with tour stage numbers', () => {
    expect(TOUR_STAGE_IDS).toHaveLength(3);
    TOUR_STAGE_IDS.forEach((id, i) => {
      const s = stageById(id);
      expect(s.id).toBe(id);
      expect(s.finish).toBeGreaterThan(10000);
      expect(s.tourStage).toBe(i + 1);
      expect(s.race).toBeDefined();
    });
  });

  it('race points sit inside each stage', () => {
    for (const id of TOUR_STAGE_IDS) {
      const s = stageById(id);
      for (const sp of s.race?.sprints ?? []) {
        expect(sp.d).toBeGreaterThan(0);
        expect(sp.d).toBeLessThanOrEqual(s.finish!);
      }
      for (const su of s.race?.summits ?? []) {
        expect(su.d).toBeGreaterThan(0);
        expect(su.d).toBeLessThanOrEqual(s.finish!); // a summit finish (the Wall) sits on the line
        expect([0, 1, 2, 3, 4]).toContain(su.cat);
      }
    }
  });

  it('Morgul-Bismark is two laps of the loop (about 42 km); Tour of the Moon is 37 km', () => {
    expect(stageById('hotw-morgul-bismark').finish!).toBeGreaterThan(40000);
    expect(stageById('hotw-morgul-bismark').finish!).toBeLessThan(44000);
    expect(stageById('hotw-tour-of-the-moon').finish).toBe(37000);
  });

  it('the final stage keeps its original id (leaderboards and plans use it)', () => {
    expect(TOUR_STAGE_IDS[2]).toBe('hell-of-the-west');
  });
});
