import { describe, expect, it } from 'vitest';
import { WakeLockKeeper, type WakeLockSentinelLike } from '../../src/wakeLock';

/** A fake navigator.wakeLock that records requests and lets a test release a lock as the browser does. */
function fake(opts: { refuse?: boolean } = {}) {
  const sentinels: (WakeLockSentinelLike & { released: boolean; fireRelease(): void })[] = [];
  let requests = 0;
  const host = {
    wakeLock: {
      request: async () => {
        requests++;
        if (opts.refuse) throw new Error('NotAllowedError');
        const listeners: (() => void)[] = [];
        const s = {
          released: false,
          release: async () => { s.released = true; },
          addEventListener: (_t: 'release', l: () => void) => { listeners.push(l); },
          fireRelease: () => { s.released = true; listeners.forEach((l) => l()); },
        };
        sentinels.push(s);
        return s;
      },
    },
  };
  return { host, sentinels, requests: () => requests };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('WakeLockKeeper', () => {
  it('holds the lock while the ride is on screen and releases it when it is not', async () => {
    const f = fake();
    const k = new WakeLockKeeper(f.host, () => true);
    k.setWanted(true);
    await settle();
    expect(k.held).toBe(true);
    expect(f.requests()).toBe(1);
    k.setWanted(true); // no second request while held
    await settle();
    expect(f.requests()).toBe(1);
    k.setWanted(false); // the hub or the home page opened
    expect(k.held).toBe(false);
    expect(f.sentinels[0].released).toBe(true);
  });

  it('takes the lock again when the tab is shown after the browser dropped it', async () => {
    const f = fake();
    let visible = true;
    const k = new WakeLockKeeper(f.host, () => visible);
    k.setWanted(true);
    await settle();
    visible = false;
    f.sentinels[0].fireRelease(); // hidden: the browser released it
    expect(k.held).toBe(false);
    k.visibilityChanged(); // hidden: don't ask
    await settle();
    expect(f.requests()).toBe(1);
    visible = true;
    k.visibilityChanged();
    await settle();
    expect(f.requests()).toBe(2);
    expect(k.held).toBe(true);
  });

  it('does not ask while the tab is hidden', async () => {
    const f = fake();
    const k = new WakeLockKeeper(f.host, () => false);
    k.setWanted(true);
    await settle();
    expect(f.requests()).toBe(0);
  });

  it('releases a lock that arrives after the ride left the screen', async () => {
    const f = fake();
    const k = new WakeLockKeeper(f.host, () => true);
    k.setWanted(true);
    k.setWanted(false); // before the request answers
    await settle();
    expect(k.held).toBe(false);
    expect(f.sentinels[0].released).toBe(true);
  });

  it('asks again if the ride came back on screen while a request was in flight', async () => {
    const f = fake();
    const k = new WakeLockKeeper(f.host, () => true);
    k.setWanted(true);
    k.setWanted(false);
    k.setWanted(true);
    await settle();
    await settle();
    expect(k.held).toBe(true);
    expect(f.sentinels.filter((s) => !s.released)).toHaveLength(1);
  });

  it('fails silently when refused or when there is no API', async () => {
    const refused = fake({ refuse: true });
    const k = new WakeLockKeeper(refused.host, () => true);
    k.setWanted(true);
    await settle();
    expect(k.held).toBe(false);
    const none = new WakeLockKeeper({}, () => true);
    none.setWanted(true);
    expect(none.held).toBe(false);
    expect(() => new WakeLockKeeper(undefined, () => true).setWanted(true)).not.toThrow();
  });
});
