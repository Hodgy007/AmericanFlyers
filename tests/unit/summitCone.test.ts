// The bare summit cone (world/summitCone.ts) and Mount Washington's use of it: the ground falls away from the
// summit so the buildings are not hidden, and the buildings stand where the cone's top is.
import { beforeAll, describe, expect, it } from 'vitest';
import { roadPoint, setStage } from '../../src/course';
import { stageById } from '../../src/stages';
import { basinHeight, coneHeight, roadXZ, summitCone } from '../../src/world/summitCone';

describe('coneHeight', () => {
  it('is level to the flat radius, then falls at the slope', () => {
    expect(coneHeight(100, 0, 50, 0.5)).toBe(100);
    expect(coneHeight(100, 50, 50, 0.5)).toBe(100);
    expect(coneHeight(100, 250, 50, 0.5)).toBeCloseTo(0, 9);
  });
});

describe('summitCone', () => {
  const heading = () => 0; // a straight road along +x
  const elevation = (d: number) => d * 0.1;
  const cone = summitCone({ d: 1000, side: 1, offset: 40, rise: 5, flat: 30, slope: 0.5, fadeFrom: 300, fadeTo: 900 }, heading, elevation);
  // Heading 0 is +x, so "right" (side +1) is -sin(0)*off = 0 in x and +cos(0)*off = +40 in z.
  const top = { x: 1000, z: 40 };

  it('puts the top where a landmark with that side and offset stands, rise above the road', () => {
    expect(roadXZ(heading, 1000).x).toBeCloseTo(1000, 6);
    expect(cone(top.x, top.z, 777)).toBeCloseTo(elevation(1000) + 5, 6);
  });
  it('falls away on every side, steeply near the top', () => {
    const at = (dx: number, dz: number) => cone(top.x + dx, top.z + dz, 1e4 /* the wild ground is far higher */);
    for (const [dx, dz] of [[100, 0], [-100, 0], [0, 100], [0, -100]]) expect(at(dx, dz), `${dx},${dz}`).toBeLessThan(elevation(1000) + 5 - 25);
  });
  it('leaves the wild ground alone beyond its fade', () => {
    expect(cone(top.x + 950, top.z, 321)).toBe(321);
    expect(cone(top.x - 2000, top.z + 400, -50)).toBe(-50);
  });
  it('agrees with the road as course.ts integrates it, on a winding road', () => {
    const winding = (d: number) => Math.sin(d / 170) * 1.2;
    setStage({ ...stageById('heartland'), headingAt: winding, elevationAt: () => 0 });
    const p = roadPoint(778);
    const q = roadXZ(winding, 778);
    expect(q.x).toBeCloseTo(p.x, 6);
    expect(q.z).toBeCloseTo(p.z, 6);
    expect(q.heading).toBeCloseTo(p.heading, 9);
  });
});

describe('Mount Washington summit', () => {
  const s = stageById('mt-washington');
  beforeAll(() => setStage(s));
  const site = s.landmarks.find((k) => k.model === 'washington-summit')!;
  const place = (d: number, side: number, offset: number) => {
    const p = roadPoint(d);
    return { x: p.x - Math.sin(p.heading) * offset * side, z: p.z + Math.cos(p.heading) * offset * side };
  };

  /** Angle in degrees between the chase camera's heading `out` metres before the finish and the direction to the point `at`. */
  const bearing = (at: { x: number; z: number }, out: number) => {
    const p = roadPoint(s.finish! - out);
    let b = Math.atan2(at.z - p.z, at.x - p.x) - p.heading;
    b = ((b + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
    return Math.abs(b) * (180 / Math.PI);
  };

  it('has an unguarded road', () => {
    expect(s.scenery.barrier).toBe('none');
  });
  it('stands the buildings on the cone’s top, at about the height of the finish', () => {
    const at = place(site.first, site.side, site.offset);
    const top = s.elevationAt(s.finish!) + 3;
    expect(s.scenery.wildHeight(at.x, at.z)).toBeCloseTo(top, 0);
  });
  it('lets the ground fall away beside the last stretch of road instead of rising over it', () => {
    // On the outside of the last bends (the left) the wild ground is far below the road, 200 to 300 m out.
    for (const out of [200, 300]) {
      const at = place(s.finish! - 200, -1, out);
      expect(s.scenery.wildHeight(at.x, at.z)).toBeLessThan(s.elevationAt(s.finish! - 200) - 40);
    }
  });
  it('keeps the buildings and their knoll (26 m deep from the centre) off the road', () => {
    const at = place(site.first, site.side, site.offset);
    for (let d = s.finish! - 300; d <= s.finish! + 100; d += 5) {
      const r = roadPoint(d);
      expect(Math.hypot(at.x - r.x, at.z - r.z), `road at ${d}`).toBeGreaterThan(26 + 10);
    }
  });
  it('is ahead of a rider in the last bend, and in the last 100 m', () => {
    // Bearing of the building from the rider relative to his heading: within the camera's view (about +-43 degrees) at 50 and 100 m out.
    const at = place(site.first, site.side, site.offset);
    for (const out of [50, 100, 400]) expect(bearing(at, out), `${out} m out`).toBeLessThan(43);
  });
  // The road wraps right round the summit, so the buildings are more than 50 degrees off the chase camera's heading at 200 m out
  // (no placement near the finish fixes that: the camera swings 100 degrees between 200 and 50 m). The broadcast tower
  // stands apart, on the outside of the bend and straight ahead of the last straight, so something is in frame at every distance.
  it('has the broadcast tower in frame at 400, 200 and 100 m out, off the road and in line with the last straight', () => {
    const tower = s.landmarks.find((k) => k.model === 'washington-tower')!;
    const at = place(tower.first, tower.side, tower.offset);
    for (const out of [400, 200, 100]) expect(bearing(at, out), `${out} m out`).toBeLessThan(43);
    for (let d = s.finish! - 500; d <= s.finish! + 100; d += 10) {
      const r = roadPoint(d);
      expect(Math.hypot(at.x - r.x, at.z - r.z), `road at ${d}`).toBeGreaterThan(30);
    }
  });
  it('has something of the summit in frame at every one of 400, 200, 100 and 50 m out', () => {
    const sites = s.landmarks.filter((k) => k.model === 'washington-summit' || k.model === 'washington-tower').map((k) => place(k.first, k.side, k.offset));
    for (const out of [400, 200, 100, 50]) expect(Math.min(...sites.map((a) => bearing(a, out))), `${out} m out`).toBeLessThan(43);
  });
});

describe('basinHeight', () => {
  const basin = basinHeight({ x: 100, z: 200, radius: 500, fade: 1000, floor: 7 });
  it('is the floor inside the radius, the wild ground beyond the fade, and between them in between', () => {
    expect(basin(100, 200, 300)).toBe(7);
    expect(basin(600, 200, 300)).toBe(7);
    expect(basin(100 + 1500, 200, 300)).toBe(300);
    const mid = basin(100 + 1000, 200, 300);
    expect(mid).toBeGreaterThan(7);
    expect(mid).toBeLessThan(300);
  });
  it('sinks Flagstaff’s ground towards the Flatirons and not elsewhere', () => {
    const s = stageById('flagstaff');
    const b = s.scenery.wildHeight;
    // At the middle of the slab line the ground is at the basin's floor; far on the other side of the road it is the usual hills.
    expect(s.scenery.basin).toBeUndefined(); // the basin is a build option, not part of the finished scenery
    expect(b(-510, 1536)).toBeCloseTo(0, 6);
    expect(b(-6000, -4000)).toBeGreaterThan(-40);
  });
});
