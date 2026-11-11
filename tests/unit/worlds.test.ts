// Worlds and routes (src/worlds/): the Kestrel Vale loop closes, its lap length and climb are pinned (leaderboards, ghosts and
// segment times key on them), the road keeps clear of itself and of the lake, and the routes compile into ordinary stages.
import { describe, expect, it } from 'vitest';
import { STAGES, stageById } from '../../src/stages';
import { segmentsFor } from '../../src/segments';
import { pondDistance } from '../../src/world/waterTypes';
import { KESTREL_ROUTE_DEFS, KESTREL_ROUTES, KESTREL_VALE, KV, KV_LAKE, KV_LAP } from '../../src/worlds/kestrelVale';
import { closeLoop } from '../../src/worlds/types';

const e = KESTREL_VALE.elevationAt;

describe('closeLoop', () => {
  it('solves two straights so a loop of arcs lands on its start', () => {
    const l = closeLoop([
      { len: 900, turnDeg: 0 }, { len: 100, turnDeg: 90 }, { len: 900, turnDeg: 0 }, { len: 100, turnDeg: 90 },
      { len: 700, turnDeg: 0 }, { len: 100, turnDeg: 90 }, { len: 500, turnDeg: 0 }, { len: 100, turnDeg: 90 },
    ], 0, 2);
    expect(l.gap).toBeLessThan(1e-6);
    expect(l.turn).toBeCloseTo(-2 * Math.PI, 9);
  });
  it('refuses parallel slack straights', () => {
    expect(() => closeLoop([{ len: 100, turnDeg: 0 }, { len: 100, turnDeg: 0 }, { len: 100, turnDeg: 360 }], 0, 1)).toThrow();
  });
});

describe('the Kestrel Vale loop', () => {
  it('closes to within 1 m by the road the game integrates, and turns once (left)', () => {
    let x = 0, z = 0;
    const step = 2;
    for (let d = 0; d < KV_LAP; d += step) {
      const h = KESTREL_VALE.headingAt(Math.min(d + step / 2, KV_LAP - 1e-9));
      const s = Math.min(step, KV_LAP - d);
      x += Math.cos(h) * s;
      z += Math.sin(h) * s;
    }
    expect(Math.hypot(x, z)).toBeLessThan(1);
    expect(KESTREL_VALE.headingAt(KV_LAP) - KESTREL_VALE.headingAt(1e-6)).toBeCloseTo(-2 * Math.PI, 6); // heading falls 2π: left turns
    // The last 400 m run on the heading of km 0, so the straight road drawn behind the start lies on the real one.
    for (let d = KV_LAP - 400; d < KV_LAP; d += 20) expect(KESTREL_VALE.headingAt(d) - KESTREL_VALE.headingAt(1e-6) + 2 * Math.PI).toBeCloseTo(0, 9);
  });

  it('has a pinned lap length (frozen once shipped: a change needs new route ids or a leaderboard reset)', () => {
    expect(Math.round(KV_LAP)).toBe(15399);
    expect(KV_LAP).toBeCloseTo(15398.806, 2);
  });

  it('has a periodic, continuous elevation profile with grades inside ±12%', () => {
    expect(e(0)).toBeCloseTo(0, 9);
    expect(e(KV_LAP)).toBeCloseTo(0, 6);
    let prev = e(0);
    for (let d = 5; d <= KV_LAP + 200; d += 5) {
      const v = e(d);
      expect(Math.abs(v - prev), `${d} m`).toBeLessThan(0.7);
      prev = v;
      const g = (e(d + 2) - e(d - 2)) / 4;
      expect(Math.abs(g), `grade at ${d} m`).toBeLessThanOrEqual(0.12);
    }
    expect(e(KV_LAP + 1234)).toBeCloseTo(e(1234), 6);
  });

  it('has the climb its tagline promises: Raven Scar, 4.3 km, 275 m up, 6.4% on average, the steepest 300 m at 10%', () => {
    const a = KV.from('climb-foot'), b = KV.gap[0];
    expect(b - a).toBeCloseTo(4265, 0);
    expect(e(b) - e(a)).toBeCloseTo(275, 6);
    expect((e(b) - e(a)) / (b - a)).toBeCloseTo(0.0645, 3);
    let steepest = 0;
    for (let d = a; d + 300 <= b; d += 10) steepest = Math.max(steepest, (e(d + 300) - e(d)) / 300);
    expect(steepest).toBeGreaterThan(0.098);
    expect(steepest).toBeLessThan(0.105);
    expect(KV.hairpins).toHaveLength(5);
    const seg = segmentsFor(stageById('kestrel-vale-loop'))[0];
    expect(seg.id).toBe('kestrel-vale:raven-scar');
    expect(seg.length).toBeGreaterThan(4000);
    expect(KESTREL_VALE.race.summits).toEqual([{ d: KV.summit, name: 'Raven Scar', cat: 2 }]);
  });

  it('does not cross itself: road more than 300 m apart along the lap stays more than 40 m apart on the ground', () => {
    const t = KV.trace;
    const step = 10;
    const n = Math.floor(KV_LAP / step);
    let worst = Infinity;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const along = Math.min((j - i) * step, KV_LAP - (j - i) * step);
        if (along < 300) continue;
        worst = Math.min(worst, Math.hypot(t[i][0] - t[j][0], t[i][1] - t[j][1]));
      }
    }
    expect(worst).toBeGreaterThan(40);
  });

  it('keeps the road at least 15 m from the water and puts the ground under the lake below its level', () => {
    for (const [x, z] of KV.trace) expect(pondDistance(KV_LAKE, x, z)).toBeGreaterThanOrEqual(15);
    const sc = KESTREL_VALE.scenery;
    let inside = 0;
    for (let a = 0; a < 360; a += 15) {
      for (const f of [0, 0.3, 0.6, 0.85]) {
        const x = KV_LAKE.x + Math.cos(a) * f * KV_LAKE.rx * Math.cos(KV_LAKE.rot) + Math.sin(a) * f * KV_LAKE.rz * Math.sin(KV_LAKE.rot);
        const z = KV_LAKE.z - Math.cos(a) * f * KV_LAKE.rx * Math.sin(KV_LAKE.rot) + Math.sin(a) * f * KV_LAKE.rz * Math.cos(KV_LAKE.rot);
        if (pondDistance(KV_LAKE, x, z) > -6) continue;
        inside++;
        expect(sc.wildHeight(x, z), `${x.toFixed(0)},${z.toFixed(0)}`).toBeLessThan(KV_LAKE.level);
      }
    }
    expect(inside).toBeGreaterThan(40);
    expect(sc.water).toEqual([KV_LAKE]);
  });

  it('keeps the road corridor and its verge level where the lake is near (the hook never lowers the road)', () => {
    for (let u = KV.from('lake-1'); u < KV.to('lake-5'); u += 25) {
      expect(KV.roadside(u, 0, 0), `${u} m`).toBeCloseTo(0, 6);
      expect(KV.roadside(u, 6, 0)).toBeCloseTo(0, 6);
    }
  });

  it('has a cutting at Raven Gap: rock walls rise either side of the road, and nowhere else on the straight', () => {
    const mid = (KV.gap[0] + KV.gap[1]) / 2;
    for (const side of [-1, 1]) expect(KESTREL_VALE.scenery.roadside!(mid, side * 40, 0)!).toBeGreaterThan(20);
    expect(KESTREL_VALE.scenery.roadside!(2000, 40, 0)).not.toBeGreaterThan(5);
    expect(KV.crestAt(KV.roadPoint(mid).x + 600 * -KV.roadPoint(mid).tz, KV.roadPoint(mid).z + 600 * KV.roadPoint(mid).tx)).toBeGreaterThan(100); // the crags beside the saddle
  });

  it('repeats every landmark each lap: an `every` that divides the lap, or an `until` stretch', () => {
    for (const k of KESTREL_VALE.landmarks) {
      if (k.until !== undefined) continue;
      const n = KV_LAP / k.every;
      expect(Math.abs(n - Math.round(n)), `${k.file ?? k.model} every ${k.every}`).toBeLessThan(1e-9);
    }
  });
});

describe('the routes', () => {
  it('have unique, well-formed ids that are in STAGES, with the "World · Route" naming', () => {
    const ids = KESTREL_ROUTE_DEFS.map((r) => r.id);
    expect(ids).toEqual(['kestrel-vale', 'kestrel-vale-loop', 'kestrel-vale-grand']);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of KESTREL_ROUTE_DEFS) {
      expect(r.id).toMatch(/^[a-z0-9-]{1,60}$/);
      expect(r.name).toMatch(/^Kestrel Vale · /);
      expect(STAGES.some((s) => s.id === r.id)).toBe(true);
    }
  });

  it('finish at laps times the lap, and the free ride is endless', () => {
    const by = Object.fromEntries(KESTREL_ROUTES.map((s) => [s.id, s]));
    expect(by['kestrel-vale'].finish).toBeNull();
    expect(by['kestrel-vale-loop'].finish).toBeCloseTo(KV_LAP, 6);
    expect(by['kestrel-vale-grand'].finish).toBeCloseTo(3 * KV_LAP, 6);
    for (const s of KESTREL_ROUTES) {
      expect(s.lapLength).toBe(KV_LAP);
      expect(s.world).toEqual({ id: 'kestrel-vale', route: s.id, start: 0 });
      expect(s.climb).toBe(false);
      expect(s.elevationAt(0)).toBeCloseTo(0, 9);
      expect(s.scenery.road).toBe('alpine');
      expect(s.culture).toBe('gb');
    }
  });

  it('share one road: a second lap lies on the first (heading differs by exactly one turn)', () => {
    const s = stageById('kestrel-vale-grand');
    for (const d of [100, 3000, 9000, 14000]) {
      expect(s.elevationAt(d + KV_LAP)).toBeCloseTo(s.elevationAt(d), 6);
      expect(s.headingAt(d + KV_LAP) - s.headingAt(d)).toBeCloseTo(KESTREL_VALE.turn, 9);
    }
  });

  it('give every route with a finish the same Raven Scar segment id, and the free ride none', () => {
    expect(segmentsFor(stageById('kestrel-vale'))).toEqual([]);
    const loop = segmentsFor(stageById('kestrel-vale-loop'));
    const grand = segmentsFor(stageById('kestrel-vale-grand'));
    expect(loop.map((g) => g.id)).toEqual(['kestrel-vale:raven-scar']);
    expect(grand.map((g) => g.id)).toEqual(['kestrel-vale:raven-scar']);
    expect(grand[0].passes).toBe(3);
    expect(loop[0].passes).toBe(1);
  });

  it('carry a wind of their own (the built-in wind table has no row for them)', () => {
    for (const s of KESTREL_ROUTES) expect(s.wind).toEqual({ ms: 4.5, angle: 20 });
  });
});
