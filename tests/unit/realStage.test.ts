import { describe, expect, it } from 'vitest';
import { decodeRoute, HEAD_STEP, HEAD_UNIT, ELE_STEP, type RealRouteData } from '../../src/routes/realRoute';
import { detectHairpins, elevationFrom, limitSteps, mapRoute, sharpest } from '../../src/routes/realStage';
import { STAGES, stageById } from '../../src/stages';
import alpe from '../../src/routes/real/alpe-dhuez';
import stelvio from '../../src/routes/real/stelvio';
import ventoux from '../../src/routes/real/ventoux';
import tourmalet from '../../src/routes/real/tourmalet';
import zoncolan from '../../src/routes/real/zoncolan';
import echo from '../../src/routes/real/hell-of-the-west';
import moon from '../../src/routes/real/hotw-tour-of-the-moon';
import morgul from '../../src/routes/real/hotw-morgul-bismark';
import washington from '../../src/routes/real/mt-washington';
import blueSky from '../../src/routes/real/mt-blue-sky';
import diablo from '../../src/routes/real/mt-diablo';
import flagstaff from '../../src/routes/real/flagstaff';

/** Encodes headings (rad) and elevations (m) the way scripts/bake-routes.mjs does. */
function encode(heading: number[], elevation: number[], length: number): RealRouteData {
  const b64 = (steps: number[]) => Buffer.from(Int8Array.from(steps).buffer).toString('base64');
  const steps = (v: number[], unit: number) => {
    const out: number[] = [];
    let prev = 0;
    for (let i = 1; i < v.length; i++) {
      const q = Math.round((v[i] - v[0]) / unit);
      out.push(q - prev);
      prev = q;
    }
    return out;
  };
  return {
    length,
    head0: Math.round(heading[0] / HEAD_UNIT),
    ele0: Math.round(elevation[0] * 10),
    head: b64(steps(heading, HEAD_UNIT)),
    ele: elevation.length ? b64(steps(elevation, 0.1)) : '',
  };
}

/** A road of straights joined by 180 degree hairpins of the given radius, as heading samples every HEAD_STEP m. */
function hairpinRoad(legs: number[], radius: number) {
  const out: number[] = [0];
  let h = 0;
  const dir = [1, -1];
  for (let i = 0; i < legs.length; i++) {
    for (let m = HEAD_STEP; m <= legs[i]; m += HEAD_STEP) out.push(h);
    if (i === legs.length - 1) break;
    const arc = Math.PI * radius;
    for (let m = HEAD_STEP; m <= arc; m += HEAD_STEP) out.push(h + dir[i % 2] * (m / radius));
    h += dir[i % 2] * Math.PI;
    out.push(h);
  }
  return out;
}

describe('decoding a baked road', () => {
  it('round-trips headings and elevations to within the format’s resolution', () => {
    const heading = Array.from({ length: 400 }, (_, i) => 1 + 3 * Math.sin(i / 40)); // 2 km, turning up to 0.075 rad per sample
    const elevation = Array.from({ length: 101 }, (_, i) => 700 + i * 1.3 + 4 * Math.sin(i / 7));
    const r = decodeRoute(encode(heading, elevation, 2000));
    expect(r.heading).toHaveLength(heading.length);
    expect(r.elevation).toHaveLength(elevation.length);
    // Rounding error is carried forward, so it never builds up along the road.
    for (let i = 0; i < heading.length; i++) expect(Math.abs(r.heading[i] - heading[i])).toBeLessThanOrEqual(HEAD_UNIT / 2 + 1e-9);
    for (let i = 0; i < elevation.length; i++) expect(Math.abs(r.elevation[i] - elevation[i])).toBeLessThanOrEqual(0.05 + 1e-9);
  });

  it('decodes a shape-only road with no elevation', () => {
    const r = decodeRoute(encode([0, 0.1, 0.2], [], 10));
    expect(r.elevation).toHaveLength(0);
  });
});

describe('mapping a real road onto a stage', () => {
  const heading = Array.from({ length: 201 }, (_, i) => i * 0.01); // 1 km, turning steadily
  const geo = mapRoute(encode(heading, Array.from({ length: 51 }, (_, i) => i * 2), 1000), 800);

  it('maps the real length onto the stage length proportionally', () => {
    expect(geo.scale).toBeCloseTo(1.25, 6);
    expect(geo.headingAt(0)).toBeCloseTo(0, 2);
    expect(geo.headingAt(800)).toBeCloseTo(2, 2); // the end of the real road is the end of the stage
    expect(geo.headingAt(400)).toBeCloseTo(1, 2); // half way is half way
    expect(geo.headingAt(-50)).toBeCloseTo(0, 2);
    expect(geo.headingAt(900)).toBeCloseTo(2, 2);
  });

  it('keeps the real profile, whatever the stage length', () => {
    const rise = geo.rise;
    expect(rise).toHaveLength(801);
    expect(rise[800]).toBeCloseTo(100, 0);
    expect(rise[400]).toBeCloseTo(50, 0);
  });
});

describe('detecting hairpins', () => {
  const road = hairpinRoad([300, 200, 250, 400], 14);
  const length = (road.length - 1) * HEAD_STEP;
  const geo = mapRoute(encode(road, [], length), length);

  it('finds each 180 degree turn, in order, with its direction', () => {
    const found = detectHairpins(geo.headingAt, length);
    expect(found).toHaveLength(3);
    expect(found.map((h) => h.turn)).toEqual([1, -1, 1]);
    for (const h of found) {
      expect(h.angle).toBeGreaterThan(2.9);
      expect(h.end - h.start).toBeGreaterThan(30);
      expect(h.end - h.start).toBeLessThan(70);
    }
    // The first leg is 300 m long, so the first apex is near 300 m + half an arc.
    expect(found[0].apex).toBeGreaterThan(300);
    expect(found[0].apex).toBeLessThan(345);
  });

  it('ignores gentle bends and tight but short wiggles', () => {
    const bends = Array.from({ length: 300 }, (_, i) => 0.6 * Math.sin(i / 25)); // a sweeping S, never 140 degrees
    const g = mapRoute(encode(bends, [], 1495), 1495);
    expect(detectHairpins(g.headingAt, 1495)).toEqual([]);
  });

  it('relaxes the threshold to reach an official count, and keeps the sharpest when there are too many', () => {
    // Three turns of 180, 150 and 125 degrees.
    const turn = (deg: number) => Array.from({ length: 10 }, (_, i) => ((deg * Math.PI) / 180) * ((i + 1) / 10));
    const h: number[] = [0];
    let base = 0;
    for (const deg of [180, 150, 125]) {
      for (let i = 0; i < 40; i++) h.push(base);
      for (const t of turn(deg)) h.push(base + t);
      base += (deg * Math.PI) / 180;
    }
    for (let i = 0; i < 40; i++) h.push(base);
    const len = (h.length - 1) * HEAD_STEP;
    const g = mapRoute(encode(h, [], len), len);
    expect(detectHairpins(g.headingAt, len)).toHaveLength(2); // only 180 and 150 pass the 140 degree bar
    expect(detectHairpins(g.headingAt, len, 3)).toHaveLength(3); // the 125 degree one is found when 3 are expected
    const two = detectHairpins(g.headingAt, len, 2);
    expect(two).toHaveLength(2);
    expect(sharpest(detectHairpins(g.headingAt, len, 3), 2).map((x) => Math.round(x.angle * 57.3))).toEqual(two.map((x) => Math.round(x.angle * 57.3)));
  });
});

describe('limiting steps', () => {
  it('caps the steepest steps and keeps the total', () => {
    const steps = new Float64Array(200).fill(0.05);
    for (let i = 90; i < 100; i++) steps[i] = 0.4;
    const total = steps.reduce((a, v) => a + v, 0);
    limitSteps(steps, 0.1, 20);
    expect(Math.max(...steps)).toBeLessThanOrEqual(0.1 + 1e-6);
    expect(steps.reduce((a, v) => a + v, 0)).toBeCloseTo(total, 6);
  });
});

describe('elevation from a real profile', () => {
  // 1 km at 2%, 1 km at 4%, with a 10 m dip and a 25 m SRTM spike.
  const ele = Array.from({ length: 101 }, (_, i) => (i < 50 ? i * ELE_STEP * 0.02 : 20 + (i - 50) * ELE_STEP * 0.04));
  ele[30] -= 10;
  ele[70] += 25;
  const geo = mapRoute(encode(Array(401).fill(0), ele, 2000), 2000);

  it('scales the finish to the published gain and runs on nearly level past it', () => {
    const f = elevationFrom(geo, 2000, { gain: 90 });
    expect(f(0)).toBe(0);
    expect(f(2000)).toBeCloseTo(90, 3);
    expect(f(2060) - f(2000)).toBeCloseTo(0.6, 3);
    expect(f(5000) - f(2000)).toBeCloseTo(0.6, 3);
  });

  it('rescales each kilometre to its published gradient', () => {
    const f = elevationFrom(geo, 2000, { gain: 100, climbOnly: true }, [3, 7]);
    expect(f(1000)).toBeCloseTo(30 * (100 / 100), 0); // 3% of 1 km, then the whole is scaled to 100 m: 30 + 70
    expect(f(2000) - f(1000)).toBeGreaterThan(f(1000));
  });

  it('never exceeds the gradient cap and never descends on a climb', () => {
    const f = elevationFrom(geo, 2000, { gain: 90, maxGrade: 0.08, climbOnly: true });
    let prev = f(0);
    for (let d = 1; d <= 2000; d++) {
      const e = f(d);
      expect(e).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(e - prev).toBeLessThanOrEqual(0.08 + 1e-4);
      prev = e;
    }
  });

  it('scales a road that also descends so its highest point is the published one', () => {
    const f = elevationFrom(geo, 2000, { peak: 70 });
    let top = -Infinity;
    for (let d = 0; d <= 2000; d += 5) top = Math.max(top, f(d));
    expect(top).toBeCloseTo(70, 1);
  });
});

describe('the baked stages', () => {
  const climbs: [string, number, number][] = [
    ['alpe-dhuez', 14000, 1118],
    ['stelvio', 24500, 1843],
    ['ventoux', 21400, 1610],
    ['tourmalet', 19000, 1404],
    ['zoncolan', 10100, 1210],
    ['hell-of-the-west', 20800, 942],
    ['mt-washington', 12200, 1417],
    ['mt-blue-sky', 23300, 1080],
    ['mt-diablo', 18000, 990],
    ['flagstaff', 7400, 602],
  ];

  it('keep their published length and gain', () => {
    for (const [id, length, gain] of climbs) {
      const s = stageById(id);
      expect(s.finish, id).toBe(length);
      expect(s.elevationAt(length), id).toBeCloseTo(gain, 3);
    }
  });

  it('have real roads whose lengths are within a few per cent of the stage’s', () => {
    const real: [RealRouteData, number][] = [[alpe, 14000], [stelvio, 24500], [ventoux, 21400], [tourmalet, 19000], [zoncolan, 10100], [echo, 20800], [moon, 37000], [washington, 12200], [blueSky, 23300], [diablo, 18000], [flagstaff, 7400]];
    for (const [data, length] of real) expect(Math.abs(data.length / length - 1)).toBeLessThan(0.08);
  });

  it('keep every bend wide enough for the road (no tighter than a 10 m radius) at the stage’s scale', () => {
    for (const s of STAGES.filter((x) => ['alpe-dhuez', 'stelvio', 'ventoux', 'tourmalet', 'zoncolan', 'hell-of-the-west', 'hotw-tour-of-the-moon', 'hotw-morgul-bismark', 'mt-washington', 'mt-blue-sky', 'mt-diablo', 'flagstaff'].includes(x.id))) {
      let worst = 0;
      for (let d = 0; d < s.finish! - 1; d++) worst = Math.max(worst, Math.abs(s.headingAt(d + 1) - s.headingAt(d)));
      expect(worst, s.id).toBeLessThan(0.1); // rad per metre
    }
  });

  it('count the official hairpins on the roads that number them, and none elsewhere', () => {
    const numbered = (id: string) => stageById(id).signs.filter((g) => g.numbered !== false);
    expect(numbered('alpe-dhuez')).toHaveLength(21);
    expect(numbered('stelvio')).toHaveLength(48);
    expect(numbered('alpe-dhuez').map((g) => g.label)[0]).toBe('21');
    for (const id of ['ventoux', 'tourmalet', 'zoncolan', 'hell-of-the-west', 'mt-washington', 'mt-blue-sky', 'mt-diablo', 'flagstaff']) expect(numbered(id), id).toHaveLength(0);
    // Hairpin 7 is the Dutch Corner, in Huez village (about 1,400 m).
    const s = stageById('alpe-dhuez');
    const seven = s.signs.find((g) => g.label === '7')!;
    const alt = s.baseAltitude! + s.elevationAt(seven.d);
    expect(alt).toBeGreaterThan(1350);
    expect(alt).toBeLessThan(1480);
  });

  it("numbers Stelvio's hairpins as the real plaques are (quaeldich.de, Prad ramp description)", () => {
    // 48 and 47 are the pair just after Gomagoi, below Trafoi (1,543 m); 46 is at the Hotel Bella Vista in Trafoi;
    // the Gasthof Weisser Knott follows 33; the Franzenshöhe (2,188 m) is at 22; 4 to 1 are the last bends, with a ~500 m straight to the pass.
    const s = stageById('stelvio');
    const sign = (label: string) => s.signs.find((g) => g.label === label)!;
    const alt = (label: string) => s.baseAltitude! + s.elevationAt(sign(label).d + 12 + 20);
    expect(alt('48')).toBeGreaterThan(1380);
    expect(alt('48')).toBeLessThan(1480);
    expect(sign('47').d - sign('48').d).toBeLessThan(150); // the first two follow directly
    expect(alt('46')).toBeGreaterThan(1540);
    expect(alt('46')).toBeLessThan(1660); // Trafoi
    expect(alt('22')).toBeGreaterThan(2160);
    expect(alt('22')).toBeLessThan(2260); // the Franzenshöhe
    expect(s.finish! - sign('1').d).toBeGreaterThan(400);
    expect(s.finish! - sign('1').d).toBeLessThan(600); // the last bend, just below the pass
    expect(sign('4').d).toBeGreaterThan(s.finish! - 1000); // the last four bunch together
    // Odd hairpins are left-handers, even ones right-handers (hairpin 33 is a left, as the describers say).
    const turn = (label: string) => Math.sign(s.headingAt(sign(label).d + 12 + 40) - s.headingAt(sign(label).d + 12));
    for (const l of ['47', '33', '1']) expect(turn(l), l).toBe(-1);
    for (const l of ['48', '34', '2']) expect(turn(l), l).toBe(1);
  });

  it('name the places Ventoux and Tourmalet announce', () => {
    const names = (id: string) => stageById(id).signs.filter((g) => g.name).map((g) => g.name);
    expect(names('ventoux')).toEqual(['Saint-Estève', 'Chalet Reynard']);
    expect(names('tourmalet')).toEqual(['Barèges', 'La Mongie']);
  });

  it('Tour of the Moon peaks at the published 2,024 m with gentle grades', () => {
    const s = stageById('hotw-tour-of-the-moon');
    let top = -Infinity;
    let steepest = 0;
    for (let d = 0; d < 37000; d += 5) {
      top = Math.max(top, s.elevationAt(d));
      steepest = Math.max(steepest, Math.abs(s.elevationAt(d + 5) - s.elevationAt(d)) / 5);
    }
    expect(s.baseAltitude! + top).toBeCloseTo(2024, 0);
    expect(steepest).toBeLessThanOrEqual(0.11); // capped at 10%; the cap is met to within a little
    for (const su of s.race!.summits!) expect(s.baseAltitude! + s.elevationAt(su.d)).toBeGreaterThan(1700);
  });
});

describe('the Morgul-Bismark loop', () => {
  const mb = stageById('hotw-morgul-bismark');
  const lap = mb.lapLength!;

  function position(upTo: number) {
    let x = 0, z = 0;
    const step = 2;
    for (let d = 0; d < upTo; d += step) {
      const h = mb.headingAt(d + step / 2);
      x += Math.cos(h) * step;
      z += Math.sin(h) * step;
    }
    return [x, z];
  }

  it('closes: after a lap the road is back where it started, heading the same way', () => {
    const [x, z] = position(lap);
    expect(Math.hypot(x, z)).toBeLessThan(8);
    const turn = mb.headingAt(lap) - mb.headingAt(0);
    expect(Math.abs(turn / (2 * Math.PI) - Math.round(turn / (2 * Math.PI)))).toBeLessThan(0.002);
    // The second lap repeats the first: same heading, a whole turn on.
    expect(mb.headingAt(lap + 3000) - mb.headingAt(3000)).toBeCloseTo(turn, 6);
  });

  it('keeps the lap length the leaderboards know, the Wall in the last 1,600 m, and its own elevation', () => {
    expect(lap).toBeCloseTo(21131.327, 2);
    expect(mb.finish).toBe(lap * 2);
    const rise = mb.elevationAt(lap) - mb.elevationAt(lap - 1600);
    expect(rise).toBeGreaterThan(80);
    expect(rise).toBeLessThan(100);
    expect(morgul.ele).toBe(''); // shape only
  });

  it('places the Flatirons on the left (west) of the Highway 93 leg, riding north', () => {
    const flat = mb.landmarks.find((k) => k.model === 'flatirons')!;
    expect(flat.side).toBe(-1);
    // Heading north is about -pi/2 (z points south) on that leg.
    const h = mb.headingAt(flat.first);
    const north = Math.cos(h + Math.PI / 2);
    expect(north).toBeGreaterThan(0.5);
  });
});

describe('data size', () => {
  it('keeps the baked roads small enough for the first load', () => {
    const all = [alpe, stelvio, ventoux, tourmalet, zoncolan, echo, moon, morgul, washington, blueSky, diablo, flagstaff];
    const chars = all.reduce((a, d) => a + d.head.length + d.ele.length, 0);
    expect(chars).toBeLessThan(120_000);
  });
});
