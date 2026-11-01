// Remembered Bluetooth devices: which trainer and heart-rate strap this browser
// connected to last, how to get back to them without the device chooser where the
// browser allows it, and the retry schedule for a connection that drops mid-ride.
//
// Everything here is feature-detected: on a browser without `getDevices` or
// `watchAdvertisements` it quietly does nothing and the app falls back to a
// one-tap "Reconnect" button (which uses `requestDevice` with a name filter).
//
// The remembered ids live in this browser's localStorage only (not synced to the
// account): a Bluetooth device id means nothing on another browser or computer.

export type DeviceKind = 'trainer' | 'hr';
export interface RememberedDevice { id: string; name: string }
export type RememberedDevices = Partial<Record<DeviceKind, RememberedDevice>>;

export const DEVICES_KEY = 'americanflyers.devices';

/** Wait before each automatic retry after a drop (ms); after the last one we give up and offer a Reconnect button. */
export const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];

/** How long to wait for a remembered device to advertise on page load before trying to connect anyway (ms). */
export const ADVERT_TIMEOUT_MS = 8000;

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStore(): Store | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

function cleanDevice(v: unknown): RememberedDevice | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const { id, name } = v as Record<string, unknown>;
  if (typeof id !== 'string' || !id || id.length > 200) return undefined;
  return { id, name: typeof name === 'string' && name ? name.slice(0, 80) : 'Bluetooth device' };
}

/** The devices this browser remembers. Never throws; bad or missing data reads as nothing remembered. */
export function loadRemembered(store: Store | null = defaultStore()): RememberedDevices {
  try {
    const raw = store?.getItem(DEVICES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: RememberedDevices = {};
    const trainer = cleanDevice(parsed.trainer);
    const hr = cleanDevice(parsed.hr);
    if (trainer) out.trainer = trainer;
    if (hr) out.hr = hr;
    return out;
  } catch {
    return {};
  }
}

function save(devices: RememberedDevices, store: Store | null) {
  try { store?.setItem(DEVICES_KEY, JSON.stringify(devices)); } catch { /* private mode: remembered for this visit only */ }
}

/** Remembers a device that just connected, replacing any earlier one of the same kind. */
export function rememberDevice(kind: DeviceKind, device: RememberedDevice, store: Store | null = defaultStore()): RememberedDevices {
  const all = loadRemembered(store);
  const clean = cleanDevice(device);
  if (clean) all[kind] = clean;
  save(all, store);
  return all;
}

/** Forgets one device kind (the other is kept). */
export function forgetRemembered(kind: DeviceKind, store: Store | null = defaultStore()): RememberedDevices {
  const all = loadRemembered(store);
  delete all[kind];
  save(all, store);
  return all;
}

// ------------------------------------------------------------ browser ----

/** True when this browser can hand back devices the rider already allowed (Chrome with persistent Bluetooth permissions). */
export function canReconnectSilently(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator && typeof navigator.bluetooth.getDevices === 'function';
}

/** The previously allowed device with this id, or null (no support, not allowed any more, or any error). */
export async function findPermittedDevice(id: string): Promise<BluetoothDevice | null> {
  if (!canReconnectSilently()) return null;
  try {
    const all = await navigator.bluetooth.getDevices();
    return all.find((d) => d.id === id) ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolves true on the device's first advertisement (it is awake and in range), or false after the
 * timeout / when the browser can't listen. Never rejects: the caller just tries to connect either way.
 */
export function waitForAdvertisement(device: BluetoothDevice, timeoutMs = ADVERT_TIMEOUT_MS): Promise<boolean> {
  if (typeof device.watchAdvertisements !== 'function') return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const abort = typeof AbortController === 'function' ? new AbortController() : null;
    let done = false;
    const finish = (seen: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      device.removeEventListener('advertisementreceived', onAdvert);
      try { abort?.abort(); } catch { /* already stopped */ }
      resolve(seen);
    };
    const onAdvert = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    device.addEventListener('advertisementreceived', onAdvert);
    device.watchAdvertisements(abort ? { signal: abort.signal } : undefined).catch(() => finish(false));
  });
}

/** Revokes the browser's stored permission for a device (Chrome's `forget()`), if there is one. Never throws. */
export async function forgetBrowserPermission(id: string): Promise<void> {
  try {
    const device = await findPermittedDevice(id);
    await device?.forget?.();
  } catch { /* nothing to revoke */ }
}

// A device object can be connected again and again, but each connection must not stack another
// "disconnected" listener on it, or one drop would be reported once per earlier connection.
const dropListeners = new WeakMap<object, EventListener>();

/**
 * Calls `handler` when the device's GATT connection drops. Replaces any listener from an earlier connection.
 * The returned `arm()` is called once setup has worked: drops while still setting up are not reported
 * (the setup itself fails and its caller deals with that).
 */
export function onGattDrop(device: BluetoothDevice, handler: () => void): { arm(): void } {
  const previous = dropListeners.get(device);
  if (previous) device.removeEventListener('gattserverdisconnected', previous);
  let armed = false;
  const listener: EventListener = () => { if (armed) handler(); };
  dropListeners.set(device, listener);
  device.addEventListener('gattserverdisconnected', listener);
  return { arm: () => { armed = true; } };
}

// ------------------------------------------------------------- retries ----

export interface ReconnectOptions {
  /** One attempt: resolve true when connected. Rejections count as a failed attempt. */
  attempt: () => Promise<boolean>;
  /** Called before each wait with the 1-based attempt number about to be made. */
  onAttempt?: (n: number, total: number) => void;
  onSuccess: () => void;
  onGiveUp: () => void;
  delays?: number[];
}

/** Retries a connection with a growing wait between attempts (1, 2, 4, 8, 15 s), then gives up. */
export class Reconnector {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private run = 0; // bumped on stop so a late attempt result is ignored

  constructor(private readonly o: ReconnectOptions) {}

  get active() { return this.running; }

  start() {
    if (this.running) return;
    this.running = true;
    this.step(0, ++this.run);
  }

  stop() {
    this.running = false;
    this.run++;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private step(i: number, run: number) {
    const delays = this.o.delays ?? RECONNECT_DELAYS_MS;
    if (i >= delays.length) {
      this.running = false;
      this.o.onGiveUp();
      return;
    }
    this.o.onAttempt?.(i + 1, delays.length);
    this.timer = setTimeout(async () => {
      this.timer = null;
      let ok = false;
      try { ok = await this.o.attempt(); } catch { ok = false; }
      if (run !== this.run) return; // stopped while the attempt was running
      if (ok) {
        this.running = false;
        this.o.onSuccess();
      } else {
        this.step(i + 1, run);
      }
    }, delays[i]);
  }
}

// -------------------------------------------------------------- labels ----

export type LinkState = 'idle' | 'connecting' | 'connected' | 'reconnecting';

export interface MenuLabelInput {
  kind: DeviceKind;
  state: LinkState;
  /** Name of the connected device (when connected). */
  connectedName?: string;
  /** The remembered device, if any. */
  remembered?: RememberedDevice;
}

/** The ☰ Menu item for a device: its label and a smaller line under it. */
export function menuLabel(i: MenuLabelInput): { label: string; sub: string } {
  const icon = i.kind === 'trainer' ? '🔌' : '❤️';
  const thing = i.kind === 'trainer' ? 'trainer' : 'heart rate';
  const name = i.remembered?.name;
  switch (i.state) {
    case 'connected':
      return { label: `${icon} Disconnect ${i.connectedName ?? name ?? thing}`, sub: 'Connected. Remembered on this browser.' };
    case 'connecting':
      return { label: `${icon} Connecting…`, sub: name ? `Looking for ${name}` : 'Choose your device in the browser’s list' };
    case 'reconnecting':
      return { label: `${icon} Reconnect ${name ?? thing} now`, sub: 'Lost the connection. Trying again by itself.' };
    default:
      return name
        ? { label: `${icon} Reconnect ${name}`, sub: 'One tap. Remembered on this browser.' }
        : { label: i.kind === 'trainer' ? `${icon} Connect trainer` : `${icon} Heart rate`, sub: i.kind === 'trainer' ? 'Wahoo, Tacx, Elite, Saris and other FTMS trainers' : 'A Bluetooth heart rate strap' };
  }
}
