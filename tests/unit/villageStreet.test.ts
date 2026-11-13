import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { STAGES, stageById } from '../../src/stages';
import { buildTerrace } from '../../src/world/monumentCity';
import { triangleCount } from '../../src/world/monumentKit';
import { VALE_ARCH } from '../../src/world/monumentTypes';
import { buildMonument } from '../../src/world/monuments';
import { VILLAGE_MAX_WIDTH, planVillageTerrace, villageTerraceHeight } from '../../src/world/terracePlan';
import { KESTREL_VALE, KESTREL_ROUTES, KV_LAP } from '../../src/worlds/kestrelVale';

// Kestrel Vale's village arch (`vale-arch`) and its varied terrace rows (`terrace` with `village: true`): their geometry, that the other worlds' terraces and arches are untouched,
// and that nothing in the square or the high street intersects the arch.

const bounds = (g: THREE.Object3D) => new THREE.Box3().setFromObject(g);
const stats = (g: THREE.Group) => {
  const b = bounds(g);
  const pos = (g.children[0] as THREE.Mesh).geometry.attributes.position;
  let sum = 0;
  for (let i = 0; i < pos.count * 3; i++) sum += pos.array[i] * (1 + (i % 7));
  return { tris: triangleCount(g), min: b.min.toArray().map((v) => +v.toFixed(3) + 0), max: b.max.toArray().map((v) => +v.toFixed(3) + 0), sum };
};

describe('Richmond’s and Harrogate’s terraces are exactly as they were', () => {
  // Geometry stats (triangles, bounding box, a position checksum) recorded from the builder before `village` existed.
  const BEFORE: [('brick' | 'stone'), number, number, number[], number[], number][] = [
    ['brick', 1, 846, [-16.6, 0, -4.95], [16.6, 14, 5.7], 96565.72],
    ['brick', 2, 570, [-11.2, 0, -4.95], [11.2, 14, 5.7], 65516.43],
    ['brick', 3, 714, [-13.9, 0, -4.95], [13.9, 14, 5.7], 83263.59],
    ['stone', 1, 846, [-16.6, 0, -4.95], [16.6, 13.6, 5.7], 93028.52],
    ['stone', 2, 570, [-11.2, 0, -4.95], [11.2, 13.6, 5.7], 63130.03],
    ['stone', 3, 714, [-13.9, 0, -4.95], [13.9, 13.6, 5.7], 80272.39],
  ];
  for (const [material, seed, tris, min, max, sum] of BEFORE) {
    it(`${material} seed ${seed}: ${tris} triangles, the same box and the same vertices`, () => {
      const s = stats(buildTerrace({ seed, material }));
      expect(s.tris).toBe(tris);
      expect(s.min).toEqual(min);
      expect(s.max).toEqual(max);
      expect(s.sum).toBeCloseTo(sum, 1);
    });
  }

  it('their stages’ rows do not ask for the village layout and keep the 14 m size', () => {
    for (const st of STAGES.filter((s) => !s.world)) {
      for (const k of st.landmarks.filter((l) => l.model === 'terrace')) {
        expect(k.options, st.id).not.toHaveProperty('village');
        expect(k.size, st.id).toBe(14);
      }
    }
  });

  it('and every other stage keeps the stars-and-stripes gantry for its start and finish', () => {
    for (const st of STAGES.filter((s) => !s.world)) {
      expect(st.landmarks.filter((l) => l.model === 'vale-arch'), st.id).toHaveLength(0);
      expect(st.landmarks.some((l) => l.file === 'gantry.glb'), st.id).toBe(true);
    }
  });
});

describe('the village terraces of the high street and the run-in', () => {
  const rows = KESTREL_VALE.landmarks.filter((k) => k.model === 'terrace');
  const seeds = rows.map((k) => k.options!.seed!);

  it('are 22 kinds with their own seed, as many placed as before (a row every 44 m), none asked for twice', () => {
    expect(rows).toHaveLength(22);
    expect(new Set(seeds).size, 'every row has its own seed').toBe(22);
    for (const k of rows) expect(k.options).toMatchObject({ material: 'stone', village: true });
    for (const k of rows) expect((k.first - (k.first > KV_LAP / 2 ? KV_LAP - 440 : 66)) % 44, 'on the 44 m pitch of its street').toBeCloseTo(0, 6);
  });

  it('are built at their natural height (not stretched), which differs from row to row', () => {
    const heights = new Set<number>();
    for (const k of rows) {
      const g = buildTerrace(k.options);
      expect(bounds(g).max.y, `seed ${k.options!.seed}`).toBeCloseTo(villageTerraceHeight(k.options!.seed!), 3);
      expect(k.size).toBeCloseTo(villageTerraceHeight(k.options!.seed!), 6);
      heights.add(Math.round(k.size));
      expect(bounds(g).min.y).toBeGreaterThan(-0.001);
    }
    expect(heights.size, `heights ${[...heights]}`).toBeGreaterThanOrEqual(2);
  });

  it('stay within the triangle budget per building (a little over Richmond’s 850, well under the 6,000 cap)', () => {
    for (const k of rows) {
      const tris = triangleCount(buildTerrace(k.options));
      expect(tris, `seed ${k.options!.seed}`).toBeLessThan(2200);
      expect(tris).toBeGreaterThan(500);
    }
  });

  it('keep the middle of the row (under the bunting’s string) on a house, and the row’s ends clear of the inn and the next row', () => {
    for (const k of rows) {
      const plan = planVillageTerrace(k.options!.seed!);
      const mid = plan.houses.find((h) => h.x0 <= 0 && h.x0 + h.w >= 0)!;
      expect(mid, `seed ${k.options!.seed}`).toBeDefined();
      expect(mid.storeys, 'a full house, not a cottage').toBeGreaterThan(1);
      expect(plan.x1 - plan.x0).toBeLessThanOrEqual(VILLAGE_MAX_WIDTH);
      expect(plan.x0).toBeGreaterThanOrEqual(-VILLAGE_MAX_WIDTH / 2 - 0.7);
      expect(plan.x1).toBeLessThanOrEqual(VILLAGE_MAX_WIDTH / 2 + 0.7);
    }
  });

  it('read as a street, not as copies: storeys of two and three, low cottages, ginnels and shops all occur, and no two rows on a street are the same', () => {
    const plans = rows.map((k) => planVillageTerrace(k.options!.seed!));
    const houses = plans.flatMap((p) => p.houses);
    expect(houses.some((h) => h.storeys === 2)).toBe(true);
    expect(houses.some((h) => h.storeys === 3)).toBe(true);
    expect(houses.filter((h) => h.storeys === 1).length, 'cottages').toBeGreaterThanOrEqual(2);
    expect(houses.filter((h) => h.shop).length, 'shopfronts').toBeGreaterThanOrEqual(2);
    expect(plans.filter((p) => p.ginnels.length).length, 'rows with a ginnel').toBeGreaterThanOrEqual(3);
    expect(new Set(houses.map((h) => h.door)).size, 'door colours').toBeGreaterThanOrEqual(6);
    expect(new Set(houses.map((h) => h.frame)).size, 'frame colours').toBeGreaterThanOrEqual(5);
    expect(plans.filter((p) => p.runs.length >= 3).length, 'rows whose ridge steps at least twice').toBeGreaterThanOrEqual(5);
    const sig = (p: ReturnType<typeof planVillageTerrace>) => `${p.houses.map((h) => `${h.storeys}${h.shop ? 's' : ''}${h.w.toFixed(1)}`).join('.')}|${p.chimneys.map((c) => c.x.toFixed(1)).join(',')}`;
    expect(new Set(plans.map(sig)).size, 'every row has its own layout').toBe(plans.length);
    // Along each side of a street, consecutive rows differ in more than colour: the number of houses or the storeys.
    for (const side of [-1, 1]) for (const run of [(k: (typeof rows)[number]) => k.first < KV_LAP / 2, (k: (typeof rows)[number]) => k.first > KV_LAP / 2]) {
      const row = rows.filter((k) => k.side === side && run(k)).sort((a, b) => a.first - b.first).map((k) => planVillageTerrace(k.options!.seed!));
      for (let i = 1; i < row.length; i++) {
        const shape = (p: (typeof row)[number]) => p.houses.map((h) => h.storeys).join('') + p.ginnels.length;
        expect(shape(row[i]), `rows ${i - 1} and ${i}`).not.toBe(shape(row[i - 1]));
      }
    }
  });

  it('give the same row for the same seed, and a different one for another', () => {
    expect(stats(buildTerrace({ seed: 14, material: 'stone', village: true }))).toEqual(stats(buildTerrace({ seed: 14, material: 'stone', village: true })));
    expect(stats(buildTerrace({ seed: 14, material: 'stone', village: true })).sum).not.toBe(stats(buildTerrace({ seed: 3, material: 'stone', village: true })).sum);
  });
});

describe('the village race arch', () => {
  const arch = buildMonument('vale-arch', { lines: ['HOLLINS CROSS', 'START'] });

  it('spans the 9.2 m road with room to spare, stands as tall as the world says and is inside the triangle budget', () => {
    const b = bounds(arch);
    expect(b.max.y).toBeCloseTo(VALE_ARCH.height, 2);
    expect(b.min.y).toBeGreaterThan(-1);
    const inner = VALE_ARCH.pier - 0.5; // the piers' inner faces
    expect(inner, 'clear of the road (4.6 m either side) and its shoulder').toBeGreaterThan(4.6 + 0.3);
    expect(b.min.x).toBeCloseTo(-b.max.x, 3);
    // The piers (everything below the poles' pennants) stand inside the first row of spectators, which is 6.05 m out.
    const p = (arch.children[0] as THREE.Mesh).geometry.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) < 8.5) expect(Math.abs(p.getX(i)), `vertex ${i}`).toBeLessThanOrEqual(6.05);
    expect(b.max.z - b.min.z, 'a thin arch, under 1.5 m deep').toBeLessThan(1.5);
    expect(VALE_ARCH.bottom, 'room for a rider and the camera under the board').toBeGreaterThanOrEqual(4.5);
    expect(triangleCount(arch)).toBeLessThan(2500);
    expect(triangleCount(arch)).toBeGreaterThan(600);
  });

  it('has nothing in the clear opening: below the board only the braces, beside the piers', () => {
    // Every vertex lower than the braces' feet (3.5 m) lies beyond the road's edge and its shoulder.
    const geo = (arch.children[0] as THREE.Mesh).geometry;
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) < VALE_ARCH.bottom - 1.2) expect(Math.abs(p.getX(i)), `vertex ${i} at y ${p.getY(i).toFixed(2)}`).toBeGreaterThan(4.6 + 0.2); // the plinth's inner edge is 4.875
    }
  });

  it('is the world’s start, finish and sprint arch on every route, where the gantry was (30 m, the line, the sprint), and the market cross, the inn and the bunting are clear of it', () => {
    expect(KESTREL_VALE.arch).toBeDefined();
    for (const st of KESTREL_ROUTES) {
      expect(st.landmarks.some((k) => k.file === 'gantry.glb'), st.id).toBe(false);
      const arches = st.landmarks.filter((k) => k.model === 'vale-arch');
      expect(arches.length, st.id).toBeGreaterThanOrEqual(2);
      for (const a of arches) expect(a).toMatchObject({ side: 0, span: 'across', offset: 0, size: VALE_ARCH.height });
    }
    const loop = stageById('kestrel-vale-loop');
    const at = (first: number) => loop.landmarks.find((k) => k.model === 'vale-arch' && k.first === first)!;
    expect(at(30).options!.lines).toEqual(['HOLLINS CROSS', 'START']);
    expect(at(loop.finish!).options!.lines).toEqual(['HOLLINS CROSS', 'FINISH']);
    expect(at(2600).options!.lines).toEqual(['KESTREL WATER', 'SPRINT']);
    // Footprints along the road (a) and left of it (l): the arch's posts (a +- 0.6, |l| <= 6.05) against the cross, the inn and the first terrace.
    const piers = { a0: 30 - 0.6, a1: 30 + 0.6 };
    const cross = KESTREL_VALE.landmarks.find((k) => k.model === 'market-cross')!;
    expect(cross.first + 2.6, 'the cross ends before the arch begins').toBeLessThan(piers.a0);
    expect(cross.offset - 2.6, 'and stands outside its posts').toBeGreaterThan(6.05);
    const inn = KESTREL_VALE.landmarks.find((k) => k.file === 'hollins-cross-inn.glb')!;
    expect(inn.offset - 4.8, 'the inn’s front is outside the posts too').toBeGreaterThan(6.05);
    const first = KESTREL_VALE.landmarks.filter((k) => k.model === 'terrace').map((k) => k.first).sort((a, b) => a - b)[0];
    expect(first - 17).toBeGreaterThan(piers.a1);
  });
});
