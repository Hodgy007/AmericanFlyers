import { describe, expect, it } from 'vitest';
import { RAF_CATCHUP_MS, RideClock, TICK_GAP_MS, type Limits } from '../../src/rideClock';

/** Runs frames at a fixed interval for `seconds` of real time; returns the simulated seconds and the biggest substep. */
function run(clock: RideClock, intervalMs: number, seconds: number, limits: Limits = { maxCatchUpMs: RAF_CATCHUP_MS }) {
  let t = 1000;
  clock.reset(t);
  let simulated = 0;
  let biggest = 0;
  const end = t + seconds * 1000;
  while (t < end) {
    t += intervalMs;
    const s = clock.advance(t, limits);
    simulated += s.count * s.dt;
    biggest = Math.max(biggest, s.dt);
  }
  return { simulated, biggest };
}

describe('RideClock', () => {
  it('runs in real time at 60 fps with one step per frame', () => {
    const c = new RideClock();
    c.reset(0);
    const s = c.advance(16.67);
    expect(s.count).toBe(1);
    expect(s.dt).toBeCloseTo(0.01667, 4);
    const r = run(new RideClock(), 1000 / 60, 10);
    expect(r.simulated).toBeCloseTo(10, 1);
  });

  it('does not lose time at 5 fps or 1 fps (the old clamp ran these slow)', () => {
    const five = run(new RideClock(), 200, 10);
    expect(five.simulated).toBeCloseTo(10, 6);
    expect(five.biggest).toBeLessThanOrEqual(0.1 + 1e-9);
    const one = run(new RideClock(), 1000, 10);
    expect(one.simulated).toBeCloseTo(10, 6);
    expect(one.biggest).toBeLessThanOrEqual(0.1 + 1e-9);
  });

  it('catches up a 3 s hitch in substeps of at most 0.1 s', () => {
    const c = new RideClock();
    c.reset(0);
    const s = c.advance(3000, { maxCatchUpMs: RAF_CATCHUP_MS });
    expect(s.count).toBe(30);
    expect(s.dt).toBeCloseTo(0.1, 9);
    expect(s.startMs).toBe(0);
  });

  it('caps one rAF catch-up, keeping the end of the gap', () => {
    const c = new RideClock();
    c.reset(0);
    const s = c.advance(60_000, { maxCatchUpMs: RAF_CATCHUP_MS });
    expect(s.count * s.dt).toBeCloseTo(5, 6);
    expect(s.startMs).toBe(55_000);
    // ...and the next frame starts from now, not from the skipped part.
    expect(c.advance(60_016, { maxCatchUpMs: RAF_CATCHUP_MS }).count).toBe(1);
  });

  it('drops a gap with no timer tick at all (a frozen page or a machine asleep)', () => {
    const c = new RideClock();
    c.reset(0);
    expect(c.advance(30_000, { dropAboveMs: TICK_GAP_MS }).count).toBe(0);
    const next = c.advance(30_250, { dropAboveMs: TICK_GAP_MS });
    expect(next.count).toBe(3); // 250 ms in <= 0.1 s steps
    expect(next.count * next.dt).toBeCloseTo(0.25, 9);
  });

  it('simulates a 250 ms timer tick in a hidden tab', () => {
    const c = new RideClock();
    c.reset(0);
    let sim = 0;
    for (let t = 250; t <= 60_000; t += 250) {
      const s = c.advance(t, { dropAboveMs: TICK_GAP_MS });
      sim += s.count * s.dt;
    }
    expect(sim).toBeCloseTo(60, 6);
  });

  it('multiplies by the time scale and keeps the old per-step size', () => {
    const c = new RideClock(8);
    c.reset(0);
    const s = c.advance(16);
    expect(s.count).toBe(1);
    expect(s.dt).toBeCloseTo(0.016 * 8, 9);
    const r = run(new RideClock(20), 1000, 10);
    expect(r.simulated).toBeCloseTo(200, 6);
    expect(r.biggest).toBeCloseTo(0.1 * 20, 9); // 1 s of real time = 10 steps of 0.1 s real = 2 s simulated each
  });

  it('owes nothing after a reset, and ignores a clock that goes backwards', () => {
    const c = new RideClock();
    c.reset(100);
    expect(c.advance(100).count).toBe(0);
    expect(c.advance(50).count).toBe(0);
    c.reset(10_000);
    expect(c.advance(10_016).count).toBe(1);
  });

  it('treats the first advance with no reset as no time', () => {
    expect(new RideClock().advance(5000).count).toBe(0);
  });
});
