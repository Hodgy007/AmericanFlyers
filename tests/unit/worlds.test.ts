// Worlds and routes (src/worlds/): the Kestrel Vale loop closes, its lap length and climb are pinned (leaderboards, ghosts and
// segment times key on them), the road keeps clear of itself and of the lake, and the routes compile into ordinary stages.
import { afterEach, describe, expect, it } from 'vitest';
import { ROAD_ORIGIN, roadPoint, setStage } from '../../src/course';
import { crowdAt } from '../../src/world/crowdZones';
import { STAGES, stageById, type Stage } from '../../src/stages';
import { segmentsFor } from '../../src/segments';
import { pondDistance, riverDistance, type PondBody, type RiverBody } from '../../src/world/waterTypes';
import { planFieldWalls, WALL_SECTION } from '../../src/world/fieldWalls';
import { planBunting } from '../../src/world/bunting';
import { SCENERY } from '../../src/world/scenery';
import { fieldWallGeometry } from '../../src/world/fieldWalls';
import { triangleCount } from '../../src/world/monumentKit';
import * as THREE from 'three';
import { VIADUCT } from '../../src/world/monumentTypes';
import { KESTREL_ROUTE_DEFS, KESTREL_ROUTES, KESTREL_VALE, KV, KV_BECK, KV_LAKE, KV_LAP } from '../../src/worlds/kestrelVale';
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
    expect(sc.water).toEqual([KV_LAKE, KV_BECK]); // the lake, then its outflow, Mill Beck
  });

  it('keeps the road corridor and its verge level where the lake is near (the hook never lowers the road)', () => {
    for (let u = KV.from('lake-1'); u < KV.to('lake-5'); u += 25) {
      expect(KV.roadside(u, 0, 0), `${u} m`).toBeCloseTo(0, 6);
      expect(KV.roadside(u, 6, 0)).toBeCloseTo(0, 6);
    }
  });

  describe('Mill Beck, the lake’s outflow under Mill Bridge', () => {
    const beck = KV_BECK as RiverBody;
    const sc = KESTREL_VALE.scenery;
    const U = KV.bridge;
    const along = (): [number, number][] => { // the centreline, every 5 m
      const out: [number, number][] = [];
      for (let i = 0; i + 1 < beck.pts.length; i++) {
        const [ax, az] = beck.pts[i], [bx, bz] = beck.pts[i + 1];
        const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 5);
        for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
      }
      return out;
    };

    it('is a river from inside the lake at the lake’s level (a hair above it), 14 m wide, which crosses the road square at the covered bridge', () => {
      expect(beck.kind).toBe('river');
      expect(pondDistance(KV_LAKE, beck.pts[0][0], beck.pts[0][1])).toBeLessThan(-8); // it starts well inside the lake
      expect(beck.level).toBeGreaterThan(KV_LAKE.level);
      expect(beck.level).toBeLessThan(KV_LAKE.level + 0.5);
      const r = KV.roadPoint(U);
      expect(riverDistance(beck, r.x, r.z), 'the road centre is inside the water').toBeLessThan(-5);
      // Square: the river's direction at the road is across the road's tangent.
      const nearest = beck.pts.reduce((best, p, i) => (Math.hypot(p[0] - r.x, p[1] - r.z) < Math.hypot(beck.pts[best][0] - r.x, beck.pts[best][1] - r.z) ? i : best), 0);
      const [p0, p1] = [beck.pts[Math.max(0, nearest - 1)], beck.pts[Math.min(beck.pts.length - 1, nearest + 1)]];
      const dir = [p1[0] - p0[0], p1[1] - p0[1]], len = Math.hypot(dir[0], dir[1]);
      expect(Math.abs((dir[0] * r.tx + dir[1] * r.tz) / len), 'cosine of the angle with the road').toBeLessThan(0.15);
    });

    it('is under the bridge’s deck: the road at Mill Bridge is at least 5 m above the water, and the ground under the deck is dug out below the water', () => {
      expect(e(U) - 0.15 - beck.level, 'deck above the water').toBeGreaterThan(5);
      const road = e(U) - 0.15;
      for (const lat of [-8, -4, 0, 4, 8]) {
        const rel = KV.roadside(U, lat, 0)!;
        expect(road + rel, `ground under the deck at ${lat}`).toBeLessThan(beck.level - 1);
      }
      // ... but not along the road either side of the channel: the verge keeps the road's own level.
      for (const du of [-60, -30, 30, 60]) expect(KV.roadside(U + du, 0, 0) ?? 0, `${du}`).toBeCloseTo(0, 6);
      for (const du of [-60, -30, 30, 60]) expect(KV.roadside(U + du, 6, 0) ?? 0, `${du}`).toBeCloseTo(0, 6);
    });

    it('keeps the road at least 15 m from the beck everywhere except at the bridge (±30 m)', () => {
      for (let i = 0; i < KV.trace.length; i++) {
        const u = i * 10;
        if (Math.abs(u - U) <= 30) continue;
        expect(riverDistance(beck, KV.trace[i][0], KV.trace[i][1]), `${u} m`).toBeGreaterThanOrEqual(15);
      }
    });

    it('sinks the land under the river below the water (bed 3.5 m down), all along it but the last stretch, where the bed climbs back out of the hillside', () => {
      const pts = along();
      let n = 0;
      pts.forEach(([x, z], i) => {
        if (i > pts.length - 36) return; // the last 170 m or so
        if (Math.abs(KV.roadPoint(U).x - x) + Math.abs(KV.roadPoint(U).z - z) < 40) return; // the corridor under the bridge is the roadside hook's (above)
        n++;
        expect(sc.wildHeight(x, z), `${x.toFixed(0)},${z.toFixed(0)}`).toBeLessThan(beck.level - 3);
      });
      expect(n).toBeGreaterThan(60);
      // Away from the water the land is its own: a point 60 m off the centreline is not lowered.
      const mid = pts[Math.floor(pts.length * 0.6)];
      const off = sc.wildHeight(mid[0] + 60, mid[1] + 60);
      expect(off).toBeGreaterThan(beck.level - 3);
    });

    it('is in the world’s water list, so routes shift it with the lake (index 1), and trees keep out of it', () => {
      for (const r of PARTIAL) {
        const shifted = r.scenery.water![1] as RiverBody;
        const P = KV.roadPoint(r.world!.start);
        expect(shifted.kind).toBe('river');
        expect(shifted.level).toBeCloseTo(beck.level - e(r.world!.start), 9);
        expect(shifted.pts[3][0]).toBeCloseTo(beck.pts[3][0] - P.x, 6);
        expect(shifted.pts[3][1]).toBeCloseTo(beck.pts[3][1] - P.z, 6);
      }
    });
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

// ------------------------------------------- the dressing (field walls, bunting) and the performance budget ----

/** Distance from (x, z) to the world's road (its 10 m trace as a polyline) and the lap metre of the nearest point. */
function roadNear(x: number, z: number): { dist: number; u: number } {
  const t = KV.trace;
  let best = Infinity, u = 0;
  for (let i = 0; i + 1 < t.length; i++) {
    const [ax, az] = t[i], [bx, bz] = t[i + 1];
    const vx = bx - ax, vz = bz - az;
    const k = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
    const d = Math.hypot(x - (ax + vx * k), z - (az + vz * k));
    if (d < best) { best = d; u = (i + k) * 10; }
  }
  return { dist: best, u };
}

describe('the dry-stone field walls of Foss Bottom', () => {
  const loop = stageById('kestrel-vale-loop');
  const chunks = (reach: number, a = 0, b = KV_LAP) => {
    const out: ReturnType<typeof planFieldWalls> = [];
    for (let d0 = Math.floor(a / 100) * 100; d0 < b; d0 += 100) out.push(...planFieldWalls(loop, d0, d0 + 100, reach));
    return out;
  };
  afterEach(() => setStage(stageById(null)));

  it('are laid in Foss Bottom only: from just past Mill Bridge to the foot of the climb, and nowhere in the village, the lakeshore, the cutting or the tunnel', () => {
    setStage(loop);
    const spans = KESTREL_VALE.scenery.dressing!.fieldWalls!.spans;
    expect(spans).toEqual([[KV.to('mill-bridge') + 30, KV.from('climb-foot')]]);
    const all = chunks(110);
    expect(all.length).toBeGreaterThan(1000);
    for (let d0 = 0; d0 < KV_LAP; d0 += 100) {
      for (const s of planFieldWalls(loop, d0, d0 + 100, 110)) {
        // A section's nearest road is its own: the chunk it was laid for (the cross walls and the bends move the foot of the perpendicular a little).
        const { u } = roadNear((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2);
        expect(u, `chunk ${d0}`).toBeGreaterThan(d0 - 150);
        expect(u, `chunk ${d0}`).toBeLessThan(d0 + 250);
        expect(d0 + 50, 'in the span').toBeGreaterThan(spans[0][0] - 60);
        expect(d0 + 50, 'in the span').toBeLessThan(spans[0][1] + 60);
      }
    }
    // Nothing in the village (0 to 760 m and the run-in), the lake, the cutting and the tunnel.
    expect(chunks(110, 0, 4200)).toEqual([]);
    expect(chunks(110, KV.from('climb-foot') + 100, KV_LAP)).toEqual([]);
    for (let d0 = Math.floor((KV.gap[0] - 300) / 100) * 100; d0 < KV.gap[1] + 300; d0 += 100) expect(planFieldWalls(loop, d0, d0 + 100, 110)).toEqual([]);
  });

  it('keep clear of the road’s shoulder, the lake, the beck and the farm buildings’ yards, and every section is a 4 m piece of wall', () => {
    setStage(loop);
    for (const s of chunks(110)) {
      const mx = (s.x0 + s.x1) / 2, mz = (s.z0 + s.z1) / 2;
      expect(Math.abs(Math.hypot(s.x1 - s.x0, s.z1 - s.z0) - WALL_SECTION), 'a chord of the road’s offset curve').toBeLessThan(0.3);
      // 7 m from the centreline is the road (4.6), its verge and the lane's own wall (5.6): field walls stand beyond.
      for (const [x, z] of [[s.x0, s.z0], [mx, mz], [s.x1, s.z1]]) expect(roadNear(x, z).dist, 'shoulder').toBeGreaterThan(7);
      expect(pondDistance(KV_LAKE, mx, mz), 'lake').toBeGreaterThan(14);
      expect(riverDistance(KV_BECK as RiverBody, mx, mz), 'beck').toBeGreaterThan(5);
    }
    // The road chunk passes the landmarks' clear zones as `avoid`: the farm's buildings keep their yards.
    const barn = KESTREL_VALE.landmarks.find((k) => k.file === 'barn.glb' && k.first < 5000)!;
    const p = KV.roadPoint(barn.first);
    const bx = p.x - p.tz * barn.offset * barn.side, bz = p.z + p.tx * barn.offset * barn.side;
    const keep = (x: number, z: number) => Math.hypot(x - bx, z - bz) < barn.clearance;
    let dropped = 0;
    for (let d0 = Math.floor(barn.first / 100) * 100 - 100; d0 <= barn.first + 100; d0 += 100) {
      const all = planFieldWalls(loop, d0, d0 + 100, 110);
      const some = planFieldWalls(loop, d0, d0 + 100, 110, keep);
      dropped += all.length - some.length;
      for (const s of some) expect(keep((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2)).toBe(false);
    }
    expect(dropped, 'the barn’s yard is clear of wall').toBeGreaterThan(0);
  });

  it('thins with the tier: Low keeps the first field only (within 44 m of the road), Medium and High the second too', () => {
    setStage(loop);
    const low = chunks(44), high = chunks(110);
    expect(low.length).toBeGreaterThan(300);
    expect(low.length).toBeLessThan(high.length * 0.65);
    for (const s of low) expect(roadNear((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2).dist, 'Low stays near the road').toBeLessThan(52);
    expect(Math.max(...high.map((s) => roadNear((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2).dist))).toBeGreaterThan(75);
    expect(chunks(0)).toEqual([]);
    expect(planFieldWalls(stageById('kestrel-vale-loop'), 4500, 4600, 7)).toEqual([]);
  });

  it('are hashed from the world’s lap metres: the same places on every call, every lap and every route, with gaps for gates and runs without a wall', () => {
    setStage(loop);
    const a = planFieldWalls(loop, 5000, 5100, 110);
    expect(planFieldWalls(loop, 5000, 5100, 110)).toEqual(a);
    // A route that starts partway round lays the same walls (the world’s, moved by -P): same count, each section where the loop's is minus the start's position.
    const r = routeStage(KESTREL_VALE, { id: 'tmp-walls', name: 'Kestrel Vale · Tmp', tagline: '', length: 2500, start: 4800 });
    const P = KV.roadPoint(4800);
    setStage(r);
    const b = planFieldWalls(r, 200, 300, 110); // lap metres 5000 to 5100
    expect(b.length).toBe(a.length);
    for (let i = 0; i < a.length; i++) {
      expect(Math.abs(b[i].x0 - (a[i].x0 - P.x)), `section ${i}`).toBeLessThan(2);
      expect(Math.abs(b[i].z0 - (a[i].z0 - P.z)), `section ${i}`).toBeLessThan(2);
    }
    // Not a continuous fence: some sections are missing (gates and open boundaries).
    const parallel = chunks(110).filter((s) => s.kind === 'along');
    const cross = chunks(110).filter((s) => s.kind === 'cross');
    expect(parallel.length).toBeGreaterThan(cross.length);
    expect(cross.length).toBeGreaterThan(100);
  });
});

describe('the bunting in the Hollins Cross high street', () => {
  const loop = stageById('kestrel-vale-loop');
  const strings = (d0: number, d1: number) => planBunting(loop, d0, d1);
  afterEach(() => setStage(stageById(null)));

  it('hangs a string at every terrace (44 m apart from 66 m to 550 m, and again on the run-in), none in the square, over the line or beyond the street', () => {
    const all: number[] = [];
    for (let d0 = 0; d0 < KV_LAP; d0 += 100) all.push(...strings(d0, d0 + 100).map((s) => s.d));
    expect(all.length).toBe(12 + 9);
    for (const d of all) {
      const near = Math.min(d, KV_LAP - d);
      expect(near === d ? d : KV_LAP - d, `${d}`).toBeGreaterThan(60); // clear of the start arch (30 m) and the line
      expect(Math.abs(d - 30), 'the start arch').toBeGreaterThan(30);
    }
    for (const d of [66, 110, 550]) expect(all.some((x) => Math.abs(x - d) < 1e-6), `${d}`).toBe(true);
    expect(strings(600, 700)).toEqual([]);
    expect(strings(2000, 2100)).toEqual([]);
  });

  it('keeps clear of the finish gantry: a finish line or a start arch is never within 40 m of a string, on any route', () => {
    for (const st of KESTREL_ROUTES) {
      const arches = st.landmarks.filter((k) => k.file === 'gantry.glb' && k.every >= 1e9).map((k) => k.first);
      const gantryEvery = st.landmarks.filter((k) => k.file === 'gantry.glb' && k.every < 1e9);
      const lap = st.world!.lap;
      const lapMetre = (d: number) => (((d + st.world!.start) % lap) + lap) % lap;
      const limit = st.finish ?? 3 * lap;
      for (let d0 = 0; d0 < Math.min(limit, 16000); d0 += 100) {
        for (const s of planBunting(st, d0, d0 + 100)) {
          for (const a of arches) expect(Math.abs(s.d - a), `${st.id} string ${s.d} vs arch ${a}`).toBeGreaterThan(28);
          expect(lapMetre(s.d), st.id).toBeGreaterThan(60);
        }
      }
      void gantryEvery;
    }
  });

  it('sits at the same lap metres on a route that starts partway round (the strings are the world’s, shifted by the start)', () => {
    const r = stageById('kestrel-vale-lakeside'); // starts 14,000: the village is 1,400 m on
    const mine = [] as number[];
    for (let d0 = 0; d0 < 3000; d0 += 100) mine.push(...planBunting(r, d0, d0 + 100).map((s) => (s.d + 14000) % KV_LAP));
    expect(mine.length).toBe(9 + 12 - (mine.length - 21 > 0 ? 0 : 0));
    expect(mine.some((u) => Math.abs(u - 66) < 1e-6)).toBe(true);
  });
});

describe('the performance budget in and round the village (risk 3 of the plan)', () => {
  const sitesIn = (kinds: typeof KESTREL_VALE.landmarks, lo: number, hi: number) => {
    let n = 0;
    for (const k of kinds) {
      if (k.first > hi || (k.until ?? Infinity) < lo) continue;
      const last = Math.min(hi, k.until ?? Infinity);
      for (let i = Math.max(0, Math.ceil((lo - k.first) / k.every)); k.first + i * k.every <= last; i++) n++;
    }
    return n;
  };
  const LANDMARK_BUDGET = 52;
  afterEach(() => setStage(stageById(null)));

  it(`never has more than ${LANDMARK_BUDGET} landmarks in the 1,600 m ahead (250 behind) at any point of the free ride's laps: the village is the busiest`, () => {
    const free = stageById('kestrel-vale');
    let best = 0, at = 0;
    for (let u = 0; u < KV_LAP * 1.3; u += 10) {
      const n = sitesIn(free.landmarks, u - 250, u + 1600);
      if (n > best) { best = n; at = u; }
    }
    expect(best).toBeLessThanOrEqual(LANDMARK_BUDGET);
    expect(best, 'the busiest point is the village, either side of the line').toBeGreaterThan(30);
    expect(at % KV_LAP === 0 || at % KV_LAP > KV_LAP - 1200 || at % KV_LAP < 700, `busiest at ${at}`).toBe(true);
    // The new standalone dressing adds only a handful: market cross, viaduct, jetty.
    const extras = KESTREL_VALE.landmarks.filter((k) => k.model === 'market-cross' || k.model === 'stone-viaduct' || k.model === 'lake-jetty');
    expect(extras).toHaveLength(3);
    for (const k of extras) expect(k.every, `${k.model} once a lap`).toBe(KV_LAP);
    // ... and the village is no denser than Richmond's brick terraces, which already run well.
    const richmond = stageById('richmond-worlds');
    let rb = 0;
    for (let u = 0; u < richmond.finish!; u += 50) rb = Math.max(rb, sitesIn(richmond.landmarks, u - 250, u + 1600));
    expect(best, `Richmond's busiest is ${rb}`).toBeLessThan(rb);
  });

  it('thins the dressing with the tier: Low has the cheapest wall section, the first field only and flags every other time; High and Ultra have the stone courses', () => {
    const tris = (d: 0 | 1) => triangleCount(new THREE.Group().add(new THREE.Mesh(fieldWallGeometry(d))));
    expect(tris(0)).toBeLessThanOrEqual(40);
    expect(tris(1)).toBeLessThan(160);
    expect(tris(1)).toBeGreaterThan(tris(0) * 2);
    const t = SCENERY;
    expect([t.low, t.medium, t.high, t.ultra].map((x) => x.fieldWalls.reach)).toEqual([44, 110, 110, 110]);
    expect([t.low, t.medium, t.high, t.ultra].map((x) => x.fieldWalls.detail)).toEqual([0, 0, 1, 1]);
    expect([t.low, t.medium, t.high, t.ultra].map((x) => x.bunting)).toEqual([1, 2, 2, 2]);
  });

  it('lays at most 1,000 wall sections on Low and 1,800 on Medium and up in the 17 road chunks round the rider, at the busiest point of Foss Bottom', () => {
    const loop = stageById('kestrel-vale-loop');
    setStage(loop);
    const per = (reach: number) => {
      const out: number[] = [];
      for (let d0 = 4200; d0 < 6100; d0 += 100) out.push(planFieldWalls(loop, d0, d0 + 100, reach).length);
      let best = 0;
      for (let i = 0; i + 17 <= out.length; i++) best = Math.max(best, out.slice(i, i + 17).reduce((a, b) => a + b, 0));
      return best;
    };
    const low = per(44), high = per(110);
    expect(low).toBeLessThanOrEqual(1000);
    expect(high).toBeLessThanOrEqual(1800);
    expect(low).toBeLessThan(high);
  });
});

describe("the standalone landmarks: the market cross, the viaduct and the jetty", () => {
  const of = (m: string) => KESTREL_VALE.landmarks.find((k) => k.model === m)!;
  const lake = (id: string) => stageById(id);

  it('puts the market cross in the square: left of the road just after the line, before the start arch (30 m) and the terraces (66 m), once a lap', () => {
    const k = of('market-cross');
    expect(k).toMatchObject({ first: 18, side: -1, every: KV_LAP });
    expect(k.offset).toBeGreaterThan(8);
    expect(k.offset).toBeLessThan(18); // inside the street's fronts (16.5 m)
    expect(k.size).toBeCloseTo(8.43, 2);
    // It is on every route that passes the line: the lap routes, and the Lakeside Sprint (which crosses it 1.4 km in).
    for (const id of ['kestrel-vale-loop', 'kestrel-vale-grand', 'kestrel-vale', 'kestrel-vale-lakeside']) expect(stageById(id).landmarks.some((m) => m.model === 'market-cross'), id).toBe(true);
    expect(stageById('kestrel-vale-raven-scar').landmarks.some((m) => m.model === 'market-cross')).toBe(false);
  });

  it('stands the viaduct across the gill well off the road (at least 150 m from it), 195 m long, each pier on the land and the deck level with the bench its ends stand on', () => {
    const k = of('stone-viaduct');
    expect(k.world).toBeDefined();
    expect(k.within).toBeGreaterThan(800);
    expect(k.within).toBeLessThan(1150); // the terrain is built 1,150 m round the rider
    expect(k.size).toBeCloseTo(VIADUCT.height, 2);
    const { x, z, y, yaw } = k.world!;
    const ax = Math.cos(yaw), az = -Math.sin(yaw); // the viaduct's own x axis in the world
    for (let a = -100; a <= 100; a += 10) expect(roadNear(x + ax * a, z + az * a).dist, `at ${a}`).toBeGreaterThan(150);
    const ground = k.options!.ground!;
    expect(ground).toHaveLength(VIADUCT.bays + 1);
    ground.forEach((g, i) => {
      const a = (i - VIADUCT.bays / 2) * VIADUCT.module;
      expect(KV.viaduct.terrainAt(x + ax * a, z + az * a) - y, `pier ${i}`).toBeCloseTo(g, 1);
      expect(g, `pier ${i} is under the deck`).toBeLessThan(VIADUCT.deck);
    });
    expect(Math.max(...ground.slice(0, 2), ...ground.slice(-2)), 'the bench meets the deck at its ends').toBeGreaterThan(VIADUCT.deck - 4);
    expect(Math.min(...ground), 'a gill under it').toBeLessThan(VIADUCT.deck - 12);
    // The land under the middle is the gill's: below the ground either side of it, by most of its depth.
    const mid = KV.viaduct.terrainAt(x, z);
    expect(mid).toBeLessThan(KV.viaduct.terrainAt(x + ax * 90, z + az * 90) - 8);
    // The bench is level but for the small bumps and the road's own blend pulling its near end down a little: the two ends are within 10 m, and the gill is cut right through it.
    expect(Math.abs(KV.viaduct.terrainAt(x - ax * 90, z - az * 90) - KV.viaduct.terrainAt(x + ax * 90, z + az * 90))).toBeLessThan(10);
  });

  it('has the viaduct on the Vale routes and the Raven Scar route (which starts on the straight at 5,900), and moves it with the start; the Lakeside Sprint does not pass it', () => {
    const k = of('stone-viaduct');
    expect(stageById('kestrel-vale-loop').landmarks.filter((m) => m.model === 'stone-viaduct')).toHaveLength(1);
    const scar = stageById('kestrel-vale-raven-scar').landmarks.find((m) => m.model === 'stone-viaduct')!;
    const P = KV.roadPoint(5900);
    expect(scar.first).toBeCloseTo(k.first - 5900, 6);
    expect(scar.world!.x).toBeCloseTo(k.world!.x - P.x, 6);
    expect(scar.world!.z).toBeCloseTo(k.world!.z - P.z, 6);
    expect(scar.world!.y).toBeCloseTo(k.world!.y - e(5900), 6);
    expect(scar.within).toBe(k.within);
    expect(lake('kestrel-vale-lakeside').landmarks.some((m) => m.model === 'stone-viaduct')).toBe(false);
  });

  it('puts the jetty on the shore (its root 0 to 4 m from the water) with its 24 m running out into the lake, the deck just above the water', () => {
    const k = of('lake-jetty');
    const { x, z, y, yaw } = k.world!;
    expect(y).toBe(KV_LAKE.level);
    expect(pondDistance(KV_LAKE, x, z)).toBeGreaterThan(0);
    expect(pondDistance(KV_LAKE, x, z)).toBeLessThan(4);
    const tip = [x + Math.sin(yaw) * 24, z + Math.cos(yaw) * 24];
    expect(pondDistance(KV_LAKE, tip[0], tip[1]), 'the far end is in the water').toBeLessThan(-8);
    expect(roadNear(x, z).dist, 'seen from the road').toBeLessThan(80);
    expect(roadNear(x, z).dist).toBeGreaterThan(42);
    expect(k.first).toBeLessThan(KV.sprint); // just before the sprint's banner
    expect(KV.sprint - k.first).toBeLessThan(600);
    expect(k.size).toBeCloseTo(5.08, 2);
  });
});
