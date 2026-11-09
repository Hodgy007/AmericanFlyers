// Checks the stage_limits and event_stage_pool rows in db/schema.sql against the app's own physics and
// stage list: min_finish_s is 80% of the time a 60 kg rider on an 8 kg bike (CdA 0.25) takes at a sustained
// 6.5 W/kg, and max_avg_kmh is that limit as a speed, rounded up. Every stage with a finish line needs a row.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stageSeconds } from '../../src/garage/effects';
import { DEFAULT_PARAMS } from '../../src/physics';
import { EVENT_STAGE_POOL } from '../../src/schedule';
import { STAGES } from '../../src/stages';

const PARAMS = { ...DEFAULT_PARAMS, massKg: 68, cda: 0.25 };
const POWER_W = 6.5 * 60;
const FINISH_STAGES = STAGES.filter((s) => s.finish !== null);

/** The limits the schema comment describes, worked out through the app's physics. */
export function limitsFor(stage: (typeof STAGES)[number]) {
  const distanceM = Math.round(stage.finish!);
  const minFinishS = Math.round(0.8 * stageSeconds(stage, POWER_W, PARAMS));
  return { distanceM, minFinishS, maxAvgKmh: Math.ceil((distanceM / minFinishS) * 3.6) };
}

const sql = readFileSync('db/schema.sql', 'utf8');
/** The tuples of one `insert into <table>` statement. */
function rows(table: string): string[][] {
  const start = sql.indexOf(`insert into public.${table}`);
  const block = sql.slice(start, sql.indexOf(';', start));
  return [...block.matchAll(/\(('[^)]*)\)/g)].map((m) => m[1].split(/,\s*(?=(?:[^']*'[^']*')*[^']*$)/).map((v) => v.trim().replace(/^'|'$/g, '').replace(/''/g, "'")));
}

describe('stage_limits', () => {
  const limits = new Map(rows('stage_limits').map(([id, d, s, k]) => [id, { distanceM: +d, minFinishS: +s, maxAvgKmh: +k }]));

  it('has a row for every stage with a finish line, at the finish distance', () => {
    for (const s of FINISH_STAGES) expect(limits.get(s.id)?.distanceM, s.id).toBe(Math.round(s.finish!));
  });

  it('holds exactly the computed numbers for the American climbs, the circuits and the coast road', () => {
    for (const id of ['mt-washington', 'mt-blue-sky', 'mt-diablo', 'flagstaff', 'richmond-worlds', 'central-park', 'harrogate-worlds', 'pacific-coast']) {
      expect(limits.get(id), id).toEqual(limitsFor(FINISH_STAGES.find((s) => s.id === id)!));
    }
  });

  it('never sets an older stage’s floor above the computed one, and keeps it within 5% of it', () => {
    // The older rows were worked out before the climbs followed real roads, so they sit a little low:
    // slightly permissive, never rejecting a ride the physics allows.
    for (const s of FINISH_STAGES) {
      const have = limits.get(s.id)!;
      const want = limitsFor(s);
      expect(have.minFinishS, s.id).toBeLessThanOrEqual(want.minFinishS);
      expect(have.minFinishS / want.minFinishS, s.id).toBeGreaterThan(0.95);
    }
  });
});

describe('event_stage_pool', () => {
  it('matches the schedule’s pool: ids, names, lengths and positions', () => {
    const pool = rows('event_stage_pool').map(([id, name, len, pos]) => ({ id, name, lengthM: +len, pos: +pos }));
    expect(pool.sort((a, b) => a.pos - b.pos)).toEqual(EVENT_STAGE_POOL.map((p, i) => ({ id: p.id, name: p.name, lengthM: p.lengthM, pos: i })));
  });
});
