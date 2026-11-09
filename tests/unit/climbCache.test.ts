import { describe, expect, it } from 'vitest';
import { CLIMB_CACHE_MS, climbCacheKey, readClimbCache, writeClimbCache } from '../../src/ai/climbCache';
import type { ClimbResult } from '../../src/ai/types';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, m };
};
const answer: ClimbResult = {
  stageId: 'ventoux', topic: 'conditions', summary: 'The road is open as of 2026-11-09. [1]', facts: ['Closed to cars in winter [1].'],
  sources: [{ n: 1, title: 'Ventoux', host: 'example.org', url: 'https://example.org/ventoux' }], asOf: '2026-11-09',
};
const T0 = Date.parse('2026-11-09T10:00:00Z');

describe('climb guide cache', () => {
  it('keeps an answer for 24 hours per stage and topic', () => {
    const s = mem();
    writeClimbCache(answer, T0, s);
    expect(readClimbCache('ventoux', 'conditions', T0 + 1000, s)).toEqual(answer);
    expect(readClimbCache('ventoux', 'conditions', T0 + CLIMB_CACHE_MS - 1, s)).toEqual(answer);
    expect(readClimbCache('ventoux', 'history', T0, s)).toBeNull(); // another topic
    expect(readClimbCache('stelvio', 'conditions', T0, s)).toBeNull(); // another stage
  });
  it('expires and removes an entry after 24 hours', () => {
    const s = mem();
    writeClimbCache(answer, T0, s);
    expect(readClimbCache('ventoux', 'conditions', T0 + CLIMB_CACHE_MS, s)).toBeNull();
    expect(s.m.has(climbCacheKey('ventoux', 'conditions'))).toBe(false);
  });
  it('checks what it reads: junk, tampered text and http links are not shown', () => {
    const s = mem();
    s.setItem(climbCacheKey('ventoux', 'conditions'), '{nope');
    expect(readClimbCache('ventoux', 'conditions', T0, s)).toBeNull();
    s.setItem(climbCacheKey('ventoux', 'conditions'), JSON.stringify({ at: T0, data: { summary: '<img src=x onerror=alert(1)>Hello **there**', facts: [], sources: [{ n: 1, title: 'x', url: 'http://insecure.example/' }, { n: 2, title: 'ok', url: 'https://ok.example/p' }], asOf: '2026-11-09' } }));
    const r = readClimbCache('ventoux', 'conditions', T0, s)!;
    expect(r.summary).toBe('Hello there');
    expect(r.sources.map((x) => x.url)).toEqual(['https://ok.example/p']);
    s.setItem(climbCacheKey('ventoux', 'conditions'), JSON.stringify({ at: T0, data: null }));
    expect(readClimbCache('ventoux', 'conditions', T0, s)).toBeNull();
  });
  it('never throws when storage is missing or fails', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); }, removeItem: () => { throw new Error('blocked'); } };
    expect(() => writeClimbCache(answer, T0, broken)).not.toThrow();
    expect(readClimbCache('ventoux', 'conditions', T0, broken)).toBeNull();
    expect(() => writeClimbCache(answer, T0, null)).not.toThrow();
    expect(readClimbCache('ventoux', 'conditions', T0, null)).toBeNull();
  });
});
