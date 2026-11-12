// Worlds and routes (src/worlds/): the Kestrel Vale loop closes, its lap length and climb are pinned (leaderboards, ghosts and
// segment times key on them), the road keeps clear of itself and of the lake, and the routes compile into ordinary stages.
import { afterEach, describe, expect, it } from 'vitest';
import { ROAD_ORIGIN, roadPoint, setStage } from '../../src/course';
import { crowdAt } from '../../src/world/crowdZones';
import { STAGES, stageById, type Stage } from '../../src/stages';
import { segmentsFor } from '../../src/segments';
import { pondDistance, type PondBody } from '../../src/world/waterTypes';
import { KESTREL_ROUTE_DEFS, KESTREL_ROUTES, KESTREL_VALE, KV, KV_LAKE, KV_LAP } from '../../src/worlds/kestrelVale';
import { closeLoop, routeStage } from '../../src/worlds/types';

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
    expect(ids).toEqual(['kestrel-vale', 'kestrel-vale-loop', 'kestrel-vale-grand', 'kestrel-vale-raven-scar', 'kestrel-vale-lakeside']);
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
    expect(by['kestrel-vale-raven-scar'].finish).toBe(4800);
    expect(by['kestrel-vale-lakeside'].finish).toBe(5700);
    for (const s of KESTREL_ROUTES) {
      // Whole laps from the line keep the lap length (lap counter, crowds' modular spots); a partial route has no laps to count.
      expect(s.lapLength).toBe(s.finish === null || s.finish >= KV_LAP ? KV_LAP : undefined);
      expect(s.world).toMatchObject({ id: 'kestrel-vale', route: s.id, name: 'Kestrel Vale', lap: KV_LAP });
      expect(s.world!.start).toBe(KESTREL_ROUTE_DEFS.find((r) => r.id === s.id)!.start ?? 0);
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
    expect(segmentsFor(stageById('kestrel-vale-lakeside'))).toEqual([]);
    const loop = segmentsFor(stageById('kestrel-vale-loop'));
    const grand = segmentsFor(stageById('kestrel-vale-grand'));
    expect(loop.map((g) => g.id)).toEqual(['kestrel-vale:raven-scar']);
    expect(grand.map((g) => g.id)).toEqual(['kestrel-vale:raven-scar']);
    expect(grand[0].passes).toBe(3);
    expect(loop[0].passes).toBe(1);
  });

  it('share the Raven Scar segment: the same id and the same geometry on every route that covers it, mapped into route metres', () => {
    const loop = segmentsFor(stageById('kestrel-vale-loop'))[0];
    const grand = segmentsFor(stageById('kestrel-vale-grand'))[0];
    const scar = segmentsFor(stageById('kestrel-vale-raven-scar'));
    expect(scar.map((g) => g.id)).toEqual(['kestrel-vale:raven-scar']);
    for (const g of [grand, scar[0]]) {
      expect(g.length).toBe(loop.length);
      expect(g.gain).toBeCloseTo(loop.gain, 9);
      expect(g.avg).toBeCloseTo(loop.avg, 9);
      expect(g.max).toBeCloseTo(loop.max, 9);
      expect(g.name).toBe('Raven Scar');
    }
    expect([loop.start, loop.end]).toEqual([6025, 10175]);
    expect([scar[0].start, scar[0].end, scar[0].passes, scar[0].lap]).toEqual([125, 4275, 1, undefined]); // 5,900 + 125 = 6,025
    expect(scar[0].stageId).toBe('kestrel-vale-raven-scar');
    // The segment's elevation on the Raven Scar route is the world's (route elevation is relative to its start).
    const s = stageById('kestrel-vale-raven-scar');
    expect(s.elevationAt(scar[0].end) - s.elevationAt(scar[0].start)).toBeCloseTo(loop.gain, 6);
    expect(grand.start).toBe(6025);
    expect(grand.lap).toBe(KV_LAP);
  });

  it('only count a passage the route covers whole', () => {
    // A route that ends mid-climb has no segment; one that starts mid-climb has none either, and one lap further on has its next passage.
    const w = KESTREL_VALE;
    const mk = (id: string, start: number, length: number) => routeStage(w, { id, name: 'Kestrel Vale · Test', tagline: '', start, length });
    expect(segmentsFor(mk('t1', 5900, 3000))).toEqual([]); // ends on the climb
    expect(segmentsFor(mk('t2', 7000, 3500))).toEqual([]); // starts on the climb
    expect(segmentsFor(mk('t3', 14000, 6000))).toEqual([]); // over the lap line and on, but only to 4,600 lap metres: no climb
    const across = segmentsFor(mk('t3', 14000, KV_LAP + 2000)); // far enough on to take in the climb of the next lap whole
    expect(across.map((g) => [g.id, g.passes])).toEqual([['kestrel-vale:raven-scar', 1]]);
    expect(across[0].start).toBeCloseTo(6025 + KV_LAP - 14000, 6);
    const two = segmentsFor(mk('t4', 5000, KV_LAP + 6000)); // the climb twice: 6,025 and one lap on
    expect(two.map((g) => [g.start, g.passes, g.lap])).toEqual([[1025, 2, KV_LAP]]);
  });

  it('carry a wind of their own (the built-in wind table has no row for them)', () => {
    for (const s of KESTREL_ROUTES) expect(s.wind).toEqual({ ms: 4.5, angle: 20 });
  });
});

// ---------------------------------------------------------- routes that start partway round the lap ----

const PARTIAL = KESTREL_ROUTES.filter((r) => (r.world?.start ?? 0) !== 0);
const modLap = (u: number) => ((u % KV_LAP) + KV_LAP) % KV_LAP;

describe('routes that start partway round the lap', () => {
  it('start 5,900 and 14,000 lap metres in, on straight road, and are not whole laps', () => {
    expect(PARTIAL.map((r) => [r.id, r.world!.start, r.finish])).toEqual([['kestrel-vale-raven-scar', 5900, 4800], ['kestrel-vale-lakeside', 14000, 5700]]);
    // Straight ahead of the start (200 m on, under 3 degrees of turn), and the finish is on a gentle bend at most (under 7 degrees in 100 m).
    for (const r of PARTIAL) {
      expect(Math.abs(r.headingAt(200) - r.headingAt(0))).toBeLessThan(0.05);
      expect(Math.abs(r.headingAt(r.finish! + 50) - r.headingAt(r.finish! - 50))).toBeLessThan(0.12);
    }
  });

  for (const r of PARTIAL) {
    const s = r.world!.start;
    const E = e(s);
    const P = KV.roadPoint(s);
    const road = (d: number) => KV.roadPoint(s + d);

    describe(r.id, () => {
      it('starts at elevation 0 and follows the world’s elevation from there, behind the start too', () => {
        expect(r.elevationAt(0)).toBeCloseTo(0, 9);
        for (const d of [-900, -300, 0, 1, 250, 1111, 2500, r.finish!]) expect(r.elevationAt(d), `${d}`).toBeCloseTo(e(modLap(s + d)) - E, 9);
        expect(r.baseAltitude).toBeCloseTo(KESTREL_VALE.baseAltitude! + E, 9);
      });

      it('has the world’s heading, including the turn each lap and the lap before the start', () => {
        for (const d of [-800, 0, 400, 3000, r.finish!]) {
          const u = s + d;
          const lapsDone = Math.floor(u / KV_LAP);
          expect(r.headingAt(d) - lapsDone * KESTREL_VALE.turn - KESTREL_VALE.headingAt(modLap(u)), `${d}`).toBeCloseTo(0, 9);
        }
        // Continuous across the start, across the lap line and back round the lap.
        let prev = r.headingAt(-1000);
        for (let d = -990; d <= r.finish!; d += 10) {
          const h = r.headingAt(d);
          expect(Math.abs(h - prev), `${d}`).toBeLessThan(0.25); // a hairpin turns 0.225 rad in 10 m
          prev = h;
        }
      });

      it('translates the ground by the start’s position and height: wildHeight, water, roadside, walls and clearings', () => {
        const sc = r.scenery;
        const w = KESTREL_VALE.scenery;
        for (let i = 0; i < 40; i++) {
          const x = -1500 + (i * 997) % 3000, z = -1500 + (i * 1553) % 3000;
          expect(sc.wildHeight(x, z), `${x},${z}`).toBeCloseTo(w.wildHeight(x + P.x, z + P.z) - E, 6);
        }
        const lake = sc.water![0] as PondBody;
        expect(lake.level).toBeCloseTo(KV_LAKE.level - E, 9);
        expect(lake.x).toBeCloseTo(KV_LAKE.x - P.x, 9);
        expect(lake.z).toBeCloseTo(KV_LAKE.z - P.z, 9);
        expect(lake.rot).toBe(KV_LAKE.rot);
        for (const [x, z] of [[0, 0], [500, -800], [-300, 1200]]) expect(pondDistance(lake, x, z)).toBeCloseTo(pondDistance(KV_LAKE, x + P.x, z + P.z), 6);
        for (const k of ['rockLine', 'treeLine'] as const) expect(sc[k]).toBeCloseTo(w[k] - E, 9);
        expect(sc.snowLine).toBeGreaterThan(1e8);
        for (const d of [-600, 0, 300, 1500, 2600, 4383, r.finish!]) {
          for (const lat of [-40, -8, 0, 12, 40]) expect(sc.roadside!(d, lat, 1.5), `${d}/${lat}`).toBe(w.roadside!(modLap(s + d), lat, 1.5));
          expect(sc.walls!(d)).toBe(w.walls!(modLap(s + d)));
          expect(sc.clearing!(d)).toBe(w.clearing!(modLap(s + d)));
        }
      });

      it('keeps the road at least 15 m from the lake, behind the start as well as ahead', () => {
        const lake = r.scenery.water![0] as PondBody;
        // The road integrated from the route's own headings, as course.ts does, from 1,000 m behind the start.
        let x = 0, z = 0;
        const back: [number, number][] = [];
        for (let d = 0; d > -1000; d -= 10) { const h = r.headingAt(d - 5); x -= Math.cos(h) * 10; z -= Math.sin(h) * 10; back.push([x, z]); }
        let fx = 0, fz = 0;
        const fwd: [number, number][] = [];
        for (let d = 0; d < r.finish!; d += 10) { const h = r.headingAt(d + 5); fx += Math.cos(h) * 10; fz += Math.sin(h) * 10; fwd.push([fx, fz]); }
        for (const [px, pz] of [...back, ...fwd]) expect(pondDistance(lake, px, pz)).toBeGreaterThanOrEqual(15);
        // ...and it is the world’s road moved by -P(s).
        for (const d of [200, 1000, 2000, 3000]) {
          const q = fwd[d / 10 - 1];
          expect(Math.hypot(q[0] - (road(d).x - P.x), q[1] - (road(d).z - P.z))).toBeLessThan(1);
        }
      });

      it('puts every landmark, place, sprint and summit inside [0, finish], the start arch near the start and the finish arch at the finish', () => {
        const finish = r.finish!;
        for (const k of r.landmarks) {
          expect(k.first, `${k.file ?? k.model}`).toBeGreaterThanOrEqual(0);
          expect(k.first, `${k.file ?? k.model}`).toBeLessThanOrEqual(finish);
          if (k.until !== undefined) expect(k.until).toBeLessThanOrEqual(finish);
          if (k.every > finish) expect(k.every).toBeGreaterThan(0);
        }
        for (const p of r.signs) { expect(p.d).toBeGreaterThanOrEqual(0); expect(p.d).toBeLessThanOrEqual(finish); }
        for (const p of [...(r.race?.sprints ?? []), ...(r.race?.summits ?? [])]) { expect(p.d).toBeGreaterThanOrEqual(0); expect(p.d).toBeLessThanOrEqual(finish); }
        for (const d of r.crowdSpots ?? []) { expect(d).toBeGreaterThanOrEqual(0); expect(d).toBeLessThanOrEqual(finish); }
        const arches = r.landmarks.filter((k) => k.file === 'gantry.glb' && k.every >= 1e9).map((k) => k.first);
        expect(arches).toContain(30);
        expect(arches).toContain(finish);
        expect(r.signs.map((p) => p.d)).toEqual([...r.signs.map((p) => p.d)].sort((a, b) => a - b));
      });

      it('moves the world’s one-offs by -start: each is where its world metre is, and absent when the route does not pass it', () => {
        const finish = r.finish!;
        const want = (worldU: number) => modLap(worldU - s);
        for (const k of KESTREL_VALE.landmarks) {
          if (k.until !== undefined || k.every !== KV_LAP) continue; // the one-offs (every = the lap)
          const d = want(k.first);
          const has = r.landmarks.filter((o) => (o.file ?? o.model) === (k.file ?? k.model) && Math.abs(o.first - d) < 1e-6);
          expect(has.length > 0, `${k.file ?? k.model} at ${d.toFixed(0)}`).toBe(d <= finish);
        }
        // Houses: a terrace row copied to the stretch of the route that is inside it, never outside.
        for (const k of r.landmarks.filter((o) => o.model === 'terrace')) expect(k.until).toBeDefined();
      });
    });
  }

  it('the Raven Scar route holds the climb and the cutting, and not the village or the lake; the Lakeside Sprint is flat, and has the village, the lake and the bridge', () => {
    const scar = stageById('kestrel-vale-raven-scar');
    const lake = stageById('kestrel-vale-lakeside');
    const names = (s: Stage) => s.landmarks.map((k) => k.file ?? k.model);
    expect(names(scar)).not.toContain('alpine-church');
    expect(names(scar)).not.toContain('covered-bridge.glb');
    expect(scar.signs.map((p) => p.name)).toEqual(['Raven Scar', 'Raven Gap', 'Highfold Woods']);
    expect(scar.race!.summits).toEqual([{ d: KV.summit - 5900, name: 'Raven Scar', cat: 2 }]);
    expect(scar.crowdSpots).toHaveLength(6);
    expect(crowdAt(scar, scar.crowdSpots![0])).toBeGreaterThan(0.5);
    expect(names(lake)).toContain('alpine-church');
    expect(names(lake)).toContain('covered-bridge.glb');
    expect(lake.signs.map((p) => p.name)).toEqual(['Hollins Cross', 'Kestrel Water', 'Mill Bridge']);
    expect(lake.race!.sprints).toHaveLength(1);
    expect(lake.race!.sprints![0].d).toBeCloseTo(KV.sprint + (KV_LAP - 14000), 6);
    let climbed = 0;
    for (let d = 10; d <= lake.finish!; d += 10) climbed += Math.max(0, lake.elevationAt(d) - lake.elevationAt(d - 10));
    expect(climbed).toBeLessThan(20);
    expect(lake.lapLength).toBeUndefined();
  });

  it('wrap a lap-based route that starts partway round: laps from the start, its own line each lap', () => {
    const mk = routeStage(KESTREL_VALE, { id: 'tmp-offset', name: 'Kestrel Vale · Tmp', tagline: '', laps: 2, start: 3000 });
    expect(mk.finish).toBeCloseTo(2 * KV_LAP, 6);
    expect(mk.elevationAt(0)).toBeCloseTo(0, 9);
    expect(mk.elevationAt(100 + KV_LAP)).toBeCloseTo(mk.elevationAt(100), 6);
    expect(mk.world!.start).toBe(3000);
  });

  it('refuses a route with both laps and length, or neither, or a start outside the lap', () => {
    expect(() => routeStage(KESTREL_VALE, { id: 'x', name: 'x', tagline: '', laps: 1, length: 100 })).toThrow();
    expect(() => routeStage(KESTREL_VALE, { id: 'x', name: 'x', tagline: '' })).toThrow();
    expect(() => routeStage(KESTREL_VALE, { id: 'x', name: 'x', tagline: '', length: 100, start: KV_LAP })).toThrow();
  });
});

// ----------------------------------------------------------- the road behind the start (course.ts) ----

describe('the road behind the start', () => {
  afterEach(() => setStage(stageById(null)));

  it('follows the real loop on a world’s route: roadPoint(-500) is the world’s trace at s-500, moved by -P(s), and the road passes through the origin at d = 0', () => {
    for (const r of KESTREL_ROUTES) {
      setStage(r);
      const s = r.world!.start;
      const P = KV.roadPoint(s);
      expect(Math.hypot(roadPoint(0).x, roadPoint(0).z), r.id).toBeLessThan(1e-6);
      for (const back of [100, 500, 900, 1000]) {
        const w = KV.roadPoint(s - back);
        const p = roadPoint(-back);
        expect(Math.hypot(p.x - (w.x - P.x), p.z - (w.z - P.z)), `${r.id} -${back}`).toBeLessThan(1);
        expect(p.y).toBeCloseTo(e(modLap(s - back)) - e(s), 6);
      }
      expect(ROAD_ORIGIN).toBe(-1000);
    }
  });

  it('is a bend on the Lakeside Sprint, whose start is 1.4 km before the lap line: the straight road back would be 1 km off the real one', () => {
    const r = stageById('kestrel-vale-lakeside');
    setStage(r);
    const straight = { x: Math.cos(r.headingAt(0)) * -1000, z: Math.sin(r.headingAt(0)) * -1000 };
    const p = roadPoint(-1000);
    expect(Math.hypot(p.x - straight.x, p.z - straight.z)).toBeGreaterThan(40);
  });

  it('leaves every other stage’s road straight back from the start, as before', () => {
    const h = stageById('heartland');
    setStage(h);
    const hd = h.headingAt(0);
    for (const back of [10, 500, 1000]) {
      const p = roadPoint(-back);
      expect(p.x).toBeCloseTo(-Math.cos(hd) * back, 9);
      expect(p.z).toBeCloseTo(-Math.sin(hd) * back, 9);
    }
  });
});
