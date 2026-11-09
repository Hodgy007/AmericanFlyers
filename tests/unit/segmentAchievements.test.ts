// The KOM achievements, worked out from the log of your segment efforts.
import { describe, expect, it } from 'vitest';
import { achievements } from '../../src/cloud/achievements';

const eff = (segment_id: string, elapsed_s: number, day: number) => ({ segment_id, elapsed_s, created_at: new Date(Date.UTC(2026, 10, day, 10)).toISOString() });
const names = (efforts: ReturnType<typeof eff>[]) => achievements([], [], 70, efforts).filter((a) => a.done).map((a) => a.name);

describe('KOM achievements', () => {
  it('earns nothing without efforts', () => {
    expect(names([])).toEqual([]);
  });

  it('Hill climber: the first whole segment', () => {
    expect(names([eff('a:climb-1', 3000, 1)])).toEqual(['Hill climber']);
  });

  it('Beat yourself: only a faster time on a segment you had already ridden', () => {
    expect(names([eff('a:climb-1', 3000, 1), eff('b:climb-1', 2000, 2)])).toEqual(['Hill climber']); // different segments
    expect(names([eff('a:climb-1', 3000, 1), eff('a:climb-1', 3100, 2)])).toEqual(['Hill climber']); // slower
    const list = achievements([], [], 70, [eff('a:climb-1', 3000, 1), eff('a:climb-1', 2950, 3)]);
    const pb = list.find((a) => a.name === 'Beat yourself')!;
    expect(pb.done).toBe(true);
    expect(pb.detail).toMatch(/^Earned /);
  });

  it('Segment collector counts different segments, ordered by when', () => {
    const efforts = ['a', 'b', 'c', 'd', 'e'].map((id, i) => eff(`${id}:climb-1`, 1000, i + 1));
    const four = achievements([], [], 70, efforts.slice(0, 4)).find((a) => a.name === 'Segment collector')!;
    expect(four).toMatchObject({ done: false, progress: 0.8, detail: '4 / 5 segments' });
    expect(achievements([], [], 70, efforts.reverse()).find((a) => a.name === 'Segment collector')!.done).toBe(true);
  });
});
