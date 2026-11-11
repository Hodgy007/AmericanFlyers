import { describe, expect, it } from 'vitest';
import { RideRecorder } from '../../src/cloud/recorder';
import { RideStats } from '../../src/stats';
import { judgeSnapshot, parseSnapshot, replayStats, serialiseSnapshot, snapshotSummary, snapshotUsable, SNAPSHOT_MAX_AGE_MS, type RideSnapshot } from '../../src/rideSnapshot';

const secs = (n: number, power = 200) => ({
  power: Array(n).fill(power), cadence: Array(n).fill(90), hr: Array(n).fill(140),
  speed: Array(n).fill(80), distance: Array.from({ length: n }, (_, i) => i * 8), elevation: Array(n).fill(12000),
});

function snap(over: Partial<RideSnapshot> = {}, n = 1930): RideSnapshot {
  return {
    v: 1, takenAt: 1_000_000, accountId: 'me', stageId: 'alpe-dhuez', stageName: 'Alpe d’Huez',
    ride: { distance: 14200, startDistance: 0, movingTime: n, climbed: 600, work: 200 * n, proM: 0, planCounted: false },
    flags: { usedDemo: false, timeScale: 1, splitByWorkout: false },
    span: { id: 'abc', startedAt: '2026-01-01T10:00:00.000Z', samples: secs(n), dist0: 0, climb0: 0, proM0: 0, workout: null, workoutCompleted: null, distanceM: 14200, climbedM: 600 },
    ...over,
  };
}
const exists = (id: string) => id === 'alpe-dhuez';

describe('snapshot serialise and parse', () => {
  it('round-trips', () => {
    const s = snap();
    expect(parseSnapshot(serialiseSnapshot(s))).toEqual(s);
  });
  it('rejects missing, damaged and foreign values', () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot('')).toBeNull();
    expect(parseSnapshot('{not json')).toBeNull();
    expect(parseSnapshot(JSON.stringify({ ...snap(), v: 2 }))).toBeNull();
    expect(parseSnapshot(JSON.stringify({ ...snap(), accountId: 5 }))).toBeNull();
    const bad = snap();
    bad.span.samples.hr.pop(); // arrays of different lengths
    expect(parseSnapshot(JSON.stringify(bad))).toBeNull();
    const nan = JSON.parse(serialiseSnapshot(snap()));
    nan.ride.distance = 'far';
    expect(parseSnapshot(JSON.stringify(nan))).toBeNull();
  });
});

describe('is a snapshot usable', () => {
  const t = 1_000_000;
  it('offers a recent ride of a minute or more on a stage that exists, for the same account', () => {
    expect(snapshotUsable(snap(), t + 10 * 60_000, 'me', exists)).toBe(true);
    expect(judgeSnapshot(snap({}, 60), t + 1000, 'me', exists)).toBe('offer');
  });
  it('does not offer one under a minute, and drops it', () => {
    expect(judgeSnapshot(snap({}, 59), t + 1000, 'me', exists)).toBe('drop');
  });
  it('never touches another rider’s', () => {
    expect(judgeSnapshot(snap(), t + 1000, 'someone-else', exists)).toBe('drop');
  });
  it('saves quietly one older than three hours, or whose stage is gone', () => {
    expect(judgeSnapshot(snap(), t + SNAPSHOT_MAX_AGE_MS + 1, 'me', exists)).toBe('save');
    expect(judgeSnapshot(snap(), t + SNAPSHOT_MAX_AGE_MS - 1, 'me', exists)).toBe('offer');
    expect(judgeSnapshot(snap(), t + 1000, 'me', () => false)).toBe('save');
  });
});

describe('snapshot summary', () => {
  it('reads like the prompt', () => {
    const s = snap();
    expect(snapshotSummary(s, s.takenAt + 7 * 60_000, false)).toBe('32:10 · 14.2 km, interrupted 7 min ago');
    expect(snapshotSummary(s, s.takenAt + 7 * 60_000, true)).toBe('32:10 · 8.8 mi, interrupted 7 min ago');
    expect(snapshotSummary(s, s.takenAt + 20_000, false)).toMatch(/moments ago$/);
    expect(snapshotSummary(s, s.takenAt + 95 * 60_000, false)).toMatch(/1 h 35 min ago$/);
  });
  it('shows hours for a long ride', () => {
    expect(snapshotSummary(snap({}, 3725), 1_000_000, false)).toMatch(/^1:02:05 /);
  });
});

describe('restoring a ride', () => {
  it('rebuilds the recorder with the same id and samples', () => {
    const s = snap({}, 120);
    const rec = RideRecorder.restore(s.span.id, s.span.startedAt, s.span.samples);
    expect(rec.id).toBe('abc');
    expect(rec.startedAt?.toISOString()).toBe('2026-01-01T10:00:00.000Z');
    expect(rec.seconds).toBe(120);
    expect(rec.samples.distance[119]).toBe(119 * 8);
    rec.tick(1, true, { power: 300, cadence: 90, hr: 140, speedMs: 8, distance: 1000, elevation: 1200 });
    expect(rec.seconds).toBe(121); // carries on from where it was
    expect(s.span.samples.power).toHaveLength(120); // the snapshot's own arrays are not shared
  });
  it('replays the samples into the stats', () => {
    const st = replayStats(secs(600, 250), new RideStats(() => ({ ftp: 250, maxHr: 185 })));
    expect(st.seconds).toBe(600);
    expect(st.avgPower).toBeCloseTo(250, 6);
    expect(st.np).toBeCloseTo(250, 3);
    expect(st.best[60]).toBeCloseTo(250, 6);
    expect(st.avgHr).toBeCloseTo(140, 6);
    expect(st.avgCadence).toBeCloseTo(90, 6);
  });
});
