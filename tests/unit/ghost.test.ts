import { describe, expect, it } from 'vitest';
import { Ghost, raceTime } from '../../src/ghost';

// 10 m/s for the first 5 s, then 20 m/s: distance by whole second.
const trace = { name: 'Alex R', finish_s: 10, is_me: false, distance: [0, 10, 20, 30, 40, 50, 70, 90, 110, 130, 150] };

describe('Ghost', () => {
  const g = new Ghost(trace);

  it('replays distance second by second, interpolating between samples', () => {
    expect(g.distanceAt(0)).toBe(0);
    expect(g.distanceAt(3)).toBe(30);
    expect(g.distanceAt(2.5)).toBeCloseTo(25, 9);
    expect(g.distanceAt(5.5)).toBeCloseTo(60, 9);
  });

  it('clamps before the start and after the end', () => {
    expect(g.distanceAt(-4)).toBe(0);
    expect(g.distanceAt(10)).toBe(150);
    expect(g.distanceAt(999)).toBe(150);
  });

  it('is empty-safe', () => {
    expect(new Ghost({ ...trace, distance: [] }).distanceAt(5)).toBe(0);
  });

  it('reports speed over a one-second window and never negative', () => {
    expect(g.speedAt(2)).toBeCloseTo(10, 6);
    expect(g.speedAt(8)).toBeCloseTo(20, 6);
    expect(g.speedAt(200)).toBe(0);
  });

  it('labels itself', () => {
    expect(g.label).toBe('Alex R (ghost)');
    expect(new Ghost({ ...trace, is_me: true }).label).toBe('Your best');
    expect(g.finishS).toBe(10);
  });
});

describe('raceTime', () => {
  it('formats m:ss and h:mm:ss', () => {
    expect(raceTime(0)).toBe('0:00');
    expect(raceTime(65)).toBe('1:05');
    expect(raceTime(42 * 60 + 10)).toBe('42:10');
    expect(raceTime(3600)).toBe('1:00:00');
    expect(raceTime(3723.9)).toBe('1:02:03');
  });
});
