import { describe, expect, it } from 'vitest';
import { MAX_ATTEMPTS, MAX_QUEUED, QUEUE_KEY, RideQueue } from '../../src/rideQueue';
import type { Activity } from '../../src/cloud/sync';

function memoryStore(limit = Infinity) {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (v.length > limit) throw new DOMException('full', 'QuotaExceededError');
      data.set(k, v);
    },
    removeItem: (k: string) => { data.delete(k); },
  };
}

const ride = (id: string, samples = 10): Activity => ({
  id, started_at: '2026-11-01T10:00:00.000Z', title: `Ride ${id}`, stage_id: 'heartland', stage_name: 'Heartland Rollers',
  finished: false, workout_name: null, duration_s: 3600, distance_m: 30000, climbed_m: 300, avg_power: 200, np: 210,
  max_power: 600, avg_hr: 140, max_hr: 170, avg_cadence: 88, kj: 720, tss: 60, ftp: 250, best_power: null,
  hr_zones: null, power_zones: null, max_hr_setting: 185,
  samples: { t: Array.from({ length: samples }, (_, i) => i) } as unknown as Activity['samples'],
});

describe('RideQueue', () => {
  it('keeps a ride and uploads it later, then forgets it', async () => {
    const store = memoryStore();
    const sent: string[] = [];
    const q = new RideQueue(store, async (a) => { sent.push(a.id); });
    expect(q.add('u1', ride('a'))).toBe('saved');
    expect(q.count('u1')).toBe(1);
    const r = await q.flush('u1');
    expect(r.uploaded.map((a) => a.id)).toEqual(['a']);
    expect(sent).toEqual(['a']);
    expect(q.count('u1')).toBe(0);
    expect(store.data.has(QUEUE_KEY)).toBe(false);
  });

  it('replaces an earlier copy of the same ride instead of queueing it twice', () => {
    const q = new RideQueue(memoryStore(), async () => {});
    q.add('u1', { ...ride('a'), duration_s: 600 });
    q.add('u1', { ...ride('a'), duration_s: 3600 });
    expect(q.list()).toHaveLength(1);
    expect(q.list()[0].activity.duration_s).toBe(3600);
  });

  it("only uploads the signed-in rider's rides", async () => {
    const sent: string[] = [];
    const q = new RideQueue(memoryStore(), async (a) => { sent.push(a.id); });
    q.add('u1', ride('a'));
    q.add('u2', ride('b'));
    await q.flush('u2');
    expect(sent).toEqual(['b']);
    expect(q.count('u1')).toBe(1);
    expect((await q.flush(null)).uploaded).toEqual([]);
  });

  it('stops at the first failure and keeps the rest; offline failures are not counted', async () => {
    let online = false;
    const q = new RideQueue(memoryStore(), async () => { throw new Error('Failed to fetch'); }, () => online);
    q.add('u1', ride('a'));
    q.add('u1', ride('b'));
    const r = await q.flush('u1');
    expect(r.failed).toBe(true);
    expect(q.list().map((x) => x.attempts)).toEqual([0, 0]); // offline: nobody charged
    online = true;
    await q.flush('u1');
    expect(q.list().map((x) => x.attempts)).toEqual([1, 0]); // online: only the first was tried
  });

  it('pauses automatic retries after repeated failures while online, keeping the ride', async () => {
    const q = new RideQueue(memoryStore(), async () => { throw new Error('rejected'); }, () => true);
    q.add('u1', ride('a'));
    let paused = 0;
    for (let i = 0; i < MAX_ATTEMPTS; i++) paused += (await q.flush('u1')).paused.length;
    expect(paused).toBe(1);
    expect(q.count('u1')).toBe(1); // still here: a failed upload must never lose the ride
    // An explicit retry clears the count and tries again.
    expect((await q.flush('u1', true)).paused).toEqual([]);
    expect(q.list()[0].attempts).toBe(1);
  });

  it('stops uploading when the signed-in rider changes mid-flush', async () => {
    const sent: [string, string][] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let current = 'u1';
    const q = new RideQueue(
      memoryStore(),
      async (a, userId) => { sent.push([a.id, userId]); if (a.id === 'a') await gate; },
      () => true,
      (userId) => userId === current,
    );
    q.add('u1', ride('a'));
    q.add('u1', ride('b'));
    const flushing = q.flush('u1');
    current = 'u2'; // sign out of u1 and into u2 while the first upload is in flight
    q.stop();
    release();
    await flushing;
    expect(sent).toEqual([['a', 'u1']]);
    expect(q.list().map((r) => r.activity.id)).toEqual(['b']); // still u1's, never sent as u2
  });

  it('drops the samples when a long ride will not fit in storage', () => {
    const q = new RideQueue(memoryStore(4000), async () => {});
    expect(q.add('u1', ride('a', 2000))).toBe('trimmed');
    expect(q.list()[0].activity.samples).toBeNull();
    expect(q.list()[0].activity.duration_s).toBe(3600);
  });

  it(`keeps at most ${MAX_QUEUED} rides (refusing a new one rather than dropping an unsent ride)`, () => {
    const q = new RideQueue(memoryStore(), async () => {});
    for (let i = 0; i < MAX_QUEUED; i++) expect(q.add('u1', ride(`r${i}`, 0))).toBe('saved');
    expect(q.add('u1', ride('extra', 0))).toBe('failed');
    const ids = q.list().map((r) => r.activity.id);
    expect(ids).toHaveLength(MAX_QUEUED);
    expect(ids[0]).toBe('r0'); // nothing was discarded
  });

  it('runs one flush at a time', async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const q = new RideQueue(memoryStore(), async () => { calls++; await gate; });
    q.add('u1', ride('a'));
    const one = q.flush('u1');
    const two = q.flush('u1');
    release();
    await Promise.all([one, two]);
    expect(calls).toBe(1);
  });

  it('survives storage that is blocked or holds rubbish', () => {
    expect(new RideQueue(null, async () => {}).add('u1', ride('a'))).toBe('failed');
    const store = memoryStore();
    store.data.set(QUEUE_KEY, '{not json');
    expect(new RideQueue(store, async () => {}).list()).toEqual([]);
  });
});
