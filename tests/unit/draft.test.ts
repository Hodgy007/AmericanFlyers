import { describe, expect, it } from 'vitest';
import { BIKE_LENGTH, DRAFT_MAX_GAP, draftFrom, draftSaving, groupMax, lateralOverlap } from '../../src/draft';
import type { OtherRider } from '../../src/world/others';

/** A rider `ahead` metres in front of a rider at distance 0 (wheel-to-wheel gap = ahead - BIKE_LENGTH). */
function rider(id: string, distance: number, extra: Partial<OtherRider> = {}): OtherRider {
  return { id, name: id, distance, lane: 0, ...extra } as unknown as OtherRider;
}

describe('draftSaving', () => {
  it('is about a third close behind and fades with the gap', () => {
    expect(draftSaving(0.5)).toBeGreaterThan(0.3);
    expect(draftSaving(0.5)).toBeLessThan(0.4);
    expect(draftSaving(2)).toBeGreaterThan(draftSaving(5));
    expect(draftSaving(5)).toBeGreaterThan(draftSaving(10));
  });

  it('is zero alongside or beyond the maximum gap', () => {
    expect(draftSaving(-0.1)).toBe(0);
    expect(draftSaving(DRAFT_MAX_GAP + 0.1)).toBe(0);
    expect(draftSaving(DRAFT_MAX_GAP)).toBeCloseTo(0, 6);
  });
});

describe('groupMax', () => {
  it('grows with group size and levels off', () => {
    expect(groupMax(1)).toBeCloseTo(0.36, 6);
    expect(groupMax(3)).toBeGreaterThan(groupMax(1));
    expect(groupMax(6)).toBeGreaterThan(groupMax(3));
    expect(groupMax(30)).toBeLessThan(0.56);
  });
});

describe('lateralOverlap', () => {
  it('is full on their line, nothing clear of it, and symmetric', () => {
    expect(lateralOverlap(0)).toBe(1);
    expect(lateralOverlap(0.3)).toBe(1);
    expect(lateralOverlap(1.1)).toBe(0);
    expect(lateralOverlap(3)).toBe(0);
    expect(lateralOverlap(-0.7)).toBeCloseTo(lateralOverlap(0.7), 10);
  });

  it('falls monotonically in between', () => {
    let prev = 1;
    for (let o = 0.3; o <= 1.1; o += 0.1) {
      const v = lateralOverlap(o);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
    expect(lateralOverlap(0.7)).toBeGreaterThan(0.3);
    expect(lateralOverlap(0.7)).toBeLessThan(0.7);
  });
});

describe('draftFrom', () => {
  it('returns null when nobody is ahead (or only behind / ghosts)', () => {
    expect(draftFrom(0, [])).toBeNull();
    expect(draftFrom(100, [rider('a', 50)])).toBeNull();
    expect(draftFrom(0, [rider('g', 5, { ghost: true })])).toBeNull();
  });

  it('measures the wheel-to-wheel gap and saves more when closer', () => {
    const near = draftFrom(0, [rider('a', BIKE_LENGTH + 1)])!;
    const far = draftFrom(0, [rider('a', BIKE_LENGTH + 8)])!;
    expect(near.gap).toBeCloseTo(1, 6);
    expect(near.saving).toBeGreaterThan(far.saving);
    expect(near.name).toBe('a');
  });

  it('ignores riders beyond the look-ahead distance', () => {
    expect(draftFrom(0, [rider('a', 200)])).toBeNull();
    expect(draftFrom(0, [rider('a', 70)], 60)).toBeNull();
  });

  it('a bigger group ahead gives a bigger saving than one wheel at the same gap', () => {
    const one = draftFrom(0, [rider('a', 3)])!;
    const group = draftFrom(0, [rider('a', 3), rider('b', 4.9), rider('c', 6.8), rider('d', 8.7)])!;
    expect(one.riders).toBe(1);
    expect(group.riders).toBe(4);
    expect(group.saving).toBeGreaterThan(one.saving);
  });

  it('with lateral tracking, a rider off to the side gives nothing', () => {
    const lateral = { lane: 0, lateralOf: () => undefined };
    const onLine = draftFrom(0, [rider('a', 3, { lane: 0 })], 60, lateral)!;
    const side = draftFrom(0, [rider('a', 3, { lane: 2 })], 60, lateral)!;
    expect(onLine.saving).toBeGreaterThan(0.2);
    expect(onLine.overlap).toBe(1);
    expect(side.saving).toBe(0);
    expect(side.overlap).toBe(0);
    expect(side.offset).toBeCloseTo(2, 6);
  });

  it('with lateral tracking, prefers the wheel on your line over a nearer one off to the side', () => {
    const lateral = { lane: 0, lateralOf: () => undefined };
    const d = draftFrom(0, [rider('side', 3, { lane: 2 }), rider('line', 6, { lane: 0 })], 60, lateral)!;
    expect(d.name).toBe('line');
  });
});
