import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { roadPoint, setStage } from '../../src/course';
import { STAGES, stageById } from '../../src/stages';
import { barrierSections } from '../../src/world/barriers';
import { CAMPER_FOOT, FINISH_CLEAR, NEAR_CLEAR, START_CLEAR, planCampers, tentGeometry, vanGeometry, parasolGeometry } from '../../src/world/campers';
import { CULTURES, FLAG_DESIGNS, MAX_DESIGNS, POLKA, cultureOf, pickShirt } from '../../src/world/crowdCulture';
import { crowdAt, crowdNear, hotspotAt, hotspotsOf } from '../../src/world/crowdZones';
import { planCrowd } from '../../src/world/crowds';
import { isClimb } from '../../src/world/roadside';
import { groundSampler } from '../../src/world/terrain';

const alpe = stageById('alpe-dhuez');

describe('crowd cultures', () => {
  it('follow the hairpin word, with Colorado for the Hell of the West stages', () => {
    const want: Record<string, string> = {
      'alpe-dhuez': 'fr', ventoux: 'fr', tourmalet: 'fr',
      stelvio: 'it', zoncolan: 'it',
      heartland: 'us', route66: 'us',
      'hell-of-the-west': 'co', 'hotw-morgul-bismark': 'co', 'hotw-tour-of-the-moon': 'co',
      'mt-washington': 'us', 'mt-blue-sky': 'co', 'mt-diablo': 'us', flagstaff: 'co',
      'richmond-worlds': 'us', 'central-park': 'us', 'harrogate-worlds': 'gb', 'pacific-coast': 'us',
      'kestrel-vale': 'gb', 'kestrel-vale-loop': 'gb', 'kestrel-vale-grand': 'gb',
    };
    for (const s of STAGES) expect(cultureOf(s), s.id).toBe(want[s.id]);
  });
  it('gives every culture flags the shader can hold, drawn from the atlas, and a shirt for any roll', () => {
    for (const [id, c] of Object.entries(CULTURES)) {
      expect(c.flags.length, id).toBeGreaterThan(0);
      expect(c.flags.length, id).toBeLessThanOrEqual(MAX_DESIGNS);
      for (const f of c.flags) expect(FLAG_DESIGNS).toContain(f);
      for (const r of [0, 0.3, 0.999999]) expect(pickShirt(id as keyof typeof CULTURES, r)).toMatch(/^#[0-9a-f]{6}$|^polka$/);
    }
  });
  it('dresses each country in its own colours', () => {
    const share = (culture: keyof typeof CULTURES, match: (c: string) => boolean) => {
      let n = 0;
      for (let i = 0; i < 2000; i++) if (match(pickShirt(culture, (i + 0.5) / 2000))) n++;
      return n / 2000;
    };
    expect(share('fr', (c) => c === POLKA)).toBeGreaterThan(0.08);
    expect(share('us', (c) => c === POLKA)).toBe(0);
    expect(share('it', (c) => c === '#f08bb4')).toBeGreaterThan(0.25); // lots of maglia rosa
    expect(share('fr', (c) => c === '#f08bb4')).toBe(0);
    expect(share('nl', (c) => /^#(ff6a00|ff8a1f|f26a1b)$/.test(c))).toBeGreaterThan(0.85);
    expect(CULTURES.fr.flags).toEqual(expect.arrayContaining(['fr', 'polka', 'bretagne', 'basque']));
    expect(CULTURES.it.flags).toEqual(expect.arrayContaining(['it', 'pink']));
    expect(CULTURES.co.flags).toContain('colorado');
    expect(CULTURES.us.flags).not.toContain('colorado');
    expect(CULTURES.nl.flags.every((f) => f === 'nl' || f === 'orange')).toBe(true);
  });
});

describe('crowd hotspots', () => {
  beforeAll(() => setStage(alpe));
  it('puts the Dutch Corner on the bend of the hairpin labelled 7, and only on the Alpe', () => {
    const hs = hotspotsOf(alpe);
    expect(hs).toHaveLength(1);
    const sign = alpe.signs.find((s) => s.label === '7')!;
    expect(hs[0].d).toBeGreaterThan(sign.d);
    expect(hs[0].d).toBeLessThan(sign.d + 90); // the real bend at Huez is a long, wide one
    expect(hs[0].culture).toBe('nl');
    for (const s of STAGES.filter((x) => x.id !== 'alpe-dhuez')) expect(hotspotsOf(s), s.id).toEqual([]);
  });
  it('is full strength across its middle, fading to nothing at its radius', () => {
    const h = hotspotsOf(alpe)[0];
    expect(hotspotAt(alpe, h.d)!.weight).toBe(1);
    expect(hotspotAt(alpe, h.d + h.radius * 0.5)!.weight).toBeCloseTo(1, 5);
    expect(hotspotAt(alpe, h.d + h.radius * 0.75)!.weight).toBeCloseTo(0.5, 5);
    expect(hotspotAt(alpe, h.d + h.radius + 1)).toBeNull();
    expect(hotspotAt(alpe, h.d - h.radius - 1)).toBeNull();
  });
  it('makes the sound louder than any ordinary crowd there', () => {
    const h = hotspotsOf(alpe)[0];
    expect(crowdNear(h.d)).toBeCloseTo(h.density, 5);
    expect(crowdNear(h.d)).toBeGreaterThan(1);
    expect(crowdAt(alpe, h.d)).toBe(crowdNear(h.d));
    expect(crowdNear(alpe.signs.find((s) => s.label === '8')!.d + 10)).toBeCloseTo(0.75, 2); // an ordinary hairpin
    expect(crowdNear(alpe.finish! - 50)).toBeLessThanOrEqual(1);
  });
  it('is a much thicker, mostly orange crowd, three rows deep, than the next hairpin', () => {
    const h = hotspotsOf(alpe)[0];
    const there = planCrowd(alpe, h.d - 50, h.d + 50, 1, [], true);
    const next = alpe.signs.find((s) => s.label === '8')!;
    const elsewhere = planCrowd(alpe, next.d - 40, next.d + 60, 1, [], true);
    expect(there.length).toBeGreaterThan(elsewhere.length * 1.5);
    expect(there.filter((p) => p.culture === 'nl').length / there.length).toBeGreaterThan(0.85);
    expect(elsewhere.every((p) => p.culture === 'fr')).toBe(true);
    // Both sides, three rows each: lateral offsets fall in three bands.
    expect(there.some((p) => p.lat < 0)).toBe(true);
    expect(there.some((p) => p.lat > 0)).toBe(true);
    expect(there.some((p) => Math.abs(p.lat) > 8.3)).toBe(true);
    expect(elsewhere.every((p) => Math.abs(p.lat) < 8.4)).toBe(true);
    // Mostly orange shirts there.
    const orange = there.filter((p) => /^#(ff6a00|ff8a1f|f26a1b)$/.test(p.shirt)).length;
    expect(orange / there.length).toBeGreaterThan(0.7);
    // More of them wave flags, and Dutch ones.
    const flaggers = there.filter((p) => p.flag);
    expect(flaggers.length / there.length).toBeGreaterThan(0.2);
  });
  it('keeps the rest of the Alpe French, and the American stages American', () => {
    const f = planCrowd(alpe, alpe.finish! - 300, alpe.finish! - 200, 1, [], true);
    expect(f.length).toBeGreaterThan(30);
    expect(f.every((p) => p.culture === 'fr')).toBe(true);
    const mb = stageById('hotw-morgul-bismark');
    setStage(mb);
    const us = planCrowd(mb, mb.finish! - 300, mb.finish! - 200, 1, [], true);
    expect(us.length).toBeGreaterThan(30);
    expect(us.every((p) => p.culture === 'co')).toBe(true);
    setStage(alpe);
  });
});

describe('roadside camp', () => {
  const stages = ['alpe-dhuez', 'stelvio', 'tourmalet', 'zoncolan', 'ventoux', 'hell-of-the-west'];

  /** Plans the whole climb a chunk at a time, as the world does. */
  const camp = (id: string, share = 1) => {
    const stage = stageById(id);
    setStage(stage);
    const all = [];
    for (let d0 = 0; d0 < stage.finish!; d0 += 100) {
      const a = roadPoint(d0 + 50);
      const ground = groundSampler(a.x - 140, a.x + 140, a.z - 140, a.z + 140);
      all.push(...planCampers(stage, d0, d0 + 100, share, ground, barrierSections(stage, d0 - 20, d0 + 120, ground)));
    }
    return { stage, all };
  };

  it('is on the climbs only', () => {
    for (const id of ['heartland', 'route66', 'hotw-morgul-bismark']) {
      const s = stageById(id);
      expect(isClimb(s)).toBe(false);
      setStage(s);
      expect(planCampers(s, 0, 500, 1, () => 0, [])).toEqual([]);
    }
    setStage(alpe);
  });

  it('is deterministic, thinner on weaker tiers and off at zero', () => {
    const a = camp('alpe-dhuez');
    expect(camp('alpe-dhuez').all).toEqual(a.all);
    expect(camp('alpe-dhuez', 0.35).all.length).toBeLessThan(a.all.length * 0.6);
    expect(camp('alpe-dhuez', 0).all).toEqual([]);
  });

  // Every corner of every camper's footprint is checked against every stretch of road within 200 m (2 m steps),
  // so this is seconds of work per stage: comfortably over vitest's 5 s default on a slower CI runner.
  for (const id of stages) {
    it(`${id}: parks only where the crowds are, off the road, off the rails and out of the finish`, { timeout: 30_000 }, () => {
      const { stage, all } = camp(id);
      expect(all.length, 'some camp').toBeGreaterThan(6);
      expect(new Set(all.map((c) => c.kind)).size, 'a mix of vans, tents and parasols').toBeGreaterThanOrEqual(2);
      // A rail section is 3 m long on the outside of a hairpin, so build the road's centreline once.
      const rails = barrierSections(stage, 0, stage.finish!, groundSampler(-1e5, 1e5, -1e5, 1e5));
      for (const c of all) {
        expect(c.d).toBeGreaterThanOrEqual(START_CLEAR);
        expect(c.d, 'the last 150 m stay clear').toBeLessThan(stage.finish! - FINISH_CLEAR + 1);
        expect(crowdAt(stage, c.d), 'in a crowd zone').toBeGreaterThanOrEqual(0.12);
        // Every corner of its footprint is well clear of every stretch of road within 200 m.
        const foot = CAMPER_FOOT[c.kind];
        for (const [lx, lz] of [[0, 0], [foot.halfLen, foot.halfW], [foot.halfLen, -foot.halfW], [-foot.halfLen, foot.halfW], [-foot.halfLen, -foot.halfW]]) {
          const x = c.x + lx * Math.cos(c.yaw) + lz * Math.sin(c.yaw);
          const z = c.z - lx * Math.sin(c.yaw) + lz * Math.cos(c.yaw);
          for (let d = c.d - 200; d <= c.d + 200; d += 2) {
            const p = roadPoint(d);
            expect(Math.hypot(p.x - x, p.z - z), `${c.kind} at ${Math.round(c.d)} m`).toBeGreaterThan(NEAR_CLEAR - 0.35);
          }
        }
        // Not alongside a rail on its side.
        for (const r of rails) if (r.side === c.side) expect(Math.abs(r.d - c.d), `${c.kind} at ${Math.round(c.d)} m beside a rail`).toBeGreaterThan(foot.halfLen + 3);
      }
    });
  }

  it('stands on the ground, on the uphill side more often than not', () => {
    const { stage, all } = camp('alpe-dhuez');
    let uphill = 0;
    for (const c of all) {
      const p = roadPoint(c.d);
      const g = groundSampler(c.x - 140, c.x + 140, c.z - 140, c.z + 140); // a window as wide as the one the camp was placed from
      // Even where hairpins stack, the ground is the same whichever window it is sampled from (the sampler scans the whole road).
      expect(Math.abs(c.y - g(c.x, c.z)), `camper at ${Math.round(c.d)} m`).toBeLessThan(0.3);
      const rx = -Math.sin(p.heading);
      const rz = Math.cos(p.heading);
      const mine = g(p.x + rx * 10 * c.side, p.z + rz * 10 * c.side);
      const other = g(p.x - rx * 10 * c.side, p.z - rz * 10 * c.side);
      if (mine >= other) uphill++;
    }
    expect(uphill / all.length).toBeGreaterThan(0.6);
    expect(stage.id).toBe('alpe-dhuez');
  });

  it('puts more camp, in orange, at the Dutch Corner', () => {
    const { all } = camp('alpe-dhuez');
    const h = hotspotsOf(alpe)[0];
    const near = all.filter((c) => Math.abs(c.d - h.d) < h.radius);
    expect(near.length).toBeGreaterThan(2);
    expect(near.some((c) => /^#ff/.test(c.tint))).toBe(true);
    expect(all.filter((c) => Math.abs(c.d - h.d) >= h.radius).every((c) => !/^#ff(b36b|7a1a|6a00)$/.test(c.tint))).toBe(true);
  });
});

describe('camper meshes', () => {
  const box = (g: THREE.BufferGeometry) => new THREE.Box3().setFromBufferAttribute(g.attributes.position as THREE.BufferAttribute);
  it('are low-poly, share their attributes and stand on y = 0', () => {
    for (const [g, tris] of [[vanGeometry(), 800], [tentGeometry(), 40], [parasolGeometry(), 300]] as const) {
      expect(g.attributes.position.count / 3).toBeLessThan(tris);
      expect(Object.keys(g.attributes).sort()).toEqual(['color', 'normal', 'position']);
      expect(box(g).min.y).toBeGreaterThan(-0.3);
      expect(box(g).min.y).toBeLessThan(0.1);
    }
  });
  it('make a van about 6.4 by 2.3 by 2.7 m and a tent about 1.3 m tall', () => {
    const v = box(vanGeometry()).getSize(new THREE.Vector3());
    expect(v.x).toBeCloseTo(6.45, 0);
    expect(v.z).toBeGreaterThan(2.2);
    expect(v.z).toBeLessThan(2.6);
    expect(v.y).toBeGreaterThan(2.4);
    expect(v.y).toBeLessThan(3.0);
    expect(box(tentGeometry()).max.y).toBeCloseTo(1.3, 1);
  });
  it('has a tent whose faces all point outwards', () => {
    const g = tentGeometry();
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const centre = new THREE.Vector3(0, 0.45, 0);
    for (let i = 0; i < 18; i++) { // the six triangles of the tent itself (the doorway panel follows them)
      const v = new THREE.Vector3().fromBufferAttribute(p, i).sub(centre);
      const nn = new THREE.Vector3().fromBufferAttribute(n, i);
      expect(v.dot(nn)).toBeGreaterThan(-0.2); // the normal points away from the middle
    }
  });
});

describe('modelled camper van', () => {
  it('is stood on the ground, centred and scaled to a real camper, tinted lighter than the box van', async () => {
    const { vanFromScene, VAN_MODEL_LENGTH, vanModelTint } = await import('../../src/world/campers');
    // A stand-in for the GLB: a 1 x 0.46 x 0.43 block centred on the origin, under a node that is moved and turned.
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 0.46, 0.43), new THREE.MeshStandardMaterial({ metalness: 1 }));
    const node = new THREE.Group();
    node.position.set(5, -3, 2);
    node.add(mesh);
    const van = vanFromScene(node)!;
    const b = new THREE.Box3().setFromBufferAttribute(van.geometry.attributes.position as THREE.BufferAttribute);
    expect(b.min.y).toBeCloseTo(0, 5);
    expect(b.max.x - b.min.x).toBeCloseTo(VAN_MODEL_LENGTH, 5);
    expect((b.max.x + b.min.x) / 2).toBeCloseTo(0, 5);
    expect((b.max.z + b.min.z) / 2).toBeCloseTo(0, 5);
    expect(b.max.y, 'a camper about 2.9 m tall').toBeGreaterThan(2.5);
    expect(b.max.y).toBeLessThan(3.3);
    expect((van.material as THREE.MeshStandardMaterial).metalness).toBe(0);
    expect(vanFromScene(new THREE.Group())).toBeNull();
    const c = vanModelTint('#ff7a1a', new THREE.Color());
    expect(c.g).toBeGreaterThan(new THREE.Color('#ff7a1a').g);
  });

  it('is used from Medium up, not on Low', async () => {
    const { SCENERY } = await import('../../src/world/scenery');
    expect([SCENERY.low.vanModel, SCENERY.medium.vanModel, SCENERY.high.vanModel, SCENERY.ultra.vanModel]).toEqual([false, true, true, true]);
  });
});
