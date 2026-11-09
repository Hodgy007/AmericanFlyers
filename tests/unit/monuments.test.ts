import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { STAGES, stageById, type LandmarkKind } from '../../src/stages';
import { mountainHeight } from '../../src/world/flatirons';
import { Kit, FAR_FOG_SCALE, farMaterial, triangleCount } from '../../src/world/monumentKit';
import { MONUMENT_IDS, buildMonument, type MonumentId } from '../../src/world/monuments';

const TRI_BUDGET = 6000;
const bounds = (g: THREE.Object3D) => new THREE.Box3().setFromObject(g);

describe('every monument builder', () => {
  for (const id of MONUMENT_IDS) {
    it(`${id}: builds a non-empty, well-formed group within the triangle budget`, () => {
      const g = buildMonument(id);
      let meshes = 0;
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        meshes++;
        expect(m.geometry.attributes.position.count, 'vertices').toBeGreaterThan(0);
        if (m.geometry.attributes.color) expect(m.geometry.attributes.normal, 'normals beside colours').toBeDefined();
      });
      expect(meshes).toBeGreaterThan(0);
      expect(meshes, 'draw calls: one merged mesh plus a few text boards').toBeLessThanOrEqual(3);
      const tris = triangleCount(g);
      expect(tris).toBeGreaterThan(20);
      expect(tris).toBeLessThan(id === 'flatirons' ? 20000 : TRI_BUDGET);
      const box = bounds(g);
      expect([box.min.x, box.min.y, box.max.y, box.max.x].every(Number.isFinite)).toBe(true);
      expect(box.max.y, 'it has height').toBeGreaterThan(1);
      expect(box.min.y, 'footings go no deeper than a few metres').toBeGreaterThan(-16);
      expect(box.min.y, 'it stands on the ground').toBeLessThanOrEqual(0.5);
    });
  }

  it('is deterministic: the same options build the same thing', () => {
    for (const id of MONUMENT_IDS) {
      const a = buildMonument(id, { seed: 2 });
      const b = buildMonument(id, { seed: 2 });
      expect(triangleCount(a)).toBe(triangleCount(b));
      expect(bounds(a).max.toArray()).toEqual(bounds(b).max.toArray());
    }
  });

  it('only the small ones cast shadows: the Flatirons and the Manhattan skyline (a hundred towers) do not', () => {
    for (const id of MONUMENT_IDS) expect(buildMonument(id).userData.shadows, id).toBe(id !== 'flatirons' && id !== 'manhattan-skyline');
  });

  it('a cluster of apartment blocks varies with its seed, three to five blocks', () => {
    const sizes = new Set<number>();
    for (let seed = 1; seed <= 8; seed++) sizes.add(Math.round(bounds(buildMonument('ski-apartments', { seed })).getSize(new THREE.Vector3()).x));
    expect(sizes.size).toBeGreaterThan(2);
  });
});

describe('the Kit', () => {
  it('merges many parts into one mesh with colours baked in', () => {
    const k = new Kit();
    k.box(1, 1, 1, 0, 0, 0, '#ff0000').cyl(1, 0.5, 2, 3, 0, 0, '#00ff00').gable(2, 2, 1, 0, 1, 0, '#0000ff').pyramid(1, 1, 1, 0, 2, 0, '#ffffff').bar([0, 0, 0], [1, 2, 0], 0.1, '#888888');
    const g = k.build();
    expect(g.children).toHaveLength(1);
    const geo = (g.children[0] as THREE.Mesh).geometry;
    expect(geo.attributes.color.count).toBe(geo.attributes.position.count);
    // box 12, cylinder 8 sides: 16 + 8 + 8 end caps (16), gable 6, open pyramid 4, bar 12.
    expect(triangleCount(g)).toBe(12 + (8 * 2 + 2 * 8) + 6 + 4 + 12);
  });

  it('moves parts with within(): a box lifted by 5 sits 5 m higher', () => {
    const k = new Kit();
    k.within([0, 5, 0], [0, 0, 0], () => k.box(1, 1, 1, 0, 0, 0, '#fff'));
    const box = bounds(k.build());
    expect(box.min.y).toBeCloseTo(5, 5);
    expect(box.max.y).toBeCloseTo(6, 5);
  });

  it('a gable roof is as long, as wide and as high as asked', () => {
    const k = new Kit();
    k.gable(10, 6, 2, 0, 0, 0, '#fff');
    const size = bounds(k.build()).getSize(new THREE.Vector3());
    expect(size.toArray()).toEqual([10, 2, 6]);
  });

  it('draws text boards without a DOM as plain colours (the unit tests have none)', () => {
    const g = buildMonument('col-sign', { lines: ['A', 'B'] });
    const panel = g.children.find((c) => (c as THREE.Mesh).material instanceof THREE.MeshStandardMaterial && !(c as THREE.Mesh).geometry.attributes.color) as THREE.Mesh;
    expect(panel).toBeDefined();
  });
});

describe('the far material (the Flatirons)', () => {
  it('shrinks the distance the fog sees, so the range is hazy rather than fogged out', () => {
    const shader = { vertexShader: 'void main() {\n#include <fog_vertex>\n}' };
    farMaterial.onBeforeCompile(shader as never, null as never);
    expect(shader.vertexShader).toContain(`vFogRel *= ${FAR_FOG_SCALE.toFixed(3)};`);
    expect(FAR_FOG_SCALE).toBeLessThan(0.5);
    expect(farMaterial.fog).toBe(true);
  });
});

describe('the Flatirons mountainside', () => {
  it('rises from a foot in front to a crest of about 470 m and falls away behind', () => {
    const foot = mountainHeight(0, 1000);
    const face = mountainHeight(0, 400);
    const crest = mountainHeight(0, -100);
    expect(foot).toBeLessThan(5);
    expect(face).toBeGreaterThan(foot + 100);
    expect(crest).toBeGreaterThan(300);
    expect(crest).toBeLessThan(560);
    expect(mountainHeight(0, -1300)).toBeLessThan(crest / 2);
  });

  it('tapers to nothing at both ends of the ridge', () => {
    expect(mountainHeight(-2600, 0)).toBeLessThan(40);
    expect(mountainHeight(2600, 0)).toBeLessThan(40);
  });
});

describe('where the stages put monuments', () => {
  const kinds = STAGES.flatMap((s) => s.landmarks.map((k) => [s.id, k] as const));

  it('every landmark is either a GLB file or a monument, never both and never neither', () => {
    for (const [id, k] of kinds) {
      const both = !!k.file === !!k.model;
      expect(both, `${id}: ${k.file ?? ''}${k.model ?? ''}`).toBe(false);
    }
  });

  it("each monument's size matches what its builder makes (within 20%), so it is not stretched", () => {
    const natural = new Map<string, number>();
    for (const [id, k] of kinds) {
      if (!k.model || k.world) continue; // a world-placed one (the Flagstaff Flatirons) is scaled to fit its real size on purpose
      const key = `${k.model}|${JSON.stringify(k.options ?? {})}`;
      if (!natural.has(key)) natural.set(key, bounds(buildMonument(k.model, k.options)).max.y);
      const h = natural.get(key)!;
      expect(k.size / h, `${id} ${k.model}`).toBeGreaterThan(0.8);
      expect(k.size / h, `${id} ${k.model}`).toBeLessThan(1.2);
    }
  });

  const modelsOn = (id: string, model: MonumentId): LandmarkKind[] => stageById(id).landmarks.filter((k) => k.model === model);

  it("the Alpe's church stands on the outside of hairpin 7, found from the stage's own signs", () => {
    const alpe = stageById('alpe-dhuez');
    const seven = alpe.signs.find((s) => s.label === '7')!;
    const [church] = modelsOn('alpe-dhuez', 'alpine-church');
    // The hairpin starts 12 m after its sign and turns for about 35 m; the church is at the apex.
    expect(church.first).toBeGreaterThan(seven.d + 12);
    expect(church.first).toBeLessThan(seven.d + 12 + 40);
    const turning = alpe.headingAt(church.first + 20) - alpe.headingAt(church.first - 20);
    expect(Math.abs(turning), 'the road really is turning there').toBeGreaterThan(1);
    expect(church.side, 'a right turn has its outside on the left').toBe(turning > 0 ? -1 : 1);
  });

  it('every European climb has a summit board before its finish, with the right words', () => {
    const want: Record<string, string> = {
      'alpe-dhuez': "ALPE D'HUEZ",
      stelvio: 'PASSO DELLO STELVIO',
      ventoux: 'MONT VENTOUX',
      tourmalet: 'COL DU TOURMALET',
      zoncolan: 'MONTE ZONCOLAN',
    };
    for (const [id, name] of Object.entries(want)) {
      const [sign] = modelsOn(id, 'col-sign');
      expect(sign.options?.lines?.[0], id).toBe(name);
      const finish = stageById(id).finish!;
      expect(sign.first, id).toBeLessThan(finish);
      expect(sign.first, id).toBeGreaterThan(finish - 100);
    }
    expect(modelsOn('tourmalet', 'col-sign')[0].options?.lines?.[1]).toBe('ALT. 2115 m');
    expect(modelsOn('stelvio', 'col-sign')[0].options?.style).toBe('it');
  });

  it('puts the Ventoux monuments in order: chalet, memorial 1.3 km from the top, observatory at the summit on the left', () => {
    const v = stageById('ventoux');
    expect(modelsOn('ventoux', 'chalet')[0].first).toBeCloseTo(15300, -2); // where the real road is at 1,440 m
    const memorial = modelsOn('ventoux', 'simpson-memorial')[0];
    expect(v.finish! - memorial.first).toBeCloseTo(1300, -1);
    expect(memorial.side).toBe(1);
    const obs = modelsOn('ventoux', 'ventoux-observatory')[0];
    expect(obs.side).toBe(-1);
    expect(obs.first).toBeGreaterThan(v.finish! - 150);
  });

  it('puts the Flatirons well to the west of the Morgul-Bismark circuit, seen from afar, once a lap', () => {
    const mb = stageById('hotw-morgul-bismark');
    const [flat] = modelsOn('hotw-morgul-bismark', 'flatirons');
    expect(flat.offset).toBeGreaterThanOrEqual(2000);
    expect(flat.offset).toBeLessThanOrEqual(3000);
    expect(flat.reach).toBeGreaterThan(5000);
    expect(flat.every).toBe(mb.lapLength);
    expect(flat.clearance).toBeLessThan(5);
  });

  it('keeps the big finish-line monuments where the brief asks', () => {
    expect(modelsOn('tourmalet', 'geant-tourmalet')[0].side).toBe(1);
    expect(modelsOn('tourmalet', 'ski-apartments')[0].first).toBeCloseTo(15000, -2);
    expect(modelsOn('stelvio', 'pass-buildings').length).toBeGreaterThan(0);
    expect(modelsOn('hell-of-the-west', 'log-lodge')[0].first).toBeGreaterThan(20500);
    expect(modelsOn('alpe-dhuez', 'ski-apartments').length).toBeGreaterThan(0);
  });
});
