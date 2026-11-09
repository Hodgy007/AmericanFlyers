// The local store of your best and latest effort per segment, and the leaderboard row mapping.
import { describe, expect, it } from 'vitest';
import { SegmentStore, pendingEfforts, setPendingEfforts } from '../../src/segmentStore';
import { effortFromRow, type Effort } from '../../src/segments';

class Mem {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
}
const effort = (t: number, at = 1000, s: number[] = [100, 200]): Effort => ({ t, p: 250, s, at });

describe('SegmentStore', () => {
  it('keeps the best and the latest effort, and survives a reload', () => {
    const mem = new Mem();
    const a = new SegmentStore(mem);
    expect(a.get('x:climb-1')).toEqual({});
    expect(a.record('x:climb-1', effort(300, 1))).toMatchObject({ isBest: true, previousBest: undefined });
    expect(a.record('x:climb-1', effort(280, 2))).toMatchObject({ isBest: true, previousBest: { t: 300 } });
    expect(a.record('x:climb-1', effort(310, 3))).toMatchObject({ isBest: false, previousBest: { t: 280 } });
    const b = new SegmentStore(mem);
    expect(b.get('x:climb-1').best?.t).toBe(280);
    expect(b.get('x:climb-1').last?.t).toBe(310);
    expect(b.get('x:climb-1').last?.s).toEqual([100, 200]);
    expect(b.ids()).toEqual(['x:climb-1']);
  });

  it('merges what the account has: a faster best wins, a newer latest wins, nothing else changes', () => {
    const store = new SegmentStore(new Mem());
    store.record('s', effort(300, 5));
    expect(store.merge('s', effort(350, 1), effort(350, 1))).toBe(false); // slower and older
    expect(store.merge('s', effort(290, 2), null)).toBe(true);
    expect(store.get('s').best?.t).toBe(290);
    expect(store.get('s').last?.at).toBe(5);
    expect(store.merge('s', null, effort(320, 9))).toBe(true);
    expect(store.get('s').last?.at).toBe(9);
  });

  it('works with no storage, throwing storage and junk in storage', () => {
    expect(new SegmentStore(null).record('s', effort(100)).isBest).toBe(true);
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
    const store = new SegmentStore(throwing);
    expect(() => store.record('s', effort(100))).not.toThrow();
    expect(store.get('s').best?.t).toBe(100);
    const junk = new Mem();
    junk.setItem('americanflyers.segments', JSON.stringify({ a: { best: { t: 'x' } }, b: { best: effort(90), last: 7 }, c: null }));
    expect(Object.fromEntries(new SegmentStore(junk).ids().map((i) => [i, 1]))).toEqual({ b: 1 });
    junk.setItem('americanflyers.segments', '{not json');
    expect(new SegmentStore(junk).ids()).toEqual([]);
  });

  it('keeps the most recently ridden segments when there are too many', () => {
    const store = new SegmentStore(new Mem());
    for (let i = 0; i < 130; i++) store.record(`s${i}`, effort(100, i));
    expect(store.ids()).toHaveLength(120);
    expect(store.get('s0')).toEqual({});
    expect(store.get('s129').best?.t).toBe(100);
  });

  it('forgets everything on clear (signing out)', () => {
    const mem = new Mem();
    const store = new SegmentStore(mem);
    store.record('s', effort(100));
    store.clear();
    expect(store.ids()).toEqual([]);
    expect(new SegmentStore(mem).ids()).toEqual([]);
  });

  it('queues efforts that could not be sent', () => {
    const mem = new Mem();
    expect(pendingEfforts(mem)).toEqual([]);
    setPendingEfforts([{ user: 'u', stage_id: 's', segment_id: 's:c', elapsed_s: 100, avg_power: 250, splits: [10], at: 5 }], mem);
    expect(pendingEfforts(mem)).toHaveLength(1);
    mem.setItem('americanflyers.segments.pending', 'oops');
    expect(pendingEfforts(mem)).toEqual([]);
  });
});

describe('database rows', () => {
  it('maps a segment_efforts row to an effort, tolerating gaps', () => {
    expect(effortFromRow({ elapsed_s: 3134.5, avg_power: 281, splits: [10, 20, 31], created_at: '2026-11-01T10:00:00Z' })).toEqual({ t: 3134.5, p: 281, s: [10, 20, 31], at: Date.parse('2026-11-01T10:00:00Z') });
    expect(effortFromRow({ elapsed_s: 99, avg_power: null, splits: null, created_at: '2026-11-01T10:00:00Z' })).toMatchObject({ p: 0, s: [] });
    expect(effortFromRow({ elapsed_s: 99, avg_power: 1, splits: [10, null as unknown as number, 30], created_at: '2026-11-01T10:00:00Z' }).s).toEqual([10, 30]);
  });
});
