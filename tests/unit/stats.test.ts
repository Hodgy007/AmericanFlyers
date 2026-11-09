import { describe, expect, it } from 'vitest';
import { RideStats } from '../../src/stats';

/** Feeds `n` one-second samples of constant power, as the app's frame loop does. */
function feed(stats: RideStats, power: number, n: number, opts: { cadence?: number; hr?: number; moving?: boolean } = {}) {
  for (let i = 0; i < n; i++) stats.add(1, power, opts.cadence ?? 90, opts.hr ?? 0, opts.moving ?? true);
}

describe('RideStats averages', () => {
  it('reports avg, normalized, max and best-effort power for a constant series', () => {
    const stats = new RideStats();
    feed(stats, 200, 300);
    expect(stats.seconds).toBe(300);
    expect(stats.avgPower).toBeCloseTo(200, 9);
    // A constant effort has a constant 30 s rolling average, so NP = avg.
    expect(stats.np).toBeCloseTo(200, 9);
    expect(stats.maxPower).toBeCloseTo(200, 9);
    expect(stats.best[5]).toBeCloseTo(200, 9);
    expect(stats.best[60]).toBeCloseTo(200, 9);
    expect(stats.best60).toBeCloseTo(200, 9);
  });

  it('needs a full 60 s before it reports a 60 s best effort', () => {
    const stats = new RideStats();
    feed(stats, 250, 59);
    expect(stats.best[60]).toBe(0);
    feed(stats, 250, 1);
    expect(stats.best[60]).toBeCloseTo(250, 9);
  });

  it('finds the 5 s best effort over a warm-up spike', () => {
    const stats = new RideStats();
    feed(stats, 100, 10); // 10 s easy
    feed(stats, 500, 5); // a 5 s sprint
    feed(stats, 100, 10);
    // Only the sprint window averages to more than a steady 100 W.
    expect(stats.best[5]).toBeCloseTo(500, 9);
    // 25 samples are not a full 60 s window, so there is no 60 s best effort yet.
    expect(stats.best[60]).toBe(0);
    expect(stats.maxPower).toBeCloseTo(500, 9);
  });

  it('finds the highest average over any 60 s window, not the mean of the whole ride', () => {
    const stats = new RideStats();
    feed(stats, 100, 60);
    feed(stats, 300, 60);
    feed(stats, 100, 60);
    expect(stats.best[60]).toBeCloseTo(300, 9);
    expect(stats.avgPower).toBeCloseTo(500 / 3, 9);
  });

  it('ignores time when not moving', () => {
    const stats = new RideStats();
    feed(stats, 200, 10);
    feed(stats, 2000, 10, { moving: false });
    stats.add(1, 0, 0, 0, false);
    stats.add(0, 0, 0, 0, true); // no time passed
    expect(stats.seconds).toBe(10);
    expect(stats.maxPower).toBeCloseTo(200, 9);
    expect(stats.avgPower).toBeCloseTo(200, 9);
  });

  it('carries the part-second overshoot into the next sample', () => {
    const stats = new RideStats();
    // A 0.6 s frame at 100 W closes no sample. Then one 0.7 s frame at 200 W: the sample closes
    // at (0.6*100 + 0.7*200) / 1.3 = 153.8 W over the whole span (the loop has no finer split).
    stats.add(0.6, 100, 90, 0, true);
    expect(stats.maxPower).toBe(0);
    stats.add(0.7, 200, 90, 0, true);
    expect(stats.seconds).toBeCloseTo(1.3, 9);
    expect(stats.maxPower).toBeCloseTo(2000 / 13, 9);
    expect(stats.work).toBeCloseTo(0.6 * 100 + 0.7 * 200, 9);

    // Samples are one second each: two 0.5 s frames of different power make one 150 W second.
    const halves = new RideStats();
    halves.add(0.5, 100, 90, 0, true);
    halves.add(0.5, 200, 90, 0, true);
    expect(halves.maxPower).toBeCloseTo(150, 9);
    expect(halves.best[5]).toBe(0); // five samples are needed
    for (let i = 0; i < 4; i++) halves.add(1, 150, 90, 0, true);
    expect(halves.best[5]).toBeCloseTo(150, 9);
  });
});

describe('RideStats training load', () => {
  it('is about 100 TSS for an hour at FTP with an even effort', () => {
    const stats = new RideStats(() => ({ ftp: 200, maxHr: 185 }));
    feed(stats, 200, 3600);
    expect(stats.np).toBeCloseTo(200, 9);
    expect(stats.tss(200)).toBeCloseTo(100, 6);
    expect(stats.avgCadence).toBeCloseTo(90, 9);
    expect(stats.avgHr).toBe(0); // no HR sent
  });

  it('weights normalized power up for a spiky effort', () => {
    const steady = new RideStats();
    feed(steady, 200, 600);
    const spiky = new RideStats();
    feed(spiky, 150, 300);
    feed(spiky, 250, 300);
    expect(spiky.avgPower).toBeCloseTo(steady.avgPower, 9);
    expect(spiky.np).toBeGreaterThan(spiky.avgPower);
  });

  it('averages cadence and heart rate while they are reported', () => {
    const stats = new RideStats();
    feed(stats, 200, 10, { cadence: 80, hr: 140 });
    feed(stats, 200, 10, { cadence: 0, hr: 0 });
    expect(stats.avgCadence).toBeCloseTo(80, 9); // only pedalling time counts
    expect(stats.avgHr).toBeCloseTo(140, 9);
    expect(stats.maxHr).toBe(140);
  });

  it('is all zero on an empty ride', () => {
    const stats = new RideStats();
    expect(stats.avgPower).toBe(0);
    expect(stats.np).toBe(0);
    expect(stats.avgCadence).toBe(0);
    expect(stats.best60).toBe(0);
  });
});
