import { describe, expect, it } from 'vitest';
import { RideRecorder } from '../../src/cloud/recorder';
import { RideStats } from '../../src/stats';
import {
  buildSnapshot, createSnapshotKeeper, interruptedActivity, judgeSnapshot, parseSnapshot, replayStats, restoreSpan, resumedFlags, resumedRide,
  serialiseSnapshot, snapshotSummary, snapshotUsable, SNAPSHOT_EVERY_MS, SNAPSHOT_KEY, SNAPSHOT_MAX_AGE_MS,
  type ResumeChoice, type RideSnapshot, type SnapshotInput, type SnapshotKeeperDeps,
} from '../../src/rideSnapshot';

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

const zones = () => ({ ftp: 250, maxHr: 185 });

// A snapshot in exactly the form an earlier release wrote it (literal JSON, so a change of format fails here).
const STORED_V1 = JSON.stringify({
  v: 1, takenAt: 1_000_000, accountId: 'me', stageId: 'alpe-dhuez', stageName: 'Alpe d’Huez',
  ride: { distance: 5000, startDistance: 0, movingTime: 61, climbed: 200, work: 12200, proM: 0, planCounted: false },
  flags: { usedDemo: false, timeScale: 1, splitByWorkout: false },
  span: {
    id: 'old', startedAt: '2026-01-01T10:00:00.000Z', samples: secs(61),
    dist0: 0, climb0: 0, proM0: 0, workout: null, workoutCompleted: null, distanceM: 5000, climbedM: 200,
  },
});

describe('a stored snapshot in the existing format', () => {
  it('is still accepted, and uses the existing key', () => {
    expect(SNAPSHOT_KEY).toBe('americanflyers.rideSnapshot');
    const s = parseSnapshot(STORED_V1);
    expect(s?.span.id).toBe('old');
    expect(s && judgeSnapshot(s, 1_000_000 + 60_000, 'me', exists)).toBe('offer');
  });
  it('is accepted without the optional fields an earlier release may not have written', () => {
    const o = JSON.parse(STORED_V1);
    delete o.ride.planCounted; delete o.flags.usedDemo; delete o.flags.splitByWorkout; delete o.span.startedAt; delete o.span.workout;
    const s = parseSnapshot(JSON.stringify(o));
    expect(s?.ride.planCounted).toBe(false);
    expect(s?.span.startedAt).toBeNull();
    expect(s?.span.workout).toBeNull();
  });
});

const input = (over: Partial<SnapshotInput> = {}, n = 1930): SnapshotInput => ({
  now: 1_000_000, accountId: 'me', stage: { id: 'alpe-dhuez', name: 'Alpe d’Huez' },
  ride: { distance: 14200, startDistance: 0, movingTime: n, climbed: 600, work: 200 * n, proM: 40, planCounted: true },
  flags: { usedDemo: false, timeScale: 1 },
  span: { id: 'abc', startedAt: new Date('2026-01-01T10:00:00.000Z'), samples: secs(n), base: { dist: 100, climbed: 10, proM: 5 }, workout: null, completed: null, distanceM: 14100, climbedM: 590 },
  ...over,
});

describe('building a snapshot', () => {
  it('copies the ride, the stage, the flags and the span', () => {
    const s = buildSnapshot(input());
    expect(s).toMatchObject({
      v: 1, takenAt: 1_000_000, accountId: 'me', stageId: 'alpe-dhuez', stageName: 'Alpe d’Huez',
      ride: { distance: 14200, startDistance: 0, movingTime: 1930, climbed: 600, work: 386000, proM: 40, planCounted: true },
      flags: { usedDemo: false, timeScale: 1, splitByWorkout: false },
      span: { id: 'abc', startedAt: '2026-01-01T10:00:00.000Z', dist0: 100, climb0: 10, proM0: 5, workout: null, workoutCompleted: null, distanceM: 14100, climbedM: 590 },
    });
  });
  it('keeps only the ride fields it knows, and an unstarted recorder as null', () => {
    const wide = { ...input().ride, speed: 9, lastElev: 3, finished: false } as SnapshotInput['ride'];
    const s = buildSnapshot(input({ ride: wide, span: { ...input().span, startedAt: null, workout: 'Sweet spot', completed: 'Sweet spot' } }));
    expect(Object.keys(s.ride).sort()).toEqual(['climbed', 'distance', 'movingTime', 'planCounted', 'proM', 'startDistance', 'work']);
    expect(s.span.startedAt).toBeNull();
    expect(s.span.workout).toBe('Sweet spot');
    expect(s.span.workoutCompleted).toBe('Sweet spot');
  });
  it('turns an unset splitByWorkout into false', () => {
    expect(buildSnapshot(input({ flags: { usedDemo: true, timeScale: 4, splitByWorkout: true } })).flags).toEqual({ usedDemo: true, timeScale: 4, splitByWorkout: true });
  });
  it('round trips: build, store, read, resume values equal the original', () => {
    const i = input({ flags: { usedDemo: false, timeScale: 1, splitByWorkout: false } });
    const s = parseSnapshot(serialiseSnapshot(buildSnapshot(i)))!;
    expect(s).toEqual(buildSnapshot(i));
    expect(resumedRide(s)).toEqual({ ...i.ride, speed: 0, finished: false, finishTime: 0, racePlace: 0, raceSize: 0 });
    const sp = restoreSpan(s, zones);
    expect(sp.rec.id).toBe('abc');
    expect(sp.rec.startedAt).toEqual(i.span.startedAt);
    expect(sp.rec.samples).toEqual(i.span.samples);
    expect(sp.base).toEqual(i.span.base);
    expect(sp.st.seconds).toBe(1930);
    expect(sp.saved).toBe(0);
    expect(sp.workout).toBeNull();
  });
});

describe('resuming', () => {
  it('starts a ride from the stored position, not finished and not moving', () => {
    expect(resumedRide(snap())).toEqual({
      distance: 14200, startDistance: 0, speed: 0, movingTime: 1930, climbed: 600, work: 386000, proM: 0, planCounted: false,
      finished: false, finishTime: 0, racePlace: 0, raceSize: 0,
    });
  });
  it('marks a sped-up clock as demo, and a workout as split', () => {
    expect(resumedFlags(snap())).toEqual({ usedDemo: false, splitByWorkout: false });
    expect(resumedFlags(snap({ flags: { usedDemo: false, timeScale: 2, splitByWorkout: false } }))).toEqual({ usedDemo: true, splitByWorkout: false });
    expect(resumedFlags(snap({ flags: { usedDemo: true, timeScale: 1, splitByWorkout: false } })).usedDemo).toBe(true);
    const w = snap();
    w.span.workout = 'Sweet spot';
    expect(resumedFlags(w)).toEqual({ usedDemo: false, splitByWorkout: true });
  });
  it('restores a workout activity with its name, as the span (it carries on as a ride)', () => {
    const w = snap();
    w.span.workout = 'Sweet spot';
    w.span.workoutCompleted = 'Sweet spot';
    const sp = restoreSpan(w, zones);
    expect(sp.workout).toBe('Sweet spot');
    expect(sp.completed).toBe('Sweet spot');
  });
});

describe('an interrupted ride saved as it was', () => {
  it('builds an unfinished row with the stage, the id and the span’s own distance', () => {
    const s = snap({ ride: { ...snap().ride, proM: 1000 } }, 600);
    s.span.proM0 = 400;
    const row = interruptedActivity(s, zones);
    expect(row.id).toBe('abc');
    expect(row.started_at).toBe('2026-01-01T10:00:00.000Z');
    expect(row.stage_id).toBe('alpe-dhuez');
    expect(row.stage_name).toBe('Alpe d’Huez');
    expect(row.finished).toBe(false);
    expect(row.duration_s).toBe(600);
    expect(row.distance_m).toBe(14200);
    expect(row.climbed_m).toBe(600);
    expect(row.avg_power).toBe(200);
  });
});

/** A keeper over a fake storage, clock and ride, with the calls made to the rest of the app logged. */
function rig(over: Partial<SnapshotKeeperDeps> = {}, stored: string | null = null) {
  const store = new Map<string, string>();
  if (stored !== null) store.set(SNAPSHOT_KEY, stored);
  const log: string[] = [];
  const st = { account: 'me' as string | undefined, idle: false, notResumable: false, seconds: 120, started: false, now: 1_000_000, full: false, choice: 'resume' as ResumeChoice, stage: true };
  const deps: SnapshotKeeperDeps = {
    storage: () => ({
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => { if (st.full) throw new Error('quota'); store.set(k, v); },
      removeItem: (k) => { store.delete(k); },
    }),
    now: () => st.now,
    accountId: () => st.account,
    idle: () => st.idle,
    notResumable: () => st.notResumable,
    seconds: () => st.seconds,
    input: (me) => input({ now: st.now, accountId: me }, st.seconds),
    stageExists: () => st.stage,
    rideStarted: () => st.started,
    imperial: () => false,
    ask: async () => { log.push('ask'); return st.choice; },
    resume: () => { log.push('resume'); },
    saveInterrupted: async () => { log.push('save'); },
    ...over,
  };
  const keeper = createSnapshotKeeper(deps);
  return { keeper, store, log, st };
}

describe('when a snapshot is written', () => {
  it('writes about every 20 s, and not in between', async () => {
    const { keeper, store, st } = rig();
    st.now = 1_000_000;
    await keeper.offer(); // nothing stored: the account's leftover copy has been dealt with
    keeper.tick(100_000);
    expect(store.has(SNAPSHOT_KEY)).toBe(true);
    store.delete(SNAPSHOT_KEY);
    keeper.tick(100_000 + SNAPSHOT_EVERY_MS - 1);
    expect(store.has(SNAPSHOT_KEY)).toBe(false);
    keeper.tick(100_000 + SNAPSHOT_EVERY_MS);
    expect(store.has(SNAPSHOT_KEY)).toBe(true);
  });
  it('does not write before the leftover copy has been dealt with, or for another account', async () => {
    const { keeper, store, st } = rig();
    keeper.write();
    expect(store.size).toBe(0);
    await keeper.offer();
    st.account = undefined;
    keeper.write();
    expect(store.size).toBe(0);
  });
  it('skips (and keeps what is there) while idle, in a race or event, or once finished', async () => {
    const { keeper, store, st } = rig();
    await keeper.offer();
    keeper.write();
    const first = store.get(SNAPSHOT_KEY);
    expect(first).toBeDefined();
    st.idle = true; st.now += 5000;
    keeper.write();
    expect(store.get(SNAPSHOT_KEY)).toBe(first);
    st.idle = false; st.notResumable = true;
    keeper.write();
    expect(store.get(SNAPSHOT_KEY)).toBe(first);
  });
  it('clears its own copy once the ride is under a minute, and never a leftover one it has not written', async () => {
    const { keeper, store, st } = rig();
    st.seconds = 30;
    await keeper.offer();
    store.set(SNAPSHOT_KEY, STORED_V1); // as if an earlier run's
    keeper.write(); // too short and not ours: untouched
    expect(store.get(SNAPSHOT_KEY)).toBe(STORED_V1);
    st.seconds = 120;
    keeper.write();
    expect(store.get(SNAPSHOT_KEY)).not.toBe(STORED_V1);
    st.seconds = 30;
    keeper.write();
    expect(store.has(SNAPSHOT_KEY)).toBe(false);
  });
  it('clear() removes only a copy this run wrote', async () => {
    const { keeper, store } = rig();
    await keeper.offer();
    store.set(SNAPSHOT_KEY, STORED_V1);
    keeper.clear();
    expect(store.get(SNAPSHOT_KEY)).toBe(STORED_V1);
    keeper.write();
    keeper.clear();
    expect(store.has(SNAPSHOT_KEY)).toBe(false);
  });
  it('drops the copy silently when it does not fit', async () => {
    const { keeper, store, st } = rig();
    await keeper.offer();
    keeper.write();
    expect(store.has(SNAPSHOT_KEY)).toBe(true);
    st.full = true;
    expect(() => keeper.write()).not.toThrow();
    expect(store.has(SNAPSHOT_KEY)).toBe(false);
    keeper.clear(); // no longer owned: nothing to do
  });
  it('writes again for the next account after forgetHandled()', async () => {
    const { keeper, store, st } = rig();
    await keeper.offer();
    keeper.forgetHandled();
    keeper.write();
    expect(store.size).toBe(0);
    st.account = 'next';
    await keeper.offer();
    keeper.write();
    expect(store.size).toBe(1);
  });
  it('writes a copy that reads back as what was recorded', async () => {
    const { keeper, store, st } = rig();
    st.seconds = 90;
    await keeper.offer();
    keeper.write();
    const s = parseSnapshot(store.get(SNAPSHOT_KEY));
    expect(s?.accountId).toBe('me');
    expect(s?.span.samples.power).toHaveLength(90);
  });
});

describe('what happens to a snapshot left by an earlier run', () => {
  const T = 1_000_000;
  it('offers a young one and resumes it when asked, removing it first', async () => {
    const { keeper, store, log, st } = rig({}, STORED_V1);
    st.now = T + 60_000;
    await keeper.offer();
    expect(log).toEqual(['ask', 'resume']);
    expect(store.has(SNAPSHOT_KEY)).toBe(false);
  });
  it('saves it as it was when the rider chooses to', async () => {
    const { keeper, store, log, st } = rig({}, STORED_V1);
    st.now = T + 60_000; st.choice = 'save';
    await keeper.offer();
    expect(log).toEqual(['ask', 'save']);
    expect(store.has(SNAPSHOT_KEY)).toBe(false);
  });
  it('discards it when the rider says so', async () => {
    const { keeper, store, log, st } = rig({}, STORED_V1);
    st.now = T + 60_000; st.choice = 'discard';
    await keeper.offer();
    expect(log).toEqual(['ask']);
    expect(store.has(SNAPSHOT_KEY)).toBe(false);
  });
  it('saves one older than three hours quietly, without asking', async () => {
    const { keeper, store, log, st } = rig({}, STORED_V1);
    st.now = T + SNAPSHOT_MAX_AGE_MS + 1;
    await keeper.offer();
    expect(log).toEqual(['save']);
    expect(store.has(SNAPSHOT_KEY)).toBe(false);
  });
  it('saves one whose stage is gone, or when a ride has already started this visit', async () => {
    const a = rig({}, STORED_V1);
    a.st.now = T + 1000; a.st.stage = false;
    await a.keeper.offer();
    expect(a.log).toEqual(['save']);
    const b = rig({}, STORED_V1);
    b.st.now = T + 1000; b.st.started = true;
    await b.keeper.offer();
    expect(b.log).toEqual(['save']);
    expect(b.store.has(SNAPSHOT_KEY)).toBe(false);
  });
  it('drops one under a minute, and one that cannot be read', async () => {
    const short = JSON.parse(STORED_V1);
    for (const k of Object.keys(short.span.samples)) short.span.samples[k] = short.span.samples[k].slice(0, 30);
    const a = rig({}, JSON.stringify(short));
    a.st.now = T + 1000;
    await a.keeper.offer();
    expect(a.log).toEqual([]);
    expect(a.store.has(SNAPSHOT_KEY)).toBe(false);
    const b = rig({}, '{not json');
    await b.keeper.offer();
    expect(b.store.has(SNAPSHOT_KEY)).toBe(false);
  });
  it('leaves another rider’s alone, and asks nothing', async () => {
    const { keeper, store, log, st } = rig({}, STORED_V1);
    st.account = 'someone-else'; st.now = T + 1000;
    await keeper.offer();
    expect(log).toEqual([]);
    expect(store.get(SNAPSHOT_KEY)).toBe(STORED_V1);
  });
  it('does nothing when signed out, and keeps the copy if the rider signs out while the question is open', async () => {
    const a = rig({}, STORED_V1);
    a.st.account = undefined;
    await a.keeper.offer();
    expect(a.log).toEqual([]);
    const b: ReturnType<typeof rig> = rig({ ask: async () => { b.st.account = undefined; b.log.push('ask'); return 'resume'; } }, STORED_V1);
    b.st.now = T + 1000;
    await b.keeper.offer();
    expect(b.log).toEqual(['ask']); // not resumed
    expect(b.store.get(SNAPSHOT_KEY)).toBe(STORED_V1);
  });
  it('asks only once at a time, and once per account', async () => {
    let release: (c: ResumeChoice) => void = () => {};
    const { keeper, log, st } = rig({ ask: () => new Promise<ResumeChoice>((r) => { release = r; }) }, STORED_V1);
    st.now = T + 1000;
    const first = keeper.offer();
    await keeper.offer(); // already offering: returns at once
    release('discard');
    await first;
    await keeper.offer(); // handled for this account
    expect(log).toEqual([]);
  });
});
