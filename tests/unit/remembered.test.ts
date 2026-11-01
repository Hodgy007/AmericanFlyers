import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEVICES_KEY, RECONNECT_DELAYS_MS, Reconnector, forgetRemembered, loadRemembered, menuLabel, onGattDrop, rememberDevice,
  waitForAdvertisement,
} from '../../src/ble/remembered';

/** A tiny in-memory localStorage. */
function memory(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(DEVICES_KEY, initial);
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}

describe('remembered devices storage', () => {
  it('reads nothing from an empty, broken or odd store', () => {
    expect(loadRemembered(memory())).toEqual({});
    expect(loadRemembered(memory('not json'))).toEqual({});
    expect(loadRemembered(memory('{"trainer":{"id":5},"hr":"x"}'))).toEqual({});
    expect(loadRemembered(null)).toEqual({});
  });

  it('remembers a trainer and a strap separately and replaces on reconnect', () => {
    const store = memory();
    rememberDevice('trainer', { id: 'a1', name: 'Trainer One' }, store);
    rememberDevice('hr', { id: 'b2', name: 'Strap' }, store);
    expect(loadRemembered(store)).toEqual({ trainer: { id: 'a1', name: 'Trainer One' }, hr: { id: 'b2', name: 'Strap' } });
    rememberDevice('trainer', { id: 'c3', name: 'Trainer Two' }, store);
    expect(loadRemembered(store).trainer).toEqual({ id: 'c3', name: 'Trainer Two' });
    expect(loadRemembered(store).hr?.id).toBe('b2');
  });

  it('gives a nameless device a friendly name and rejects an empty id', () => {
    const store = memory();
    rememberDevice('hr', { id: 'x', name: '' }, store);
    expect(loadRemembered(store).hr?.name).toBe('Bluetooth device');
    rememberDevice('trainer', { id: '', name: 'No id' }, store);
    expect(loadRemembered(store).trainer).toBeUndefined();
  });

  it('forgets one kind and keeps the other', () => {
    const store = memory();
    rememberDevice('trainer', { id: 'a', name: 'T' }, store);
    rememberDevice('hr', { id: 'b', name: 'H' }, store);
    expect(forgetRemembered('trainer', store)).toEqual({ hr: { id: 'b', name: 'H' } });
    expect(loadRemembered(store)).toEqual({ hr: { id: 'b', name: 'H' } });
  });

  it('does not throw when storage refuses writes', () => {
    const broken = { getItem: () => null, setItem: () => { throw new Error('full'); } };
    expect(() => rememberDevice('trainer', { id: 'a', name: 'T' }, broken)).not.toThrow();
  });
});

describe('Reconnector', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('backs off 1, 2, 4, 8 and 15 seconds, then gives up', async () => {
    const times: number[] = [];
    const start = Date.now();
    const onGiveUp = vi.fn();
    const r = new Reconnector({
      attempt: async () => { times.push(Date.now() - start); return false; },
      onSuccess: vi.fn(),
      onGiveUp,
    });
    r.start();
    await vi.advanceTimersByTimeAsync(40_000);
    expect(times).toEqual([1000, 3000, 7000, 15000, 30000]);
    expect(RECONNECT_DELAYS_MS).toEqual([1000, 2000, 4000, 8000, 15000]);
    expect(onGiveUp).toHaveBeenCalledOnce();
    expect(r.active).toBe(false);
  });

  it('stops retrying after a success', async () => {
    const attempt = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const onSuccess = vi.fn();
    const onGiveUp = vi.fn();
    const r = new Reconnector({ attempt, onSuccess, onGiveUp });
    r.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it('treats a throwing attempt as a failure', async () => {
    const attempt = vi.fn().mockRejectedValueOnce(new Error('gatt')).mockResolvedValueOnce(true);
    const onSuccess = vi.fn();
    new Reconnector({ attempt, onSuccess, onGiveUp: vi.fn() }).start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('can be stopped, and ignores a result that arrives after', async () => {
    let finish!: (ok: boolean) => void;
    const attempt = vi.fn(() => new Promise<boolean>((res) => { finish = res; }));
    const onSuccess = vi.fn();
    const r = new Reconnector({ attempt, onSuccess, onGiveUp: vi.fn() });
    r.start();
    await vi.advanceTimersByTimeAsync(1000); // first attempt now in flight
    r.stop();
    finish(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(r.active).toBe(false);
  });
});

/** Just enough of a BluetoothDevice for the helpers. */
function fakeDevice(opts: { watch?: boolean } = {}) {
  const target = new EventTarget();
  const device = Object.assign(target, {
    watchAdvertisements: opts.watch === false ? undefined : vi.fn(async () => {}),
  });
  return device as unknown as BluetoothDevice & EventTarget;
}

describe('waitForAdvertisement', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves true on the first advertisement', async () => {
    const d = fakeDevice();
    const p = waitForAdvertisement(d, 5000);
    d.dispatchEvent(new Event('advertisementreceived'));
    await expect(p).resolves.toBe(true);
  });

  it('resolves false on timeout', async () => {
    const d = fakeDevice();
    const p = waitForAdvertisement(d, 5000);
    await vi.advanceTimersByTimeAsync(5001);
    await expect(p).resolves.toBe(false);
  });

  it('resolves false at once without watchAdvertisements, and when it rejects', async () => {
    await expect(waitForAdvertisement(fakeDevice({ watch: false }))).resolves.toBe(false);
    const d = fakeDevice();
    (d.watchAdvertisements as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('no'));
    await expect(waitForAdvertisement(d)).resolves.toBe(false);
  });
});

describe('onGattDrop', () => {
  it('reports a drop once per connection, only after arming, and replaces the earlier listener', () => {
    const d = fakeDevice();
    const first = vi.fn();
    const a = onGattDrop(d, first);
    d.dispatchEvent(new Event('gattserverdisconnected'));
    expect(first).not.toHaveBeenCalled(); // not armed: setup was still running
    a.arm();
    const second = vi.fn();
    const b = onGattDrop(d, second); // reconnect on the same device
    b.arm();
    d.dispatchEvent(new Event('gattserverdisconnected'));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});

describe('menuLabel', () => {
  const remembered = { id: 'a', name: 'KICKR 1234' };
  it('offers to connect when nothing is remembered', () => {
    expect(menuLabel({ kind: 'trainer', state: 'idle' }).label).toBe('🔌 Connect trainer');
    expect(menuLabel({ kind: 'hr', state: 'idle' }).label).toBe('❤️ Heart rate');
  });
  it('offers one-tap reconnect for a remembered device', () => {
    expect(menuLabel({ kind: 'trainer', state: 'idle', remembered }).label).toBe('🔌 Reconnect KICKR 1234');
    expect(menuLabel({ kind: 'hr', state: 'reconnecting', remembered }).label).toContain('Reconnect KICKR 1234');
  });
  it('offers to disconnect a connected device by name', () => {
    expect(menuLabel({ kind: 'hr', state: 'connected', connectedName: 'Strap', remembered }).label).toBe('❤️ Disconnect Strap');
  });
});
