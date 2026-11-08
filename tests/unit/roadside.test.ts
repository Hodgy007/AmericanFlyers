import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { setStage } from '../../src/course';
import { stageById } from '../../src/stages';
import { barrierKind, barrierSections, hasBarriers } from '../../src/world/barriers';
import { crowdNear } from '../../src/world/crowdZones';
import { planCrowd } from '../../src/world/crowds';
import { paintName, planPaint } from '../../src/world/roadPaint';
import { bendsOf, isClimb } from '../../src/world/roadside';
import { SCENERY, layersFor } from '../../src/world/scenery';
import { TIER_SPECS, TIERS } from '../../src/world/quality';
import { groundColor } from '../../src/world/terrain';

const alpe = stageById('alpe-dhuez');
const stelvio = stageById('stelvio');
const ventoux = stageById('ventoux');

describe('hairpins', () => {
  it('finds every hairpin of the climbs, in the direction the real road turns', () => {
    for (const s of [alpe, stelvio]) {
      const bends = bendsOf(s);
      const hairpins = s.signs.filter((g) => g.numbered !== false || !g.name);
      expect(bends.length).toBe(hairpins.length);
      bends.forEach((b) => {
        expect(b.end - b.start).toBeGreaterThan(10); // the part of the arc tighter than a 25 m radius
        const dh = s.headingAt(b.end) - s.headingAt(b.start);
        expect(b.turn).toBe(dh > 0 ? 1 : -1);
      });
    }
  });
  it('numbers only the hairpins the real road numbers', () => {
    expect(alpe.signs.every((g) => g.numbered !== false && /^\d+$/.test(g.label))).toBe(true);
    expect(stelvio.signs).toHaveLength(48);
    for (const id of ['ventoux', 'tourmalet', 'zoncolan', 'hell-of-the-west']) {
      for (const g of stageById(id).signs) expect(g.numbered, `${id} at ${g.d}`).toBe(false);
    }
  });
  it('has none on flat stages', () => {
    expect(bendsOf(stageById('heartland'))).toEqual([]);
    expect(isClimb(stageById('heartland'))).toBe(false);
    expect(isClimb(alpe)).toBe(true);
  });
});

describe('painted words', () => {
  it('cleans a first name for painting', () => {
    expect(paintName('Sam Hodgson')).toBe('SAM');
    expect(paintName('  zoë ')).toBe('ZOE');
    expect(paintName('alexandrina')).toBe('ALEXANDRI');
    expect(paintName('王')).toBe('');
    expect(paintName(null)).toBe('');
  });
  it('is the same every time, only on climbs, and keeps off the hairpin arcs', () => {
    expect(planPaint(stageById('route66'), 'SAM')).toEqual([]);
    expect(planPaint(alpe, 'SAM')).toEqual(planPaint(alpe, 'SAM'));
    const spots = planPaint(alpe, 'SAM');
    expect(spots.length).toBeGreaterThan(8);
    const bends = bendsOf(alpe);
    for (const sp of spots) {
      expect(bends.some((b) => sp.d < b.end && sp.d + sp.len > b.start)).toBe(false);
      expect(sp.d).toBeLessThan(alpe.finish!);
    }
    // The last stretch has several per kilometre; far from the finish only the hairpin approaches.
    expect(spots.filter((s) => s.d > alpe.finish! - 3400).length).toBeGreaterThanOrEqual(6);
  });
  it('paints the rider’s name only when there is one', () => {
    expect(planPaint(alpe, 'SAM').some((s) => s.word === 'name')).toBe(true);
    expect(planPaint(alpe, '').some((s) => s.word === 'name')).toBe(false);
  });
});

describe('guardrails', () => {
  it('stand on the outside of each hairpin and nowhere on flat stages', () => {
    const flat = () => 1e6; // ground level with the sky: no drop beside the road
    expect(barrierSections(stageById('heartland'), 0, 5000, flat)).toEqual([]);
    const bends = bendsOf(alpe);
    for (const b of [bends[2], bends[3]]) {
      const here = barrierSections(alpe, b.start, b.end, flat);
      expect(here.length).toBeGreaterThan(8);
      // A right turn has its outside on the left (-1), a left turn on the right.
      expect(here.every((r) => r.side === (b.turn > 0 ? -1 : 1))).toBe(true);
    }
  });
  it('also stand where the ground falls away beside the road', () => {
    const drop = (_x: number, _z: number) => -100; // far below the road everywhere
    expect(barrierSections(alpe, 3000, 3100, drop).length).toBeGreaterThan(40);
  });
  it('are left out entirely where the stage says the road is unguarded (Mount Washington)', () => {
    const washington = stageById('mt-washington');
    const drop = (_x: number, _z: number) => -100;
    expect(barrierKind(washington)).toBe('none');
    expect(hasBarriers(washington)).toBe(false);
    expect(isClimb(washington)).toBe(true); // it is still a climb: crowds, painted words, campers
    for (const [a, b] of [[0, 12200], [11000, 11400]]) expect(barrierSections(washington, a, b, drop)).toEqual([]);
    // The other American climbs and the alpine passes keep theirs.
    for (const id of ['mt-blue-sky', 'mt-diablo', 'flagstaff', 'stelvio']) expect(hasBarriers(stageById(id)), id).toBe(true);
  });
});

describe('crowds', () => {
  beforeAll(() => setStage(alpe));
  it('line the last few hundred metres and the hairpins, not the empty road', () => {
    expect(crowdNear(alpe.finish! - 50)).toBeGreaterThan(0.9);
    expect(crowdNear(alpe.signs[3].d + 10)).toBeCloseTo(0.75, 2);
    const gap = (alpe.signs[13].d + alpe.signs[14].d) / 2; // the longest empty stretch, far from any hairpin
    expect(crowdNear(gap)).toBe(0);
    expect(planCrowd(alpe, gap - 50, gap + 50, 1, [], true)).toEqual([]);
    expect(planCrowd(alpe, alpe.finish! - 300, alpe.finish! - 200, 1, [], true).length).toBeGreaterThan(30);
  });
  it('are deterministic, thinner on weaker tiers, and keep clear of roadside signs', () => {
    const d0 = alpe.finish! - 400;
    const full = planCrowd(alpe, d0, d0 + 100, 1, [], true);
    expect(planCrowd(alpe, d0, d0 + 100, 1, [], true)).toEqual(full);
    expect(planCrowd(alpe, d0, d0 + 100, 0.35, [], false).length).toBeLessThan(full.length * 0.6);
    expect(planCrowd(alpe, d0, d0 + 100, 0.35, [], false).some((p) => p.flag)).toBe(false);
    expect(planCrowd(alpe, d0, d0 + 100, 0, [], true)).toEqual([]);
    const sign = d0 + 50;
    expect(planCrowd(alpe, d0, d0 + 100, 1, [sign], true).filter((p) => p.lat > 0 && Math.abs(p.d - sign) < 0.5).length).toBe(0);
  });
});

describe('ground layers', () => {
  const w = new Array(8).fill(0);
  const sum = () => w.reduce((a, b) => a + b, 0);
  const sample = (stage: typeof alpe, h: number, dist = 40) => {
    setStage(stage);
    w.fill(0);
    groundColor(1234, 567, h, { dist, d: 100 }, new THREE.Color(), w);
    return [...w];
  };
  it('are weights that sum to one on every palette', () => {
    for (const [stage, h] of [[alpe, 0], [alpe, 600], [alpe, 1400], [alpe, 1900], [stageById('heartland'), 30], [stageById('hotw-tour-of-the-moon'), 200], [ventoux, 1000], [ventoux, 1200], [ventoux, 1600]] as const) {
      sample(stage, h);
      expect(sum()).toBeCloseTo(1, 1);
      for (const v of w) expect(v).toBeGreaterThanOrEqual(0);
    }
  });
  it('follow height: grass low, rock above the rock line, snow above the snow line', () => {
    expect(sample(alpe, 0)[0] + sample(alpe, 0)[1]).toBeGreaterThan(0.95);
    expect(sample(alpe, 1500)[3]).toBeGreaterThan(0.5);
    expect(sample(alpe, 2200)[4]).toBeGreaterThan(0.9);
  });
  it('turn to scree above a stage\'s scree line, with no snow (Ventoux), and never elsewhere', () => {
    expect(sample(ventoux, 700)[0] + sample(ventoux, 700)[1]).toBeGreaterThan(0.95);
    expect(sample(ventoux, 1600)[7]).toBeGreaterThan(0.95);
    expect(sample(ventoux, 1600)[4]).toBe(0);
    expect(sample(ventoux, 1200)[7]).toBeGreaterThan(0);
    for (const s of [alpe, stelvio, stageById('heartland'), stageById('hotw-tour-of-the-moon')]) expect(sample(s, 2200)[7]).toBe(0);
  });
  it('paint the scree pale', () => {
    setStage(ventoux);
    const c = new THREE.Color();
    groundColor(1234, 567, 1700, { dist: 40, d: 100 }, c, new Array(8).fill(0));
    expect(Math.min(c.r, c.g, c.b)).toBeGreaterThan(0.35);
    expect(c.r).toBeGreaterThanOrEqual(c.b); // warm grey, not blue-white like snow
  });
  it('make the verge dirt, and use sandstone and sand in the desert', () => {
    expect(sample(alpe, 0, 3)[2]).toBeGreaterThan(0.9);
    const d = sample(stageById('hotw-tour-of-the-moon'), 200);
    expect(d[5] + d[6] + d[1]).toBeGreaterThan(0.95);
    expect(d[0] + d[4]).toBe(0);
  });
  it('only ask for the layers a stage and tier can show', () => {
    expect(layersFor(false, false, 3)).toEqual([0, 3]);
    expect(layersFor(false, true, 3)).toEqual([0, 3, 4]);
    expect(layersFor(false, false, 3, true)).toEqual([0, 3, 7]); // Low: grass, rock and scree
    expect(layersFor(false, false, 8, true)).toEqual([0, 1, 2, 3, 7]);
    expect(layersFor(false, false, 8)).not.toContain(7);
    expect(layersFor(false, true, 8)).not.toContain(7);
    expect(layersFor(true, false, 8, false)).not.toContain(7);
    expect(layersFor(true, false, 3)).toEqual([5, 3]);
    expect(layersFor(false, false, 8)).not.toContain(5);
    expect(layersFor(true, false, 8)).not.toContain(0);
  });
});

describe('scenery tiers', () => {
  it('give every tier a spec, with more on the higher ones', () => {
    for (const t of TIERS) expect(TIER_SPECS[t].scenery).toBe(SCENERY[t]);
    expect(SCENERY.low.terrainLayers).toBe(3);
    expect(SCENERY.low.terrainTexSize).toBe(512);
    expect(SCENERY.low.detailNormals).toBe(false);
    expect(SCENERY.medium.detailNormals).toBe(false);
    expect(SCENERY.high.detailNormals).toBe(true);
    const crowd = TIERS.map((t) => SCENERY[t].crowd);
    expect([...crowd].sort((a, b) => a - b)).toEqual(crowd);
    expect(SCENERY.low.crowd).toBeGreaterThan(0); // sparse, not off
  });
});
