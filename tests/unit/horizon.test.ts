import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STAGES, stageById } from '../../src/stages';
import { RING_RADIUS, bandOffset, bandShape, horizonFor, horizonUrl, ridgeDegrees, type HorizonKind } from '../../src/world/horizon';

const KINDS: HorizonKind[] = ['alps', 'pyrenees', 'rockies', 'desert', 'hills'];

describe('which horizon a stage gets', () => {
  const want: Record<string, string> = {
    heartland: 'hills',
    route66: 'hills',
    'alpe-dhuez': 'alps',
    stelvio: 'alps',
    zoncolan: 'alps',
    tourmalet: 'pyrenees',
    ventoux: 'hills',
    'mt-washington': 'hills',
    'mt-diablo': 'hills',
    'mt-blue-sky': 'rockies',
    flagstaff: 'rockies',
    'richmond-worlds': 'hills',
    'central-park': 'hills',
    'harrogate-worlds': 'hills',
    'pacific-coast': 'hills',
    'kestrel-vale': 'hills', 'kestrel-vale-loop': 'hills', 'kestrel-vale-grand': 'hills', 'kestrel-vale-raven-scar': 'hills', 'kestrel-vale-lakeside': 'hills',
    'hell-of-the-west': 'rockies',
    'hotw-morgul-bismark': 'rockies',
    'hotw-tour-of-the-moon': 'desert',
  };

  it('names a panorama for every built-in stage', () => {
    for (const s of STAGES) expect(horizonFor(s.scenery), s.id).toBe(want[s.id]);
    expect(Object.keys(want).sort()).toEqual(STAGES.map((s) => s.id).sort());
  });

  it('follows the scenery when it says so, and finds one for a route that does not', () => {
    expect(horizonFor({ horizon: 'none', mountainScale: 3 })).toBe('none');
    expect(horizonFor({ horizon: 'desert', mountainScale: 3 })).toBe('desert');
    expect(horizonFor({ mountainScale: 3.2 })).toBe('alps'); // a high uploaded route
    expect(horizonFor({ mountainScale: 1.1 })).toBe('hills'); // a low one
    expect(stageById('alpe-dhuez').scenery.horizon).toBe('alps');
  });

  it('ships every panorama it can ask for, full and half size', () => {
    for (const k of KINDS) {
      for (const low of [false, true]) expect(existsSync(`public${horizonUrl(k, low)}`), horizonUrl(k, low)).toBe(true);
    }
  });
});

describe('the band', () => {
  it('puts the ridge line higher for taller mountains', () => {
    expect(ridgeDegrees(0.8)).toBeLessThan(ridgeDegrees(1.7));
    expect(ridgeDegrees(1.7)).toBeLessThan(ridgeDegrees(3.6));
    expect(ridgeDegrees(3.6)).toBeLessThan(18); // never towering
  });

  it('wraps an even number of times so the mirrored repeat closes at the seam', () => {
    for (const k of KINDS) {
      for (const scale of [0.8, 1, 1.7, 2.6, 3.6]) {
        const b = bandShape(k, scale);
        expect(b.repeats % 2, `${k} ${scale}`).toBe(0);
        expect(b.repeats).toBeGreaterThanOrEqual(4);
        expect(b.repeats).toBeLessThanOrEqual(12);
      }
    }
  });

  it('is taller for taller mountains and stays under 45 degrees even at its transparent top', () => {
    for (const k of KINDS) {
      expect(bandShape(k, 3.6).height).toBeGreaterThan(bandShape(k, 1).height);
      const b = bandShape(k, 3.6);
      expect(Math.atan((b.bottom + b.height) / RING_RADIUS) * (180 / Math.PI)).toBeLessThan(45);
    }
  });

  it('starts each stage at its own place in the panorama, the same one every time', () => {
    expect(bandOffset('stelvio')).toBe(bandOffset('stelvio'));
    expect(bandOffset('stelvio')).not.toBe(bandOffset('alpe-dhuez'));
    for (const id of ['', 'a', 'alpe-dhuez', 'x'.repeat(40)]) {
      const o = bandOffset(id);
      expect(o).toBeGreaterThanOrEqual(0);
      expect(o).toBeLessThan(1);
    }
  });
});
