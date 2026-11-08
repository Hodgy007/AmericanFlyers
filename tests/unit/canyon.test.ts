import { describe, expect, it } from 'vitest';
import { ensureRoad, roadPoint, setStage } from '../../src/course';
import { stageById } from '../../src/stages';
import { barrierSections } from '../../src/world/barriers';
import { REACH, RIM_ROCK_SECTIONS, canyonWeight, makeRoadside, shapeAt } from '../../src/world/canyon';
import { groundSampler, roadsideSlope } from '../../src/world/terrain';

const hook = makeRoadside(RIM_ROCK_SECTIONS);
const plain = 0; // flat wild terrain level with the road

describe('canyon sections', () => {
  it('has no opinion on the plateau, and none on the left in a right-only stretch', () => {
    expect(hook(3000, -20, plain)).toBeNull();
    expect(hook(18500, 30, plain)).toBeNull(); // Black Ridge: level on both sides
    expect(hook(18500, -30, plain)).toBeNull();
    expect(hook(36500, 30, plain)).toBeNull(); // the valley floor near Fruita
    expect(canyonWeight(RIM_ROCK_SECTIONS, 9000, 1)).toBe(1);
    expect(canyonWeight(RIM_ROCK_SECTIONS, 9000, -1)).toBe(0);
  });
  it('keeps Monument Canyon on the right (the Grand Valley side) from Artists Point to Independence Monument View', () => {
    for (const d of [22500, 24700, 26500, 27300, 28500]) {
      expect(canyonWeight(RIM_ROCK_SECTIONS, d, 1)).toBe(1);
      expect(canyonWeight(RIM_ROCK_SECTIONS, d, -1)).toBe(0);
    }
  });
  it('puts the drop on the left only on the switchbacks above Monument Road and down Fruita Canyon', () => {
    for (const d of [6200, 32500, 33500]) expect(canyonWeight(RIM_ROCK_SECTIONS, d, -1)).toBe(1);
    for (const d of [7000, 9000, 12000, 15000, 25000, 31000]) expect(canyonWeight(RIM_ROCK_SECTIONS, d, -1)).toBe(0);
  });
  it('is cliff-free across the visitor center plateau', () => {
    expect(canyonWeight(RIM_ROCK_SECTIONS, 29400, 1)).toBeLessThan(0.1);
    expect(canyonWeight(RIM_ROCK_SECTIONS, 29400, -1)).toBe(0);
  });
  it('is continuous along the course, across section boundaries', () => {
    for (const s of [-1, 1]) for (const lat of [8, 14, 40, 90, 200, 350, 600]) {
      for (let d = 4000; d < 37000; d += 4) {
        const a = hook(d, lat * s, plain) ?? plain;
        const b = hook(d + 4, lat * s, plain) ?? plain;
        expect(Math.abs(a - b)).toBeLessThan(12);
      }
    }
  });
});

describe('the canyon beside the road', () => {
  const d = 9000; // right canyon, left side rises
  const p = shapeAt(d, 1);
  it('keeps a level ledge to the lip, 10 to 13 m from the centreline', () => {
    expect(p.lip).toBeGreaterThan(10);
    expect(p.lip).toBeLessThan(13);
    for (const s of [0, 3, 6, 9, p.lip - 0.1]) expect(hook(d, s, plain)).toBeCloseTo(0, 6);
  });
  it('drops 120 to 220 m in a cliff, then a talus slope to a floor', () => {
    for (let k = 0; k < 40; k++) {
      const q = shapeAt(7500 + k * 600, k % 2 ? 1 : -1);
      expect(q.cliff).toBeGreaterThanOrEqual(120);
      expect(q.cliff).toBeLessThanOrEqual(220);
    }
    const base = p.lip + p.cliffWidth;
    expect(-hook(d, base + 1, plain)!).toBeGreaterThan(p.cliff - 1);
    const floor = hook(d, base + p.talusWidth + 100, plain)!;
    expect(-floor).toBeGreaterThan(p.cliff + p.talus - 6);
  });
  it('rises back to the wild terrain far out', () => {
    expect(hook(d, p.floorEnd + p.wallWidth + 1, 37)).toBeCloseTo(37, 6);
    expect(REACH).toBeGreaterThan(p.floorEnd + p.wallWidth);
  });
  it('climbs in ledges on the other side, then blends to the wild terrain', () => {
    const q = shapeAt(d, -1);
    expect(hook(d, -60, plain)!).toBeGreaterThan(5);
    expect(hook(d, -(9 + q.rise + 5), plain)!).toBeCloseTo(q.rise, 0);
    expect(hook(d, -400, plain)!).toBeCloseTo(0, 6);
  });
});

describe('on the Tour of the Moon', () => {
  const stage = stageById('hotw-tour-of-the-moon');
  setStage(stage);
  ensureRoad(34000);
  it('gets barriers along the canyon edge, on the canyon side only', () => {
    const p = roadPoint(8500);
    const ground = groundSampler(p.x - 140, p.x + 140, p.z - 140, p.z + 140);
    const secs = barrierSections(stage, 8400, 8600, ground);
    expect(secs.length).toBeGreaterThan(40);
    expect(secs.every((s) => s.side === 1)).toBe(true);
  });
  it('reads the cliff face as steep and the ledge as flat', () => {
    const d = 8500;
    const p = roadPoint(d);
    const at = (lat: number) => {
      const x = p.x - Math.sin(p.heading) * lat;
      const z = p.z + Math.cos(p.heading) * lat;
      return roadsideSlope(x, z, { dist: Math.abs(lat), d, lateral: lat });
    };
    const q = shapeAt(d, 1);
    expect(at(5)).toBeLessThan(0.05);
    expect(Math.max(...Array.from({ length: 30 }, (_, i) => at(q.lip + 1 + i)))).toBeGreaterThan(1);
  });
});
