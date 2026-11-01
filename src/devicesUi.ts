// Trainer and heart-rate connections in the ☰ Menu, and the remembered devices.
//
// One `Link` per device kind owns its connection life cycle:
//   - connect from the chooser (top bar, menu) or from a remembered name (one tap);
//   - remember the device in localStorage on every successful connect (ble/remembered.ts);
//   - on page load, reconnect without the chooser where the browser allows it
//     (`getDevices` + `watchAdvertisements`); otherwise show a "Reconnect" banner;
//   - if a remembered device drops mid-ride, retry with a growing wait (1, 2, 4, 8, 15 s),
//     re-subscribe, and tell main.ts so it resends the resistance; then give up politely.
// main.ts keeps the ride state; it hears about changes through the callbacks below.

import { openHeartRate, requestHeartRateDevice, type HeartRateMonitor } from './ble/heartRate';
import {
  Reconnector, canReconnectSilently, findPermittedDevice, forgetBrowserPermission, forgetRemembered,
  loadRemembered, menuLabel, rememberDevice, waitForAdvertisement,
  type DeviceKind, type LinkState, type RememberedDevices,
} from './ble/remembered';
import { bluetoothAvailable, openTrainer, requestTrainerDevice, type Trainer, type TrainerReading } from './ble/trainer';

export interface DevicesDeps {
  toast(msg: string, ms?: number): void;
  /** The line under the data blocks: what the trainer is doing. */
  setStatus(text: string, state: 'on' | 'off' | 'pending'): void;
  onReading(r: TrainerReading): void;
  onHeartRate(bpm: number): void;
  /** The connected trainer changed: a new one, or null when it is gone. (main resends the grade after a new one.) */
  trainerChanged(t: Trainer | null): void;
  hrChanged(h: HeartRateMonitor | null): void;
}

interface Connectable { readonly name: string; disconnect(): void }

interface LinkSpec<T extends Connectable> {
  kind: DeviceKind;
  /** "trainer" / "heart rate strap", for messages. */
  noun: string;
  request(name?: string): Promise<BluetoothDevice>;
  open(device: BluetoothDevice, onDrop: () => void): Promise<T>;
  changed(t: T | null): void;
  /** Called when the state or the connected device changes (status line etc.). */
  describe(state: LinkState, t: T | null, remembered: string | undefined): void;
}

class Link<T extends Connectable> {
  state: LinkState = 'idle';
  current: T | null = null;
  private device: BluetoothDevice | null = null; // the handle kept for in-session retries
  private manualStop = false;
  private picking = false; // the browser's chooser is open
  private seq = 0; // bumped by every rider-started connect, so a slower automatic one backs off
  private readonly reconnector: Reconnector;

  constructor(
    private readonly spec: LinkSpec<T>,
    private readonly ui: { toast: DevicesDeps['toast']; remembered(): RememberedDevices; remember(name: string, id: string): void; changed(): void },
  ) {
    this.reconnector = new Reconnector({
      attempt: () => this.retry(),
      onAttempt: () => this.ui.changed(),
      onSuccess: () => this.ui.toast(`Reconnected to ${this.current?.name ?? this.spec.noun}`),
      onGiveUp: () => {
        this.setState('idle');
        const name = this.remembered()?.name ?? this.spec.noun;
        this.ui.toast(`Couldn’t reach ${name}. Wake it by pedalling, then tap Reconnect in the ☰ Menu.`, 7000);
      },
    });
  }

  private remembered() { return this.ui.remembered()[this.spec.kind]; }

  private setState(state: LinkState) {
    this.state = state;
    this.spec.describe(state, this.current, this.remembered()?.name);
    this.ui.changed();
  }

  /** A device is in hand: connect to it and set it up. Throws if that fails. */
  private async open(device: BluetoothDevice): Promise<T> {
    const t = await this.spec.open(device, () => this.dropped());
    return t;
  }

  private install(device: BluetoothDevice, t: T) {
    this.current = t;
    this.device = device;
    this.ui.remember(device.name || t.name, device.id);
    this.spec.changed(t);
    this.setState('connected');
  }

  /** From a button tap (a user gesture): the chooser, or with `name` a chooser that lists just that device. */
  async connect(name?: string): Promise<boolean> {
    if (this.picking) return false;
    this.picking = true;
    this.seq++;
    this.reconnector.stop();
    const before = this.state;
    this.setState('connecting');
    let device: BluetoothDevice;
    try {
      device = await this.spec.request(name);
    } catch (err) {
      this.picking = false;
      this.setState(before === 'connected' ? 'connected' : 'idle');
      const cancelled = (err as DOMException)?.name === 'NotFoundError';
      if (cancelled && name) this.ui.toast(`Didn’t find ${name}. Wake it by pedalling, or use the connect button to pick another.`, 6000);
      else if (!cancelled) this.ui.toast(`Couldn’t connect: ${(err as Error).message}`);
      return false;
    }
    this.picking = false;
    try {
      const t = await this.open(device);
      this.install(device, t);
      this.ui.toast(`Connected to ${t.name}`);
      return true;
    } catch (err) {
      this.setState('idle');
      this.ui.toast(`Couldn’t connect: ${(err as Error).message}`);
      return false;
    }
  }

  /** The connection dropped (or the rider disconnected). */
  private dropped() {
    const t = this.current;
    if (!t) return;
    this.current = null;
    this.spec.changed(null);
    const remembered = this.remembered();
    if (this.manualStop || !remembered) {
      this.manualStop = false;
      this.setState('idle');
      this.ui.toast(`${cap(this.spec.noun)} disconnected`);
      return;
    }
    this.ui.toast(`Lost ${t.name}. Trying to reconnect…`);
    this.setState('reconnecting');
    this.reconnector.start();
  }

  /** One automatic retry on the same device handle. */
  private async retry(): Promise<boolean> {
    const device = this.device;
    if (!device) return false;
    try {
      const t = await this.open(device);
      if (!this.reconnector.active) { // the rider took over (or disconnected) while this was connecting
        t.disconnect();
        return false;
      }
      this.install(device, t);
      return true;
    } catch {
      return false;
    }
  }

  disconnect() {
    if (!this.current) return;
    this.manualStop = true;
    this.reconnector.stop();
    this.current.disconnect();
    // Browsers report the drop as an event; make sure the UI moves on even if one never comes.
    window.setTimeout(() => { if (this.manualStop && this.current === null) this.manualStop = false; }, 2000);
  }

  /** On page load: reconnect to the remembered device without the chooser, if the browser lets us. */
  async autoConnect(): Promise<void> {
    const r = this.remembered();
    if (!r || this.state !== 'idle' || !canReconnectSilently()) return;
    const mine = this.seq;
    this.setState('connecting'); // set at once so the banner doesn't flash up
    const device = await findPermittedDevice(r.id);
    if (!device) { if (this.seq === mine) this.setState('idle'); return; }
    await waitForAdvertisement(device); // wake and in range, or time out and try anyway
    if (this.seq !== mine) return; // the rider chose a device themselves meanwhile
    try {
      const t = await this.open(device);
      if (this.seq !== mine || this.current) return;
      this.install(device, t);
      this.ui.toast(`Connected to ${t.name}`);
    } catch {
      if (this.seq === mine) this.setState('idle'); // the banner offers a one-tap Reconnect
    }
  }

  /** Stops retrying and forgets the connection handle (used when the device is forgotten). */
  forgetHandle() {
    this.reconnector.stop();
    this.device = null;
    if (this.state === 'reconnecting') this.setState('idle');
  }

  get reconnecting() { return this.reconnector.active; }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function initDevices(deps: DevicesDeps) {
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;
  const supported = bluetoothAvailable();
  let remembered: RememberedDevices = loadRemembered();
  let bannerDismissed = false;

  const shared = {
    toast: deps.toast,
    remembered: () => remembered,
    changed: () => refresh(),
  };

  const trainer = new Link<Trainer>(
    {
      kind: 'trainer',
      noun: 'trainer',
      request: requestTrainerDevice,
      open: (device, onDrop) => openTrainer(device, { onReading: deps.onReading, onDisconnect: onDrop }),
      changed: (t) => deps.trainerChanged(t),
      describe: (state, t, name) => {
        if (state === 'connected' && t) deps.setStatus(`${t.name} · ${t.canControl ? 'resistance follows the road' : 'power only (no resistance control)'}`, 'on');
        else if (state === 'connecting') deps.setStatus(name ? `Looking for ${name}…` : 'Searching…', 'pending');
        else if (state === 'reconnecting') deps.setStatus(`Lost ${name ?? 'the trainer'}. Reconnecting…`, 'pending');
        else deps.setStatus('No trainer connected', 'off');
      },
    },
    { ...shared, remember: (name, id) => remember('trainer', name, id) },
  );

  const hr = new Link<HeartRateMonitor>(
    {
      kind: 'hr',
      noun: 'heart rate strap',
      request: requestHeartRateDevice,
      open: (device, onDrop) => openHeartRate(device, deps.onHeartRate, onDrop),
      changed: (h) => deps.hrChanged(h),
      describe: () => {},
    },
    { ...shared, remember: (name, id) => remember('hr', name, id) },
  );

  const links: Record<DeviceKind, Link<Trainer> | Link<HeartRateMonitor>> = { trainer, hr };

  function remember(kind: DeviceKind, name: string, id: string) {
    remembered = rememberDevice(kind, { id, name });
  }

  function forget(kind: DeviceKind) {
    const r = remembered[kind];
    if (!r) return;
    remembered = forgetRemembered(kind);
    void forgetBrowserPermission(r.id);
    links[kind].forgetHandle();
    deps.toast(`Forgot ${r.name}. You’ll pick it from the list next time.`);
    refresh();
  }

  // ---------------------------------------------------------------- DOM ----

  const menuButtons: Record<DeviceKind, HTMLElement | null> = { trainer: $('btn-menu-trainer'), hr: $('btn-hr') };

  function setMenuItem(kind: DeviceKind) {
    const el = menuButtons[kind];
    if (!el) return;
    const link = links[kind];
    const { label, sub } = menuLabel({ kind, state: link.state, connectedName: link.current?.name, remembered: remembered[kind] });
    el.querySelector('.mi-label')!.textContent = label;
    el.querySelector('.mi-sub')!.textContent = sub;
    el.title = sub;
    const forgetBtn = $(`btn-forget-${kind}`);
    if (forgetBtn) {
      forgetBtn.hidden = !remembered[kind];
      if (remembered[kind]) forgetBtn.textContent = `✕ Forget ${remembered[kind]!.name}`;
    }
  }

  function renderSettings() {
    const box = $('settings-devices');
    if (!box) return;
    box.replaceChildren();
    const rows: [DeviceKind, string][] = [['trainer', '🔌 Trainer'], ['hr', '❤️ Heart rate']];
    for (const [kind, label] of rows) {
      const row = document.createElement('div');
      row.className = 'dev-row';
      const text = document.createElement('span');
      const r = remembered[kind];
      text.textContent = r ? `${label}: ${r.name}` : `${label}: none remembered`;
      if (!r) text.className = 'muted';
      row.append(text);
      if (r) {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.forget = kind;
        b.textContent = 'Forget';
        row.append(b);
      }
      box.append(row);
    }
  }

  const banner = document.createElement('div');
  banner.id = 'device-banner';
  banner.className = 'device-banner';
  banner.setAttribute('role', 'status');
  banner.hidden = true;
  document.body.append(banner);

  function renderBanner() {
    const pending = (['trainer', 'hr'] as DeviceKind[]).filter((k) => remembered[k] && links[k].state === 'idle');
    const show = supported && !bannerDismissed && pending.length > 0;
    banner.hidden = !show;
    if (!show) { banner.replaceChildren(); return; }
    // Rebuild only when the set of buttons changes, so a focused button isn't replaced under the rider.
    const key = pending.map((k) => `${k}:${remembered[k]!.name}`).join('|');
    if (banner.dataset.key === key) return;
    banner.dataset.key = key;
    const text = document.createElement('span');
    text.className = 'db-text';
    text.textContent = 'Welcome back!';
    const actions = document.createElement('span');
    actions.className = 'db-actions';
    for (const k of pending) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'primary';
      b.dataset.reconnect = k;
      b.textContent = `${k === 'trainer' ? '🔌' : '❤️'} Reconnect ${remembered[k]!.name}`;
      actions.append(b);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'db-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '✕';
    close.dataset.dismiss = '1';
    actions.append(close);
    banner.replaceChildren(text, actions);
  }

  function refresh() {
    setMenuItem('trainer');
    setMenuItem('hr');
    const tb = $('btn-trainer');
    if (tb) tb.textContent = trainer.current ? 'Disconnect' : 'Connect trainer';
    renderSettings();
    renderBanner();
  }

  /** The tap on a device's menu item: disconnect if connected, otherwise reconnect (by name) or connect. */
  function menuAction(kind: DeviceKind) {
    const link = links[kind];
    if (link.current) link.disconnect();
    else void link.connect(remembered[kind]?.name);
  }

  // Wiring. Every handler is a direct click handler, so the browser sees a user gesture for requestDevice.
  $('btn-trainer')?.addEventListener('click', () => { if (trainer.current) trainer.disconnect(); else void trainer.connect(); });
  menuButtons.trainer?.addEventListener('click', () => menuAction('trainer'));
  menuButtons.hr?.addEventListener('click', () => menuAction('hr'));
  $('btn-forget-trainer')?.addEventListener('click', () => forget('trainer'));
  $('btn-forget-hr')?.addEventListener('click', () => forget('hr'));
  $('settings-devices')?.addEventListener('click', (e) => {
    const kind = (e.target as HTMLElement).closest<HTMLElement>('[data-forget]')?.dataset.forget as DeviceKind | undefined;
    if (kind) forget(kind);
  });
  banner.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const kind = t.closest<HTMLElement>('[data-reconnect]')?.dataset.reconnect as DeviceKind | undefined;
    if (kind) void links[kind].connect(remembered[kind]?.name);
    else if (t.closest('[data-dismiss]')) { bannerDismissed = true; renderBanner(); }
  });

  refresh();

  return {
    /** Reconnect remembered devices without the chooser, where the browser allows it. Call once the app is up. */
    start() {
      if (!supported) return;
      void trainer.autoConnect();
      void hr.autoConnect();
    },
    /** The first-ride guide's buttons: connect (or reconnect) and say whether it worked. */
    async connectTrainer() { return trainer.current ? true : trainer.connect(); },
    async connectHeartRate() { return hr.current ? true : hr.connect(); },
    refresh,
  };
}
