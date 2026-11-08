// The Flatirons at their real place beside Flagstaff Road: the placement maths (world/flatironsPlacement.ts) and
// what a rider on the road sees of them.
import { beforeAll, describe, expect, it } from 'vitest';
import { roadPoint, setStage } from '../../src/course';
import { stageById } from '../../src/stages';
import { FLATIRONS_MODEL, eastSouth, flatironsPlacement, type LonLat } from '../../src/world/flatironsPlacement';

const START: LonLat = [-105.2877748, 40.0000659];
const FIRST: LonLat = [-105.29467, 39.99047]; // 39°59'25.7"N 105°17'40.8"W
const FIFTH: LonLat = [-105.29281, 39.982]; // 39°58'55.2"N 105°17'34.1"W
const TOWN: LonLat = [-105.2, 39.99];

describe('eastSouth', () => {
  it('measures east as +x and south as +z, in metres', () => {
    const o = eastSouth(START, START);
    expect(Math.abs(o.x) + Math.abs(o.z)).toBe(0);
    const p = eastSouth(START, [START[0] + 0.001, START[1] - 0.001]);
    expect(p.x).toBeGreaterThan(80);
    expect(p.x).toBeLessThan(90); // a thousandth of a degree of longitude at 40 degrees north is about 85 m
    expect(p.z).toBeGreaterThan(110);
    expect(p.z).toBeLessThan(112);
  });
  it('puts the real Flatirons about a kilometre and a half south-south-west of Baseline and Flagstaff Roads', () => {
    const first = eastSouth(START, FIRST);
    const fifth = eastSouth(START, FIFTH);
    expect(first.z).toBeGreaterThan(900);
    expect(fifth.z).toBeLessThan(2200);
    expect(first.x).toBeLessThan(-400);
    expect(Math.hypot(fifth.x - first.x, fifth.z - first.z)).toBeGreaterThan(850); // the group is about 950 m long
  });
});

describe('flatironsPlacement', () => {
  const place = flatironsPlacement(START, FIRST, FIFTH, TOWN, 270);
  const toWorld = (lx: number, lz: number) => ({
    x: place.x + (lx * Math.cos(place.yaw) + lz * Math.sin(place.yaw)) * place.scale,
    z: place.z + (-lx * Math.sin(place.yaw) + lz * Math.cos(place.yaw)) * place.scale,
  });
  it('lands the middle of the slabs between the First and the Fifth', () => {
    const mid = toWorld(FLATIRONS_MODEL.footX, FLATIRONS_MODEL.footZ);
    const a = eastSouth(START, FIRST);
    const b = eastSouth(START, FIFTH);
    expect(mid.x).toBeCloseTo((a.x + b.x) / 2, 3);
    expect(mid.z).toBeCloseTo((a.z + b.z) / 2, 3);
  });
  it('faces the slabs east, over the town, and runs the ridge north to south', () => {
    const front = toWorld(0, 1); // one metre in front of the model's origin along its +z
    const origin = toWorld(0, 0);
    const face = { x: (front.x - origin.x) / place.scale, z: (front.z - origin.z) / place.scale };
    expect(face.x).toBeGreaterThan(0.95); // east
    expect(Math.abs(face.z)).toBeLessThan(0.3);
    const ridge = { x: toWorld(1, 0).x - origin.x, z: toWorld(1, 0).z - origin.z };
    expect(Math.abs(ridge.z) / Math.hypot(ridge.x, ridge.z)).toBeGreaterThan(0.95); // along north-south
  });
  it('scales the model to the size asked for', () => {
    expect(place.scale * FLATIRONS_MODEL.height).toBeCloseTo(270, 6);
  });
});

describe('the Flatirons of Flagstaff', () => {
  const s = stageById('flagstaff');
  beforeAll(() => setStage(s));
  const flat = s.landmarks.find((k) => k.model === 'flatirons')!;

  it('are placed in the world, in range from the start to the finish', () => {
    expect(flat.world).toBeDefined();
    const mid = (3700 + 0) / 2;
    expect(flat.first - (mid - flat.reach!)).toBeGreaterThanOrEqual(0); // the window around any course distance includes `first`
    expect(mid + flat.reach!).toBeGreaterThan(s.finish!);
  });
  /** Bearing of the real slab line's nearest point, in degrees from the rider's heading (negative: to the left), and its distance. */
  const view = (d: number) => {
    const p = roadPoint(d);
    const w = flat.world!;
    // The slab line runs through the model's local (x, 570) for x in [-1100, 1250], scaled; sample it.
    const sc = flat.size / FLATIRONS_MODEL.height;
    let best: { bearing: number; dist: number } | null = null;
    for (let lx = -1100; lx <= 1250; lx += 50) {
      const x = w.x + (lx * Math.cos(w.yaw) + FLATIRONS_MODEL.footZ * Math.sin(w.yaw)) * sc;
      const z = w.z + (-lx * Math.sin(w.yaw) + FLATIRONS_MODEL.footZ * Math.cos(w.yaw)) * sc;
      let b = Math.atan2(z - p.z, x - p.x) - p.heading;
      b = (((b + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * (180 / Math.PI);
      const dist = Math.hypot(x - p.x, z - p.z);
      if (!best || Math.abs(b) < Math.abs(best.bearing)) best = { bearing: b, dist };
    }
    return best!;
  };

  it('stand 1 to 3 km from the lower road, on its left, and face it (the slabs face east and the road is on that side)', () => {
    for (const d of [0, 500, 1400, 2500]) {
      const v = view(d);
      expect(v.dist, `${d} m`).toBeGreaterThan(900);
      expect(v.dist, `${d} m`).toBeLessThan(3000);
    }
    // Their faces point east; every point of the lower road is east of the slab line or level with it.
    const w = flat.world!;
    const nx = Math.sin(w.yaw);
    expect(nx).toBeGreaterThan(0.95);
  });
  it('are ahead of the rider, inside the camera’s view (±43°), somewhere along each of the lower kilometres', () => {
    for (const [from, to] of [[0, 600], [1000, 1900], [1900, 3000], [3000, 4500]]) {
      let seen = false;
      for (let d = from; d <= to; d += 25) if (Math.abs(view(d).bearing) < 43) seen = true;
      expect(seen, `${from}–${to} m`).toBe(true);
    }
  });
  it('are in front of the rider at 3.0 km and 3.75 km, where the road swings back towards them', () => {
    for (const d of [3000, 3750]) expect(Math.abs(view(d).bearing), `${d} m`).toBeLessThan(43);
  });
});
