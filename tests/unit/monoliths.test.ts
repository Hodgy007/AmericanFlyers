import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ensureRoad, setStage } from '../../src/course';
import { stageById } from '../../src/stages';
import { MONOLITHS, independenceGeometry, siteOf, triangleCount, type MonolithKind } from '../../src/world/monoliths';
import { RIM_ROCK_SECTIONS, canyonWeight, shapeAt } from '../../src/world/canyon';

describe('monolith geometry', () => {
  it('stays under 5,000 triangles each', () => {
    for (const k of ['independence', 'coke', 'kissing'] as MonolithKind[]) {
      const n = triangleCount(k);
      expect(n).toBeGreaterThan(300);
      expect(n).toBeLessThan(5000);
    }
  });
  it('is the same every time', () => {
    const a = independenceGeometry().attributes.position.array;
    const b = independenceGeometry().attributes.position.array;
    expect(Array.from(b)).toEqual(Array.from(a));
  });
  it('stands about 140 m tall, with banded vertex colours', () => {
    const g = independenceGeometry();
    g.computeBoundingBox();
    expect(g.boundingBox!.max.y).toBeGreaterThan(135);
    expect(g.boundingBox!.max.y).toBeLessThan(165);
    expect(g.boundingBox!.min.y).toBeLessThan(0); // sunk into the ground
    const c = g.attributes.color as THREE.BufferAttribute;
    const reds = new Set<string>();
    for (let i = 0; i < c.count; i += 7) reds.add(c.getX(i).toFixed(1));
    expect(reds.size).toBeGreaterThan(3);
  });
});

describe('monolith placement', () => {
  const stage = stageById('hotw-tour-of-the-moon');
  setStage(stage);
  ensureRoad(32000);
  const all = MONOLITHS[stage.id];
  it('stands on the canyon side of the road, in a canyon section', () => {
    for (const p of all) {
      const side = p.lateral < 0 ? -1 : 1;
      expect(canyonWeight(RIM_ROCK_SECTIONS, p.d, side)).toBe(1);
      const s = siteOf(p);
      expect(Number.isFinite(s.x + s.z + s.yaw)).toBe(true);
    }
  });
  it('stands on the canyon floor: past the talus and before the far wall rises', () => {
    for (const p of all) {
      const q = shapeAt(p.d, p.lateral < 0 ? -1 : 1);
      expect(Math.abs(p.lateral)).toBeGreaterThan(q.lip + q.cliffWidth + q.talusWidth + 20);
      expect(Math.abs(p.lateral)).toBeLessThan(q.floorEnd);
    }
  });
  it('puts the Coke Ovens, Kissing Couple and Independence Monument where the real ones are, in Monument Canyon', () => {
    // Real positions along the baked road (OpenStreetMap nodes projected onto it): Coke Ovens km 22.6,
    // Bell Tower (Kissing Couple) km 25.3, Independence Monument km 26.6, all on the right of the road.
    const at = (k: MonolithKind) => all.find((p) => p.kind === k)!;
    expect(at('coke').d).toBeGreaterThan(22500);
    expect(at('coke').d).toBeLessThan(22800);
    expect(at('kissing').d).toBeGreaterThan(25100);
    expect(at('kissing').d).toBeLessThan(25400);
    expect(at('independence').d).toBeGreaterThan(26400);
    expect(at('independence').d).toBeLessThan(26700);
    for (const p of all) expect(p.lateral).toBeGreaterThan(0);
    expect(all.map((p) => p.kind)).toEqual(['coke', 'kissing', 'independence']);
  });
});
