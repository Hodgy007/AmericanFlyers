import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ensureRoad, setStage } from '../../src/course';
import { stageById } from '../../src/stages';
import { MONOLITHS, independenceGeometry, siteOf, triangleCount, type MonolithKind } from '../../src/world/monoliths';
import { RIM_ROCK_SECTIONS, canyonWeight } from '../../src/world/canyon';

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
  it('stands on the canyon side of the road, 150 to 600 m out', () => {
    for (const p of MONOLITHS[stage.id]) {
      const side = p.lateral < 0 ? -1 : 1;
      expect(canyonWeight(RIM_ROCK_SECTIONS, p.d, side)).toBe(1);
      expect(Math.abs(p.lateral)).toBeGreaterThanOrEqual(150);
      expect(Math.abs(p.lateral)).toBeLessThanOrEqual(600);
      const s = siteOf(p);
      expect(Number.isFinite(s.x + s.z + s.yaw)).toBe(true);
    }
  });
  it('puts Independence Monument at about km 8 to 9, the Kissing Couple near 10 and the Coke Ovens near 12', () => {
    const first = (k: MonolithKind) => MONOLITHS[stage.id].find((p) => p.kind === k)!.d;
    expect(first('independence')).toBeGreaterThan(8000);
    expect(first('independence')).toBeLessThan(9000);
    expect(first('kissing')).toBeGreaterThan(9500);
    expect(first('kissing')).toBeLessThan(11000);
    expect(first('coke')).toBeGreaterThan(11500);
    expect(first('coke')).toBeLessThan(12500);
  });
});
