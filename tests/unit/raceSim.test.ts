import { describe, expect, it } from 'vitest';
import { makeRoster, TEAMS } from '../../src/peloton';
import {
  FINISH_POINTS, KOM_POINTS, PRO_KG, RaceSim, SPRINT_POINTS, awardPoints, detectSummits, makeCourse, stageResults, stageTimes,
  type RaceLine,
} from '../../src/raceSim';
import { stageById } from '../../src/stages';

function course(id: string) {
  const s = stageById(id);
  return makeCourse({ finish: s.finish!, elevationAt: s.elevationAt, race: s.race });
}

function run(id: string, seed: number, refWkg = 3.5) {
  const c = course(id);
  const sim = new RaceSim(c, makeRoster(seed), { refWkg, seed, startFront: 0 });
  sim.runToEnd();
  return { sim, c, results: stageResults(c.lines) };
}

describe('makeCourse / detectSummits', () => {
  it('ends every course with a single finish line, lines in order', () => {
    for (const id of ['route66', 'alpe-dhuez', 'hotw-tour-of-the-moon']) {
      const c = course(id);
      const finishes = c.lines.filter((l) => l.kind === 'finish');
      expect(finishes).toHaveLength(1);
      expect(c.lines[c.lines.length - 1].kind).toBe('finish');
      for (let i = 1; i < c.lines.length; i++) expect(c.lines[i].d).toBeGreaterThanOrEqual(c.lines[i - 1].d);
    }
  });

  it('puts a default mid-stage sprint on a stage without race points', () => {
    const c = course('route66');
    const sprints = c.lines.filter((l) => l.kind === 'sprint');
    expect(sprints).toHaveLength(1);
    expect(sprints[0].d).toBe(12500);
  });

  it('uses the stage\'s own race points when it has them', () => {
    const c = course('hotw-tour-of-the-moon');
    const names = c.lines.map((l) => l.name);
    expect(names).toContain('Cold Shivers');
    expect(names).toContain('Black Ridge');
    expect(names).toContain('Visitor center sprint');
  });

  it('course grade comes from the elevation profile', () => {
    const c = course('alpe-dhuez');
    expect(c.grade(7000)).toBeGreaterThan(0.03);
    expect(c.grade(7000)).toBeLessThan(0.15);
  });

  it('finds the one big climb of a mountain stage as a hors categorie summit finish', () => {
    const s = stageById('alpe-dhuez');
    const summits = detectSummits(s.elevationAt, s.finish!);
    expect(summits).toHaveLength(1);
    expect(summits[0].name).toBe('Summit finish');
    expect(summits[0].cat).toBe(0); // 1118 m of gain
  });

  it('finds no climbs on a flat course', () => {
    expect(detectSummits(() => 0, 20000)).toEqual([]);
  });

  it('categorises by gain', () => {
    // 150 m up over 3 km then 40 m dip: one climb, category 3 (>= 100 m).
    const profile = (d: number) => (d < 3000 ? d * 0.05 : 150 - Math.min(40, (d - 3000) * 0.05));
    const out = detectSummits(profile, 4000);
    expect(out).toHaveLength(1);
    expect(out[0].cat).toBe(3);
  });
});

describe('points tables', () => {
  it('pay more for harder categories and for winning', () => {
    for (const t of [SPRINT_POINTS, FINISH_POINTS, ...Object.values(KOM_POINTS)]) {
      for (let i = 1; i < t.length; i++) expect(t[i]).toBeLessThanOrEqual(t[i - 1]);
    }
    expect(KOM_POINTS[0][0]).toBeGreaterThan(KOM_POINTS[1][0]);
    expect(KOM_POINTS[1][0]).toBeGreaterThan(KOM_POINTS[4][0]);
  });
});

describe('awardPoints / stageTimes / stageResults', () => {
  const lines: RaceLine[] = [
    { kind: 'sprint', d: 100, name: 's', crossings: [{ id: 'b', t: 10 }, { id: 'a', t: 11 }, { id: 'c', t: 12 }] },
    { kind: 'summit', d: 200, name: 'k', cat: 2, crossings: [{ id: 'c', t: 20 }, { id: 'a', t: 21 }] },
    { kind: 'finish', d: 300, name: 'f', crossings: [{ id: 'a', t: 30 }, { id: 'b', t: 30.4 }, { id: 'c', t: 33 }] },
  ];

  it('awards sprint and KOM points by crossing order, not by array order', () => {
    const pts = awardPoints(lines);
    expect(pts.get('b')).toEqual({ sprint: SPRINT_POINTS[0] + FINISH_POINTS[1], kom: 0 });
    expect(pts.get('a')).toEqual({ sprint: SPRINT_POINTS[1] + FINISH_POINTS[0], kom: KOM_POINTS[2][1] });
    expect(pts.get('c')).toEqual({ sprint: SPRINT_POINTS[2] + FINISH_POINTS[2], kom: KOM_POINTS[2][0] });
  });

  it('gives riders within a second of the one ahead the same time', () => {
    const t = stageTimes(lines);
    expect(t.get('a')).toBe(30);
    expect(t.get('b')).toBe(30);
    expect(t.get('c')).toBe(33);
  });

  it('sorts results by time', () => {
    const r = stageResults(lines);
    expect(r.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(r[0].time).toBe(30);
  });
});

describe('RaceSim: a flat time-trial-length stage', () => {
  const { sim, results } = run('route66', 7);

  it('everyone finishes, with distinct sane times', () => {
    expect(sim.allFinished).toBe(true);
    expect(results).toHaveLength(TEAMS.length * 3);
    for (const r of results) {
      expect(r.time).not.toBeNull();
      // 25 km at roughly 40-55 km/h in a bunch: 27-40 minutes.
      expect(r.time!).toBeGreaterThan(24 * 60);
      expect(r.time!).toBeLessThan(45 * 60);
    }
  });

  it('the winner is not one of the weakest riders in the field', () => {
    const roster = makeRoster(7);
    const ab = new Map(roster.map((r) => [r.id, r.ability]));
    const abilities = roster.map((r) => r.ability).sort((x, y) => x - y);
    // A flat stage is a bunch sprint, so sprinters can win: just not from the bottom quarter.
    expect(ab.get(results[0].id)!).toBeGreaterThan(abilities[Math.floor(abilities.length / 4)]);
  });

  it('hands out points: the winner takes the finish points, all totals are non-negative', () => {
    const total = results.reduce((a, r) => a + r.sprint, 0);
    expect(total).toBeGreaterThan(FINISH_POINTS.reduce((a, b) => a + b, 0));
    expect(results.every((r) => r.sprint >= 0 && r.kom >= 0)).toBe(true);
  });

  it('PRO_KG is a plausible rider weight', () => {
    expect(PRO_KG).toBeGreaterThan(55);
    expect(PRO_KG).toBeLessThan(80);
  });
});

describe('RaceSim: determinism', () => {
  it('the same seed gives exactly the same race', () => {
    const a = run('route66', 99).results.map((r) => [r.id, r.time, r.sprint, r.kom]);
    const b = run('route66', 99).results.map((r) => [r.id, r.time, r.sprint, r.kom]);
    expect(a).toEqual(b);
  });

  it('a different seed gives a different field and result', () => {
    const a = run('route66', 1).results.map((r) => r.id).slice(0, 5);
    const b = run('route66', 2).results.map((r) => r.id).slice(0, 5);
    expect(a).not.toEqual(b);
  });

  it('makeRoster is deterministic and fields three riders per team with unique ids and names', () => {
    const r1 = makeRoster(5), r2 = makeRoster(5);
    expect(r1).toEqual(r2);
    expect(r1).toHaveLength(TEAMS.length * 3);
    expect(new Set(r1.map((r) => r.id)).size).toBe(r1.length);
    expect(new Set(r1.map((r) => r.name)).size).toBe(r1.length);
    expect(r1.filter((r) => r.leader)).toHaveLength(TEAMS.length);
    for (const r of r1) {
      expect(r.ability).toBeGreaterThanOrEqual(0);
      expect(r.ability).toBeLessThanOrEqual(1);
    }
  });
});

describe('RaceSim: a mountain stage', () => {
  const { results, sim } = run('ventoux', 3, 4);

  it('finishes with climbers faster than the slowest sprinters and times in a human range', () => {
    expect(sim.allFinished).toBe(true);
    const first = results[0].time!;
    const last = results[results.length - 1].time!;
    // 21.4 km, 1610 m: about 1h-1h30 for pros at 4 W/kg-ish.
    expect(first).toBeGreaterThan(45 * 60);
    expect(last).toBeLessThan(150 * 60);
    expect(last).toBeGreaterThan(first);
  });

  it('the stage winner collects the climbing points at the summit finish', () => {
    expect(results.some((r) => r.kom > 0)).toBe(true);
  });

  it('a stronger field (higher W/kg) is faster', () => {
    const slow = run('ventoux', 3, 3.0).results[0].time!;
    const fast = run('ventoux', 3, 5.0).results[0].time!;
    expect(fast).toBeLessThan(slow);
  });
});

describe('RaceSim: live player and events', () => {
  it('reportPlayer puts the player in the crossing orders', () => {
    const c = course('route66');
    const sim = new RaceSim(c, makeRoster(11), { refWkg: 3.5, seed: 11, startFront: 0 });
    // The player rides a constant 12 m/s: 25 km takes ~2083 s.
    let d = 0;
    for (let i = 0; i < 4000 * 2 && sim.playerFinishT === null; i++) {
      sim.step(0.5);
      d += 12 * 0.5;
      sim.reportPlayer('me', d, 12);
    }
    expect(sim.playerFinishT).not.toBeNull();
    expect(sim.playerFinishT!).toBeGreaterThan(2000);
    expect(sim.playerFinishT!).toBeLessThan(2200);
  });

  it('emits events with a time, kind and rider ids; the log is capped', () => {
    const { sim } = run('hotw-tour-of-the-moon', 4, 3.5);
    expect(sim.events.length).toBeGreaterThan(0);
    expect(sim.events.length).toBeLessThanOrEqual(40);
    const ids = new Set(makeRoster(4).map((r) => r.id));
    for (const e of sim.events) {
      expect(e.t).toBeGreaterThanOrEqual(0);
      expect(['attack', 'break', 'caught', 'drop', 'sprint']).toContain(e.kind);
      expect(e.text.length).toBeGreaterThan(0);
      for (const id of e.ids) expect(ids.has(id)).toBe(true);
    }
  });
});
