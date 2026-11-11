// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Presence } from '../../src/cloud/presence';
import { initRidersUi } from '../../src/ridersUi';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../src/cloud/account', () => ({ account: () => ({ id: 'self' }), onAccountChange: vi.fn() }));
vi.mock('../../src/cloud/client', () => ({ neon: { rpc } }));
vi.mock('../../src/cloud/rideOns', () => ({ EMOTES: [] }));

describe('presence shared with the Riders list', () => {
  let presence: Presence | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    vi.stubGlobal('CSS', { escape: (id: string) => id });
    rpc.mockReset();
    document.body.innerHTML = `
      <button id="btn-riders" type="button"></button>
      <dialog id="riders">
        <ul id="riders-list"></ul><p id="riders-note"></p>
        <h3 id="riders-teams-head"></h3><ul id="riders-teams"></ul>
        <button id="riders-settings" type="button"></button>
        <button id="riders-share" type="button"></button>
      </dialog>`;
    const dialog = document.querySelector<HTMLDialogElement>('dialog')!;
    dialog.showModal = () => { dialog.open = true; };
    dialog.close = () => { dialog.open = false; };
  });

  afterEach(() => {
    presence?.stop();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps each rider with their own distance across list sorts, frames and reordered polls', async () => {
    const rows = [
      [
        { id: 'alice', name: 'Alice', distance: 100, speed: 2, power: 150, cadence: 80, age_ms: 0 },
        { id: 'bob', name: 'Bob', distance: 900, speed: 4, power: 250, cadence: 90, age_ms: 0 },
      ],
      [
        { id: 'bob', name: 'Bob', distance: 950, speed: 6, power: 260, cadence: 91, age_ms: 0 },
        { id: 'alice', name: 'Alice', distance: 150, speed: 3, power: 160, cadence: 81, age_ms: 0 },
      ],
    ];
    rpc.mockImplementation((name: string) => Promise.resolve({ data: name === 'ride_presence' ? rows.shift() : null, error: null }));
    presence = new Presence(() => ({ stageId: 'route66', distance: 0, speedMs: 0, power: 0, cadence: 0 }), () => true);
    const rideWith = vi.fn();
    initRidersUi({
      presence,
      me: () => ({ distance: 0, stageName: 'Route 66', imperial: false, enabled: true }),
      rideWith, openSignIn: vi.fn(), openSettings: vi.fn(), toast: vi.fn(),
      teams: () => [], riderKg: () => 75, sendRideOn: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(2000);

    // Another consumer already holds these live objects when the dialog sorts its list.
    const roadRiders = presence.riders();
    const alice = roadRiders.find((r) => r.id === 'alice')!;
    const bob = roadRiders.find((r) => r.id === 'bob')!;
    document.getElementById('btn-riders')!.click();
    expect([...document.querySelectorAll('#riders-list > li')].map((r) => (r as HTMLElement).dataset.id)).toEqual(['bob', 'alice']);

    await vi.advanceTimersByTimeAsync(250);
    presence.riders();
    expect([alice.id, alice.distance, bob.id, bob.distance]).toEqual(['alice', 100.5, 'bob', 901]);

    // The server may return a different order next time; the held objects still belong to their ids.
    await vi.advanceTimersByTimeAsync(1750);
    expect(rpc.mock.calls.filter(([name]) => name === 'ride_presence')).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(250);
    const nextFrame = presence.riders();
    expect(nextFrame.find((r) => r.id === 'alice')).toBe(alice);
    expect(nextFrame.find((r) => r.id === 'bob')).toBe(bob);
    expect([alice.distance, bob.distance]).toEqual([150.75, 951.5]);
    document.querySelector<HTMLButtonElement>('#riders-list [data-id="bob"] > button')!.click();
    expect(rideWith).toHaveBeenCalledExactlyOnceWith(951.5, 'Bob');
  });
});
