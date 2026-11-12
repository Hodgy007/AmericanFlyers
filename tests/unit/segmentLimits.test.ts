// Checks the segment_limits rows in db/schema.sql against the app's own physics and its segment list, like
// stageLimits.test.ts does for whole stages: min_s is 80% of the time a 60 kg rider on an 8 kg bike (CdA 0.25) takes
// to ride the segment while holding a sustained 6.5 W/kg for the whole stage (the faster pass, on a circuit);
// max_avg_kmh is that limit as a speed, rounded up. Every segment of a built-in stage needs a row.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, stepSpeed } from '../../src/physics';
import { segmentsFor, type Segment } from '../../src/segments';
import { STAGES, type Stage } from '../../src/stages';

const PARAMS = { ...DEFAULT_PARAMS, massKg: 68, cda: 0.25 };
const POWER_W = 6.5 * 60;

/** The limits the schema comment describes. */
export function segmentLimitsFor(stage: Stage, seg: Segment) {
  const grade = (d: number) => (stage.elevationAt(d + 2) - stage.elevationAt(d - 2)) / 4;
  const marks: number[] = [];
  for (let k = 0; k < seg.passes; k++) marks.push(seg.start + k * (seg.lap ?? 0), seg.end + k * (seg.lap ?? 0));
  const times: number[] = [];
  let d = 0;
  let v = 0;
  let t = 0;
  while (d < stage.finish! && t < 4 * 3600) {
    const before = d;
    v = stepSpeed(v, POWER_W, grade(d), 1, PARAMS);
    d += v;
    t += 1;
    for (let i = 0; i < marks.length; i++) if (times[i] === undefined && d >= marks[i]) times[i] = t - 1 + (marks[i] - before) / (d - before);
  }
  let fastest = Infinity;
  for (let k = 0; k < seg.passes; k++) fastest = Math.min(fastest, times[2 * k + 1] - times[2 * k]);
  const lengthM = Math.round(seg.length);
  const minS = Math.round(0.8 * fastest);
  return { stageId: stage.id, lengthM, minS, maxAvgKmh: Math.ceil((lengthM / minS) * 3.6) };
}

const sql = readFileSync('db/schema.sql', 'utf8').replace(/\r\n/g, '\n');
function rows(table: string): string[][] {
  const start = sql.indexOf(`insert into public.${table}`);
  const block = sql.slice(start, sql.indexOf(';', start));
  return [...block.matchAll(/\(('[^)]*)\)/g)].map((m) => m[1].split(/,\s*(?=(?:[^']*'[^']*')*[^']*$)/).map((v) => v.trim().replace(/^'|'$/g, '').replace(/''/g, "'")));
}

describe('segment_limits', () => {
  const limits = new Map(rows('segment_limits').map(([id, stage, len, min, kmh]) => [id, { stageId: stage, lengthM: +len, minS: +min, maxAvgKmh: +kmh }]));
  // A world's routes share segment ids (`<world id>:<slug>`): one row each, worked out on the first route that has the segment.
  const seen = new Set<string>();
  const all = STAGES.flatMap((s) => segmentsFor(s).map((seg) => ({ stage: s, seg }))).filter(({ seg }) => (seen.has(seg.id) ? false : (seen.add(seg.id), true)));

  it('has a row for every segment of every built-in stage, and nothing else', () => {
    expect([...limits.keys()].sort()).toEqual(all.map((x) => x.seg.id).sort());
  });

  it('holds exactly the numbers the physics gives', () => {
    for (const { stage, seg } of all) expect(limits.get(seg.id), seg.id).toEqual(segmentLimitsFor(stage, seg));
  });

  it('puts the floor under every honest effort: a 5 W/kg climber is well clear of it', () => {
    for (const { stage, seg } of all) {
      const l = limits.get(seg.id)!;
      const slower = segmentLimitsFor(stage, seg).minS / 0.8; // the 6.5 W/kg time
      expect(l.minS, seg.id).toBeLessThan(slower * 0.85);
      expect(l.lengthM / l.minS * 3.6, seg.id).toBeLessThanOrEqual(l.maxAvgKmh);
    }
  });

  it('is applied by segment_effort_is_plausible() and segment_leaderboard() in the schema', () => {
    expect(sql).toMatch(/create or replace function public\.segment_effort_is_plausible\(p_segment text, p_elapsed_s real, p_avg_power real, p_demo boolean\)/);
    expect(sql).toMatch(/p_elapsed_s < l\.min_s/);
    expect(sql).toMatch(/segment_effort_is_plausible\(e\.segment_id, e\.elapsed_s, e\.avg_power, e\.demo\)/);
    expect(sql).toMatch(/revoke all on public\.segment_efforts from public, anonymous, authenticated;\ngrant select, insert, delete on public\.segment_efforts to authenticated;/);
    expect(sql).toMatch(/delete from public\.segment_efforts where user_id = me;/); // delete_my_account()
  });
});
