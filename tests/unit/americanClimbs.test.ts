// The four American climbs (Mount Washington, Mount Blue Sky, Mount Diablo, Flagstaff): their published
// figures against the baked roads, their landmarks, wind, finish badges and how they are scheduled.
import { describe, expect, it } from 'vitest';
import { achievements } from '../../src/cloud/achievements';
import type { Activity } from '../../src/cloud/sync';
import flagstaffData from '../../src/routes/real/flagstaff';
import blueSkyData from '../../src/routes/real/mt-blue-sky';
import diabloData from '../../src/routes/real/mt-diablo';
import washingtonData from '../../src/routes/real/mt-washington';
import { EVENT_STAGE_POOL } from '../../src/schedule';
import { stageById } from '../../src/stages';
import { STAGE_WINDS } from '../../src/world/wind';

/** id, published length (m), gain (m), start altitude (m), summit altitude (m), the baked road's own length (m). */
const CLIMBS: [string, number, number, number, number, number][] = [
  ['mt-washington', 12200, 1417, 499, 1917, washingtonData.length],
  ['mt-blue-sky', 23300, 1080, 3231, 4311, blueSkyData.length],
  ['mt-diablo', 18000, 990, 183, 1173, diabloData.length],
  ['flagstaff', 7400, 602, 1746, 2348, flagstaffData.length],
];

describe('American climbs', () => {
  for (const [id, length, gain, start, summit, real] of CLIMBS) {
    it(`${id}: ${length} m, ${gain} m of climbing, ${start} → ${summit} m, on a baked road within 3% of its length`, () => {
      const s = stageById(id);
      expect(s.id).toBe(id);
      expect(s.finish).toBe(length);
      expect(s.elevationAt(length)).toBeCloseTo(gain, 3);
      expect(s.baseAltitude! + gain).toBeCloseTo(summit, -1);
      expect(s.baseAltitude).toBe(start);
      expect(Math.abs(real / length - 1)).toBeLessThan(0.03);
    });
  }

  it('keeps Mount Washington’s steepest pitch near the published 22% and no further', () => {
    const s = stageById('mt-washington');
    let worst = 0;
    for (let d = 0; d < 12200; d += 10) worst = Math.max(worst, (s.elevationAt(d + 10) - s.elevationAt(d)) / 10);
    expect(worst).toBeGreaterThan(0.18);
    expect(worst).toBeLessThanOrEqual(0.22 + 1e-9);
    expect(s.weather).toBe('cloudy');
  });

  it('puts the right monument at each summit, with the words on the board', () => {
    const models = (id: string) => stageById(id).landmarks.filter((k) => k.model);
    const sign = (id: string) => models(id).find((k) => k.model === 'summit-sign-us')!;
    expect(models('mt-washington').some((k) => k.model === 'washington-summit' && k.first > 12100)).toBe(true);
    expect(sign('mt-washington').options?.lines).toEqual(['MOUNT WASHINGTON', 'ELEV. 6,288 FT']);
    expect(sign('mt-blue-sky').options?.lines).toEqual(['MOUNT BLUE SKY', '14,130 FT']);
    expect(models('mt-blue-sky').some((k) => k.model === 'crest-house-ruins' && k.first > 22900)).toBe(true);
    const lodge = models('mt-blue-sky').find((k) => k.model === 'log-lodge')!;
    expect(lodge.first).toBeLessThan(200); // Echo Lake Lodge is at the start, where the Hell of the West stops
    expect(models('mt-diablo').some((k) => k.model === 'diablo-summit' && k.first >= 17900)).toBe(true);
    expect(sign('mt-diablo').options?.lines?.[0]).toBe('MOUNT DIABLO');
    expect(sign('flagstaff').options?.lines?.[0]).toBe('FLAGSTAFF MOUNTAIN');
    for (const [id] of CLIMBS) expect(sign(id).first, id).toBeGreaterThan(stageById(id).finish! - 100);
  });

  it('shows the Flatirons from the lower switchbacks of Flagstaff, on the left', () => {
    const s = stageById('flagstaff');
    const flat = s.landmarks.find((k) => k.model === 'flatirons')!;
    expect(flat.side).toBe(-1);
    expect(flat.first).toBeLessThan(3000);
    expect(flat.reach ?? 0, 'placed from the start line on').toBeGreaterThanOrEqual(flat.first);
    expect(flat.offset).toBeLessThan(2500);
  });

  it('gives Mount Diablo golden grass, and the others none', () => {
    expect(stageById('mt-diablo').scenery.dryGrass).toBe(1);
    for (const id of ['mt-washington', 'mt-blue-sky', 'flagstaff']) expect(stageById(id).scenery.dryGrass, id).toBeUndefined();
  });

  it('puts Blue Sky’s tree line where the real one is (about 3,500 m) and snow only near the top', () => {
    const s = stageById('mt-blue-sky');
    expect(s.baseAltitude! + s.scenery.treeLine).toBeGreaterThan(3400);
    expect(s.baseAltitude! + s.scenery.treeLine).toBeLessThan(3600);
    expect(s.baseAltitude! + s.scenery.snowLine).toBeGreaterThan(4200);
  });

  it('blows hardest on Mount Washington', () => {
    const ms = (id: string) => STAGE_WINDS[id].ms;
    for (const [id] of CLIMBS) expect(STAGE_WINDS[id], id).toBeDefined();
    expect(ms('mt-washington')).toBeGreaterThan(ms('ventoux'));
  });

  it('has a finish badge for each', () => {
    const ride = (stage: string) => ({ started_at: '2026-06-01T10:00:00Z', stage_id: stage, finished: true, duration_s: 1800, distance_m: 1000, climbed_m: 10 }) as unknown as Activity;
    const earned = (stage: string) => achievements([ride(stage)], [], 70).filter((a) => a.done).map((a) => a.name);
    expect(earned('mt-washington')).toContain('Mount Washington');
    expect(earned('mt-blue-sky')).toContain('Mount Blue Sky');
    expect(earned('mt-diablo')).toContain('Mount Diablo');
    expect(earned('flagstaff')).toContain('Flagstaff');
    expect(earned('zoncolan')).not.toContain('Flagstaff');
  });

  it('are in the evening race rotation, after the older stages', () => {
    const ids = EVENT_STAGE_POOL.map((p) => p.id);
    for (const [id, length] of CLIMBS.map((c) => [c[0], c[1]] as const)) {
      expect(ids, id).toContain(id);
      expect(EVENT_STAGE_POOL.find((p) => p.id === id)!.lengthM).toBe(length);
    }
  });
});
