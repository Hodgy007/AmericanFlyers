import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { STAGES } from '../../src/stages';
import { SCENERY } from '../../src/world/scenery';
import {
  LOD_HYSTERESIS, LOD_NEAR, TREE_SPECIES, TreeKit, chooseLod, defaultMix, habitat, loneTreeShare, pickSpecies, treeLineRule, treeScale, treeTint,
} from '../../src/world/trees';

describe('species mix', () => {
  it('derives a mix from coniferBias for routes that name none', () => {
    const conifer = defaultMix(1, false);
    expect(conifer.spruce).toBeGreaterThan(0);
    expect(conifer.oak).toBeUndefined();
    const broadleaf = defaultMix(0, false);
    expect(broadleaf.oak).toBeGreaterThan(0);
    expect(broadleaf.spruce).toBeUndefined();
    const mixed = defaultMix(0.5, false);
    expect(mixed.spruce).toBeGreaterThan(0);
    expect(mixed.oak).toBeGreaterThan(0);
    expect(Object.keys(defaultMix(0.5, true)).sort()).toEqual(['juniper', 'shrub']);
  });

  it('picks species in proportion to their weights, the same every time', () => {
    const mix = { spruce: 3, oak: 1 };
    const count = { spruce: 0, oak: 0 };
    for (let i = 0; i < 1000; i++) count[pickSpecies(mix, 0, (i + 0.5) / 1000) as 'spruce' | 'oak']++;
    expect(count.spruce).toBe(750);
    expect(count.oak).toBe(250);
    expect(pickSpecies(mix, 0, 0.3)).toBe(pickSpecies(mix, 0, 0.3));
  });

  it('never picks a species outside the mix, and copes with a mix that cannot grow here', () => {
    for (let i = 0; i < 100; i++) expect(['spruce', 'pine']).toContain(pickSpecies({ spruce: 1, pine: 1 }, 500, i / 100));
    expect(pickSpecies({ oak: 1 }, 5000, 0.5)).toBe('oak'); // too high for oaks, but nothing else to plant
  });

  it('thins species out by height', () => {
    expect(habitat('oak', 0)).toBe(1);
    expect(habitat('oak', 900)).toBe(0);
    expect(habitat('larch', 0)).toBe(0);
    expect(habitat('larch', 600)).toBe(1);
    expect(habitat('spruce', 123)).toBe(1);
    let low = 0;
    let high = 0;
    for (let i = 0; i < 200; i++) {
      if (pickSpecies({ oak: 1, pine: 1 }, 100, (i + 0.5) / 200) === 'oak') low++;
      if (pickSpecies({ oak: 1, pine: 1 }, 900, (i + 0.5) / 200) === 'oak') high++;
    }
    expect(low).toBe(100);
    expect(high).toBe(0);
  });

  it('plants fewer lone trees on open grassland, and leaves farmland as it was', () => {
    expect(loneTreeShare(0)).toBeCloseTo(0.06);
    expect(loneTreeShare(-0.2)).toBeCloseTo(0.06);
    expect(loneTreeShare(-0.45)).toBeLessThan(0.03);
    expect(loneTreeShare(-0.45)).toBeGreaterThan(0.01);
  });
});

describe('tree line', () => {
  it('has trees low down, shrubs at and just above the line, nothing beyond', () => {
    expect(treeLineRule(100, 1000, 0, 0.99)).toBe('tree');
    expect(treeLineRule(990, 1000, 0, 0.1)).toBe('shrub'); // most of the growth just under the line is stunted
    expect(treeLineRule(1010, 1000, 0, 0.2)).toBe('shrub');
    expect(treeLineRule(1010, 1000, 0, 0.9)).toBeNull();
    expect(treeLineRule(1100, 1000, 0, 0.1)).toBeNull();
  });
  it('lets forest patches climb higher', () => {
    expect(treeLineRule(1015, 1000, 0, 0.99)).toBeNull();
    expect(treeLineRule(1015, 1000, 0.5, 0.99)).toBe('tree');
  });
  it('never makes shrubs where the line is out of reach', () => {
    expect(treeLineRule(300, 1e9, 0, 0)).toBe('tree');
  });
});

describe('level of detail', () => {
  it('goes near inside the distance and far outside it', () => {
    expect(chooseLod('far', LOD_NEAR - 1, true)).toBe('near');
    expect(chooseLod('far', LOD_NEAR + 1, true)).toBe('far');
    expect(chooseLod('near', 50, true)).toBe('near');
  });
  it('holds on across the boundary until the hysteresis is crossed (no flicker)', () => {
    expect(chooseLod('near', LOD_NEAR + 1, true)).toBe('near');
    expect(chooseLod('near', LOD_NEAR + LOD_HYSTERESIS - 1, true)).toBe('near');
    expect(chooseLod('near', LOD_NEAR + LOD_HYSTERESIS + 1, true)).toBe('far');
    expect(chooseLod('far', LOD_NEAR + 1, true)).toBe('far'); // and does not come back until inside the line
  });
  it('is always far where the tier has no near trees', () => {
    expect(chooseLod('near', 10, false)).toBe('far');
    expect(chooseLod('far', 10, false)).toBe('far');
    expect(SCENERY.low.nearTrees).toBe(false);
    expect(SCENERY.high.nearTrees).toBe(true);
  });
});

describe('variation', () => {
  it('tints in hue, saturation and brightness, within sane bounds', () => {
    const c = new THREE.Color();
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        treeTint(i / 5, j / 5, (i + j) % 6 / 5, c);
        for (const v of [c.r, c.g, c.b]) {
          expect(v).toBeGreaterThan(0.6);
          expect(v).toBeLessThan(1.35);
        }
        seen.add(c.getHexString());
      }
    }
    expect(seen.size).toBeGreaterThan(20);
    const warm = treeTint(0.5, 1, 0.5, new THREE.Color());
    const cool = treeTint(0.5, 0, 0.5, new THREE.Color());
    expect(warm.r - warm.b).toBeGreaterThan(0);
    expect(cool.r - cool.b).toBeLessThan(0);
  });
  it('sizes within each species range', () => {
    for (const s of TREE_SPECIES) {
      expect(treeScale(s, 0)).toBeLessThan(treeScale(s, 1));
      expect(treeScale(s, 0.5)).toBeGreaterThan(0.5);
    }
  });
});

describe('geometry', () => {
  const kit = new TreeKit();
  it('keeps near trees to about 150 triangles and far ones to 20 to 50, with the same silhouette', () => {
    for (const s of TREE_SPECIES) {
      const near = kit.geometry(s, 'near');
      const far = kit.geometry(s, 'far');
      const nt = near.attributes.position.count / 3;
      const ft = far.attributes.position.count / 3;
      expect(nt, `${s} near`).toBeLessThanOrEqual(150);
      expect(ft, `${s} far`).toBeGreaterThanOrEqual(20);
      expect(ft, `${s} far`).toBeLessThanOrEqual(50);
      expect(ft, `${s}`).toBeLessThan(nt);
      for (const g of [near, far]) {
        expect(g.attributes.color.count).toBe(g.attributes.position.count);
        expect(g.attributes.normal.array.every(Number.isFinite)).toBe(true);
        expect(g.attributes.position.array.every(Number.isFinite)).toBe(true);
      }
      const nb = new THREE.Box3().setFromBufferAttribute(near.attributes.position as THREE.BufferAttribute);
      const fb = new THREE.Box3().setFromBufferAttribute(far.attributes.position as THREE.BufferAttribute);
      expect(Math.abs(nb.max.y - fb.max.y) / nb.max.y, `${s} height`).toBeLessThan(0.25);
      expect(Math.abs(nb.max.x - nb.min.x - (fb.max.x - fb.min.x)) / (nb.max.x - nb.min.x), `${s} width`).toBeLessThan(0.45);
      expect(nb.min.y).toBeGreaterThanOrEqual(-0.3); // stands on the ground
    }
  });
  it('is built the same every time', () => {
    const other = new TreeKit();
    expect(Array.from(other.geometry('oak', 'near').attributes.position.array)).toEqual(Array.from(kit.geometry('oak', 'near').attributes.position.array));
  });
  it('faces every triangle outwards (nothing is inside out)', () => {
    for (const s of TREE_SPECIES) {
      const g = kit.geometry(s, 'near');
      const n = g.attributes.normal;
      const p = g.attributes.position;
      let up = 0;
      for (let i = 0; i < p.count; i += 3) up += n.getY(i);
      // Foliage faces up more than down, on balance.
      expect(up, s).toBeGreaterThan(-p.count * 0.05);
    }
  });
});

describe('stage mixes', () => {
  it('only name known species with positive weights', () => {
    for (const stage of STAGES) {
      for (const [k, w] of Object.entries(stage.scenery.trees ?? {})) {
        expect(TREE_SPECIES, `${stage.id} ${k}`).toContain(k);
        expect(w).toBeGreaterThan(0);
      }
    }
  });
  it('gives every built-in stage its own mix, and keeps Morgul-Bismark open and Tour of the Moon desert', () => {
    for (const stage of STAGES.filter((s) => !s.uploaded)) expect(stage.scenery.trees, stage.id).toBeDefined();
    const morgul = STAGES.find((s) => s.id === 'hotw-morgul-bismark')!;
    expect(morgul.scenery.trees?.spruce).toBeUndefined();
    expect(morgul.scenery.trees?.cottonwood).toBeGreaterThan(0);
    expect(morgul.scenery.forestCover).toBeLessThan(-0.4);
    const moon = STAGES.find((s) => s.id === 'hotw-tour-of-the-moon')!;
    expect(Object.keys(moon.scenery.trees!).sort()).toEqual(['juniper', 'shrub']);
  });
});
