import { describe, expect, it } from 'vitest';
import { ensureRoad, roadPoint, setStage } from '../../src/course';
import { stageById } from '../../src/stages';
import { TIERS } from '../../src/world/quality';
import {
  BANDS, CELL, LAT_MAX, LAT_MIN, bushGeometry, candidateCount, cellCentre, densityAt, flowerGeometry, patchAt, pickCover, planCell,
  stoneGeometry, triangles, tuftGeometry, type Cell, type CoverItem, type GroundAt, type Kind,
} from '../../src/world/groundCover';
import { LAYER, LAYER_COUNT, SCENERY } from '../../src/world/scenery';
import { groundProbe, groundSampler } from '../../src/world/terrain';

// A straight road along +x with flat ground whose make-up the test chooses.
const straight = (d: number) => ({ x: d, z: 0, heading: 0 });
const flat = (layer: number, h = 0): GroundAt => (x, z, w) => { w.fill(0); w[layer] = 1; return { h, roadDist: Math.abs(z) }; };
const mixed = (weights: Record<number, number>): GroundAt => (x, z, w) => { w.fill(0); for (const [k, v] of Object.entries(weights)) w[Number(k)] = v; return { h: 0, roadDist: Math.abs(z) }; };
const opts = { share: 1, seed: 7, desert: false };

const count = (items: CoverItem[]) => {
  const n: Record<Kind, number> = { tuft: 0, flower: 0, stone: 0, bush: 0 };
  for (const it of items) n[it.kind]++;
  return n;
};
/** Items of a run of cells on one side of the road, all bands. */
const strip = (ground: GroundAt, o = opts, k0 = 0, k1 = 30, side: 1 | -1 = 1) => {
  const out: CoverItem[] = [];
  for (let k = k0; k < k1; k++) for (let band = 0; band < BANDS; band++) out.push(...planCell({ k, side, band }, o, straight, ground));
  return out;
};

describe('density', () => {
  it('is thickest at the edge of the verge and thins to nothing at 30 m', () => {
    expect(densityAt(LAT_MIN)).toBeGreaterThan(1);
    expect(densityAt(10)).toBeLessThan(densityAt(LAT_MIN));
    expect(densityAt(20)).toBeLessThan(densityAt(10));
    expect(densityAt(LAT_MAX)).toBe(0);
    expect(densityAt(50)).toBe(0);
  });
  it('keeps patchiness in range and varies it', () => {
    const v = Array.from({ length: 200 }, (_, i) => patchAt(i * 3.1, (i % 7) * 4 + 6));
    for (const p of v) { expect(p).toBeGreaterThanOrEqual(0.12); expect(p).toBeLessThanOrEqual(1); }
    expect(Math.max(...v) - Math.min(...v)).toBeGreaterThan(0.3);
  });
  it('tries more candidates in the verge band than further out', () => {
    expect(candidateCount(0)).toBeGreaterThan(candidateCount(1));
    expect(candidateCount(1)).toBeGreaterThan(candidateCount(2));
    expect(candidateCount(2)).toBeGreaterThan(0);
  });
});

describe('planning a cell', () => {
  const cell: Cell = { k: 12, side: 1, band: 0 };
  it('is the same every time, and a lower share keeps a subset of the same items', () => {
    const a = planCell(cell, opts, straight, flat(LAYER.grass));
    const b = planCell(cell, opts, straight, flat(LAYER.grass));
    expect(a.length).toBeGreaterThan(20);
    expect(b).toEqual(a);
    const half = planCell(cell, { ...opts, share: 0.5 }, straight, flat(LAYER.grass));
    expect(half.length).toBeGreaterThan(a.length * 0.3);
    expect(half.length).toBeLessThan(a.length * 0.75);
    const keys = new Set(a.map((i) => `${i.x.toFixed(4)},${i.z.toFixed(4)}`));
    for (const i of half) expect(keys.has(`${i.x.toFixed(4)},${i.z.toFixed(4)}`)).toBe(true);
  });
  it('stays inside its cell and its band, outside the shoulder', () => {
    for (let band = 0; band < BANDS; band++) {
      const items = planCell({ k: 3, side: -1, band }, opts, straight, flat(LAYER.grass));
      for (const i of items) {
        expect(i.x).toBeGreaterThanOrEqual(3 * CELL);
        expect(i.x).toBeLessThan(4 * CELL);
        expect(-i.z).toBeGreaterThanOrEqual(LAT_MIN);
        expect(-i.z).toBeLessThanOrEqual(LAT_MAX);
      }
    }
  });
  it('thins out away from the road', () => {
    const items = strip(flat(LAYER.grass));
    const near = items.filter((i) => i.z < 12).length;
    const far = items.filter((i) => i.z >= 12 && i.z < 21).length;
    const edge = items.filter((i) => i.z >= 21).length;
    expect(near).toBeGreaterThan(far * 1.5);
    expect(far).toBeGreaterThan(edge);
    expect(edge).toBeGreaterThan(0);
  });
  it('differs between cells, sides and seeds', () => {
    const a = planCell(cell, opts, straight, flat(LAYER.grass));
    expect(planCell({ ...cell, k: 13 }, opts, straight, flat(LAYER.grass)).map((i) => i.yaw)).not.toEqual(a.map((i) => i.yaw));
    expect(planCell(cell, { ...opts, seed: 8 }, straight, flat(LAYER.grass)).map((i) => i.yaw)).not.toEqual(a.map((i) => i.yaw));
  });
  it('puts every item on the ground it was given', () => {
    for (const i of planCell(cell, opts, straight, flat(LAYER.grass, 12.5))) {
      if (i.kind === 'stone') expect(i.y).toBeGreaterThan(12.5 - 0.01);
      expect(Math.abs(i.y - 12.5)).toBeLessThan(0.3);
    }
  });
  it('skips ground that is really the road, or nearer another stretch of road', () => {
    const onRoad: GroundAt = (x, z, w) => { w.fill(0); w[LAYER.grass] = 1; return { h: 0, roadDist: 3 }; };
    expect(planCell(cell, opts, straight, onRoad)).toEqual([]);
    const otherLeg: GroundAt = (x, z, w) => { w.fill(0); w[LAYER.grass] = 1; return { h: 0, roadDist: 7 }; };
    expect(planCell({ k: 1, side: 1, band: 2 }, opts, straight, otherLeg)).toEqual([]); // 14 to 22 m out but 7 m from another road
  });
});

describe('what grows where', () => {
  it('puts green tufts and a few wildflowers on grass', () => {
    const n = count(strip(flat(LAYER.grass)));
    expect(n.tuft).toBeGreaterThan(100);
    expect(n.flower).toBeGreaterThan(0);
    expect(n.flower).toBeLessThan(n.tuft * 0.3);
    expect(n.bush).toBe(0);
  });
  it('colours grass tufts green and wildflowers white, yellow or purple', () => {
    const items = strip(flat(LAYER.grass));
    const green = (c: string) => { const v = parseInt(c.slice(1), 16); return ((v >> 8) & 255) > ((v >> 16) & 255) && ((v >> 8) & 255) > (v & 255); };
    for (const t of items.filter((i) => i.kind === 'tuft')) expect(green(t.color)).toBe(true);
    const flowers = new Set(items.filter((i) => i.kind === 'flower').map((i) => i.color));
    for (const c of flowers) expect(['#f6f6ee', '#f2cf2e', '#8a56c8']).toContain(c);
    expect(flowers.size).toBeGreaterThanOrEqual(2);
  });
  it('puts straw-coloured tufts on dry grass and fields', () => {
    const tufts = strip(flat(LAYER.dry)).filter((i) => i.kind === 'tuft');
    expect(tufts.length).toBeGreaterThan(50);
    for (const t of tufts) { const v = parseInt(t.color.slice(1), 16); expect((v >> 16) & 255).toBeGreaterThan(v & 255); } // red above blue: yellow-brown, not green
  });
  it('is sparse on the dirt verge, with pebbles and a few tufts', () => {
    const dirt = count(strip(flat(LAYER.dirt)));
    const grass = count(strip(flat(LAYER.grass)));
    expect(dirt.stone).toBeGreaterThan(dirt.tuft);
    expect(dirt.tuft + dirt.stone).toBeLessThan((grass.tuft + grass.flower + grass.stone) * 0.85);
    expect(dirt.tuft).toBeGreaterThan(0);
  });
  it('puts stones and tiny alpine flowers on rock', () => {
    const items = strip(flat(LAYER.rock));
    const n = count(items);
    expect(n.stone).toBeGreaterThan(n.flower * 2);
    expect(n.flower).toBeGreaterThan(0);
    expect(n.tuft).toBeLessThan(n.stone * 0.2);
    const grassFlower = strip(flat(LAYER.grass)).find((i) => i.kind === 'flower')!;
    const alpine = items.find((i) => i.kind === 'flower')!;
    expect(alpine.sy).toBeLessThan(grassFlower.sy);
  });
  it('plants nothing on snow, and thins out where it is half snow', () => {
    expect(strip(flat(LAYER.snow))).toEqual([]);
    const half = strip(mixed({ [LAYER.grass]: 0.5, [LAYER.snow]: 0.5 })).length;
    const full = strip(flat(LAYER.grass)).length;
    expect(half).toBeGreaterThan(full * 0.3);
    expect(half).toBeLessThan(full * 0.7);
  });
  it('plants sage bushes and red stones in the desert, nothing green', () => {
    const items = strip(flat(LAYER.sandstone), { ...opts, desert: true });
    const n = count(items);
    expect(n.bush + n.stone).toBe(items.length);
    expect(n.bush).toBeGreaterThan(0);
    expect(n.stone).toBeGreaterThan(0);
    const sage = strip(flat(LAYER.dry), { ...opts, desert: true });
    expect(count(sage).bush / sage.length).toBeGreaterThan(count(items).bush / items.length); // more bushes on the sage patches
    expect(items.filter((i) => i.kind === 'stone').every((i) => ['#a9482b', '#8c3b25', '#b9643b', '#9a5236'].includes(i.color))).toBe(true);
  });
  it('picks nothing when there is no ground at all', () => {
    expect(pickCover(new Array(LAYER_COUNT).fill(0), false, 0, 0.5, 0.5, 0.5, 0.5)).toBeNull();
  });
});

describe('on real stages', () => {
  it('sits on the terrain the tiles are built from, beside the road, and is the same on a second run', () => {
    const stage = stageById('heartland');
    setStage(stage);
    ensureRoad(4000);
    const cell: Cell = { k: 300, side: 1, band: 0 }; // 3 km along
    const c = { x: 0, z: 0 };
    cellCentre(cell, roadPoint, c);
    const probe = groundProbe(c.x - 20, c.x + 20, c.z - 20, c.z + 20);
    const items = planCell(cell, { ...opts, seed: 99 }, roadPoint, probe);
    expect(items.length).toBeGreaterThan(20);
    const sample = groundSampler(c.x - 20, c.x + 20, c.z - 20, c.z + 20);
    for (const i of items) {
      expect(Math.abs(i.y - sample(i.x, i.z))).toBeLessThan(0.3); // sunk 3 cm for blades, stones sit a little above
    }
    expect(planCell(cell, { ...opts, seed: 99 }, roadPoint, probe)).toEqual(items);
  });
  it('keeps off the other stretch of road on a hairpin climb', () => {
    const stage = stageById('alpe-dhuez');
    setStage(stage);
    ensureRoad(9000);
    const probe = groundProbe(-4000, 4000, -4000, 4000);
    const w = new Array(LAYER_COUNT).fill(0);
    let seen = 0;
    for (let k = 20; k < 60; k++) {
      for (const side of [-1, 1] as const) {
        for (let band = 0; band < BANDS; band++) {
          for (const i of planCell({ k, side, band }, { ...opts, seed: 3 }, roadPoint, probe)) {
            seen++;
            expect(probe(i.x, i.z, w).roadDist).toBeGreaterThan(LAT_MIN - 0.4);
          }
        }
      }
    }
    expect(seen).toBeGreaterThan(200);
  });
  it('grows red stones and sage in the Tour of the Moon,', () => {
    const moon = stageById('hotw-tour-of-the-moon');
    setStage(moon);
    ensureRoad(3000);
    const c = { x: 0, z: 0 };
    const cell: Cell = { k: 100, side: -1, band: 0 };
    cellCentre(cell, roadPoint, c);
    const probe = groundProbe(c.x - 20, c.x + 20, c.z - 20, c.z + 20);
    const n = count(planCell(cell, { ...opts, desert: true }, roadPoint, probe));
    expect(n.tuft + n.flower).toBe(0);
    expect(n.bush + n.stone).toBeGreaterThan(5);
  });
});

describe('geometry', () => {
  it('keeps a tuft to a few dozen triangles, with the colour and tint a plant needs', () => {
    const g = tuftGeometry();
    expect(triangles(g)).toBeGreaterThanOrEqual(12);
    expect(triangles(g)).toBeLessThanOrEqual(24);
    for (const name of ['position', 'normal', 'color', 'aTint']) expect(g.getAttribute(name)).toBeDefined();
    expect(g.getAttribute('aTint').count).toBe(g.getAttribute('position').count);
    g.computeBoundingBox();
    expect(g.boundingBox!.min.y).toBeGreaterThanOrEqual(0);
    expect(g.boundingBox!.max.y).toBeGreaterThan(0.25);
    expect(g.boundingBox!.max.y).toBeLessThan(0.7);
    // darker at the base than the tip
    const col = g.getAttribute('color'), pos = g.getAttribute('position');
    let base = 0, tip = 0;
    for (let i = 0; i < pos.count; i++) { if (pos.getY(i) === 0) base = Math.max(base, col.getX(i)); else tip = Math.max(tip, col.getX(i)); }
    expect(base).toBeLessThan(tip);
  });
  it('builds a flower with an untinted stem and a tinted head, a stone and a bush', () => {
    const f = flowerGeometry();
    const tint = f.getAttribute('aTint');
    const values = new Set(Array.from({ length: tint.count }, (_, i) => tint.getX(i)));
    expect(values).toEqual(new Set([0, 1]));
    expect(triangles(f)).toBeLessThan(30);
    expect(triangles(stoneGeometry())).toBe(20);
    expect(triangles(bushGeometry())).toBe(60);
  });
});

describe('the tier flag', () => {
  it('is off on Low and Medium, half on High and full on Ultra', () => {
    expect(SCENERY.low.groundCover).toBe(0);
    expect(SCENERY.medium.groundCover).toBe(0);
    expect(SCENERY.high.groundCover).toBe(0.5);
    expect(SCENERY.ultra.groundCover).toBe(1);
    const shares = TIERS.map((t) => SCENERY[t].groundCover);
    expect([...shares].sort((a, b) => a - b)).toEqual(shares);
  });
});
