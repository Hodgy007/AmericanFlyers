import { describe, expect, it } from 'vitest';
import { ENGAGEMENT_POINTS, MAX_TICK_RATE, TICK_SECONDS, renderTick, tickRate } from '../../src/freewheel';

describe('freewheel', () => {
  it('ticks once per engagement point per wheel turn the wheel gains on the cassette', () => {
    expect(tickRate(2, 0)).toBeCloseTo(2 * ENGAGEMENT_POINTS);
    expect(tickRate(4, 3)).toBeCloseTo(ENGAGEMENT_POINTS);
  });

  it('is silent when the cassette keeps up (pedalling) or the wheel has nearly stopped', () => {
    expect(tickRate(4, 4)).toBe(0);
    expect(tickRate(3, 3.5)).toBe(0);
    expect(tickRate(0.05, 0)).toBe(0);
  });

  it('caps the rate at speed', () => {
    expect(tickRate(50, 0)).toBe(MAX_TICK_RATE);
  });

  it('renders a short tick that peaks at 1 and dies away', () => {
    const sr = 48000;
    const t = renderTick(sr, 0);
    expect(t.length).toBe(Math.round(sr * TICK_SECONDS));
    const peak = Math.max(...Array.from(t, Math.abs));
    expect(peak).toBeCloseTo(1, 5);
    const tail = Math.max(...Array.from(t.slice(-Math.round(sr * 0.005)), Math.abs));
    expect(tail).toBeLessThan(0.02);
  });

  it('gives each variant a slightly different sound, repeatably', () => {
    const a = renderTick(44100, 1);
    expect(renderTick(44100, 1)).toEqual(a);
    expect(renderTick(44100, 2)).not.toEqual(a);
  });
});
