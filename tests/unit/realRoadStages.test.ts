// The four real-road stages (Richmond and Harrogate Worlds circuits, Central Park, Pacific Coast Highway): length, laps,
// closing circuits, gain, race points, crowd culture, limits and lists.
import { describe, expect, it } from 'vitest';
import { achievements } from '../../src/cloud/achievements';
import type { Activity } from '../../src/cloud/sync';
import { EVENT_STAGE_POOL } from '../../src/schedule';
import { stageById } from '../../src/stages';
import { cultureOf } from '../../src/world/crowdCulture';
import { STAGE_WINDS } from '../../src/world/wind';

/** id, laps, lap (or whole stage) length range (m), whole-lap gain range (m). */
const CIRCUITS: [string, number, [number, number]][] = [
  ['richmond-worlds', 2, [15500, 16800]],
  ['central-park', 3, [9400, 10200]],
  ['harrogate-worlds', 2, [13500, 14500]],
];
const ids = [...CIRCUITS.map((c) => c[0]), 'pacific-coast'];

function position(id: string, upTo: number): [number, number] {
  const s = stageById(id);
  let x = 0, z = 0;
  const step = 2;
  for (let d = 0; d < upTo; d += step) {
    const h = s.headingAt(d + step / 2);
    x += Math.cos(h) * step;
    z += Math.sin(h) * step;
  }
  return [x, z];
}

describe('circuits', () => {
  for (const [id, laps, [lo, hi]] of CIRCUITS) {
    const s = stageById(id);
    const lap = s.lapLength!;
    it(`${id}: ${laps} laps of ${lo}-${hi} m, finishing on a whole lap`, () => {
      expect(s.id).toBe(id);
      expect(lap).toBeGreaterThan(lo);
      expect(lap).toBeLessThan(hi);
      expect(s.finish).toBeCloseTo(lap * laps, 6);
    });
    it(`${id}: closes, heading and elevation, and every lap repeats`, () => {
      const [x, z] = position(id, lap);
      expect(Math.hypot(x, z)).toBeLessThan(15);
      const turn = s.headingAt(lap) - s.headingAt(0);
      expect(Math.abs(turn / (2 * Math.PI) - Math.round(turn / (2 * Math.PI)))).toBeLessThan(0.01);
      expect(s.headingAt(lap + 2500) - s.headingAt(2500)).toBeCloseTo(turn, 6);
      expect(s.elevationAt(lap)).toBeCloseTo(s.elevationAt(0), 1);
      expect(s.elevationAt(lap + 3000)).toBeCloseTo(s.elevationAt(3000), 6);
    });
    it(`${id}: has a sane lap gain, and race points inside the course`, () => {
      let gain = 0;
      for (let d = 0; d < lap; d += 10) gain += Math.max(0, s.elevationAt(d + 10) - s.elevationAt(d));
      expect(gain).toBeGreaterThan(40);
      expect(gain).toBeLessThan(400);
      for (const p of s.race?.sprints ?? []) { expect(p.d).toBeGreaterThan(0); expect(p.d).toBeLessThanOrEqual(s.finish!); }
      for (const p of s.race?.summits ?? []) { expect(p.d).toBeGreaterThan(0); expect(p.d).toBeLessThan(s.finish!); }
      expect(s.race?.sprints?.length).toBeGreaterThan(0);
    });
  }

  it('puts the Richmond KOMs at the tops of Libby Hill and 23rd Street, every lap, on climbs', () => {
    const s = stageById('richmond-worlds');
    const lap = s.lapLength!;
    const summits = s.race!.summits!;
    expect(summits.map((k) => k.name).sort()).toEqual(['23rd Street', '23rd Street', 'Libby Hill', 'Libby Hill']);
    for (const k of summits) {
      // 23rd Street is short and steep, Libby Hill longer and steadier: climbed over the last 300 m or the last 800 m.
      const rise = Math.max(s.elevationAt(k.d) - s.elevationAt(k.d - 300), s.elevationAt(k.d) - s.elevationAt(k.d - 800));
      expect(rise, k.name).toBeGreaterThan(8);
      expect(s.elevationAt(k.d + 100) - s.elevationAt(k.d), k.name).toBeLessThan(1);
    }
    expect(summits.some((k) => k.d > lap)).toBe(true);
    expect(s.landmarks.some((k) => k.model === 'virginia-capitol')).toBe(true);
  });

  it('gives Central Park the Manhattan skyline, Harrogate its dry-stone walls', () => {
    expect(stageById('central-park').landmarks.some((k) => k.model === 'manhattan-skyline')).toBe(true);
    const walls = stageById('harrogate-worlds').scenery.walls!;
    const lap = stageById('harrogate-worlds').lapLength!;
    expect(walls(5000)).toBe(true);
    expect(walls(lap + 5000)).toBe(true);
    expect(walls(300)).toBe(false);
  });
});

describe('Pacific Coast Highway', () => {
  const s = stageById('pacific-coast');
  it('is a 39 km point-to-point with the sea on the right, a bridge and Hurricane Point', () => {
    expect(s.lapLength).toBeUndefined();
    expect(s.finish).toBeGreaterThan(38000);
    expect(s.finish).toBeLessThan(40500);
    expect(s.scenery.water?.[0]?.kind).toBe('sea');
    expect(s.landmarks.some((k) => k.model === 'bixby-bridge')).toBe(true);
    let lo = Infinity, hi = -Infinity;
    for (let d = 0; d <= s.finish!; d += 20) { const e = s.baseAltitude! + s.elevationAt(d); lo = Math.min(lo, e); hi = Math.max(hi, e); }
    expect(lo).toBeGreaterThan(-5);
    expect(hi).toBeLessThan(260);
    expect(hi - lo).toBeGreaterThan(80);
    for (const p of [...(s.race?.sprints ?? []), ...(s.race?.summits ?? [])]) expect(p.d).toBeLessThan(s.finish!);
  });
});

describe('all four', () => {
  it('have a culture: American, and Yorkshire for Harrogate', () => {
    for (const id of ['richmond-worlds', 'central-park', 'pacific-coast']) expect(cultureOf(stageById(id)), id).toBe('us');
    expect(cultureOf(stageById('harrogate-worlds'))).toBe('gb');
  });
  it('have winds, finish badges and a place in the evening race rotation', () => {
    const ride = (stage: string) => ({ started_at: '2026-06-01T10:00:00Z', stage_id: stage, finished: true, duration_s: 1800, distance_m: 1000, climbed_m: 10 }) as unknown as Activity;
    const pool = EVENT_STAGE_POOL.map((p) => p.id);
    const names: Record<string, string> = { 'richmond-worlds': 'Richmond Worlds', 'central-park': 'Central Park', 'harrogate-worlds': 'Harrogate Worlds', 'pacific-coast': 'Pacific Coast' };
    for (const id of ids) {
      expect(STAGE_WINDS[id], id).toBeDefined();
      expect(pool, id).toContain(id);
      expect(EVENT_STAGE_POOL.find((p) => p.id === id)!.lengthM).toBe(Math.round(stageById(id).finish!));
      expect(achievements([ride(id)], [], 70).filter((a) => a.done).map((a) => a.name), id).toContain(names[id]);
    }
  });
});
