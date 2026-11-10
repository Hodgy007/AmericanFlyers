import { expect, test, type Page } from '@playwright/test';
import { mockNeon } from './mockNeon';

// Trainer, heart rate and power meter in the ☰ Menu, remembered devices, one-tap reconnect, the
// no-chooser reconnect on load (getDevices), and automatic reconnection after a drop.
// navigator.bluetooth is replaced by a small mock, so no hardware is needed.

test.use({ viewport: { width: 960, height: 600 } });

const SHOTS = process.env.E2E_SHOTS; // set to a folder to save screenshots

const press = (page: Page, selector: string) => page.locator(selector).evaluate((el) => (el as HTMLElement).click());

interface MockOptions {
  /** Offer navigator.bluetooth.getDevices (Chrome with persistent permissions). */
  getDevices: boolean;
  /** localStorage 'americanflyers.devices' to start with. */
  remembered?: unknown;
  /** Only the older writeValue() (no writeValueWithResponse), as in Bluefy on iPhone. */
  legacyWrite?: boolean;
  /** Writes to the FTMS control point fail (e.g. another app holds control). */
  controlFails?: boolean;
  /** requestDevice refuses more than one filter at once, without showing a chooser (suspected Bluefy behaviour). */
  rejectMultiFilter?: boolean;
}

async function setup(page: Page, o: MockOptions) {
  await mockNeon(page, { signedIn: true }); // an account is required to ride
  await page.addInitScript((opts: MockOptions) => {
    localStorage.setItem('americanflyers.signedIn', '1');
    localStorage.setItem('americanflyers.onboarded', '1');
    if (opts.remembered && !localStorage.getItem('americanflyers.devices')) localStorage.setItem('americanflyers.devices', JSON.stringify(opts.remembered));
    // Software WebGL: run the render loop at ~1 fps so the test's own work isn't starved.
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => window.setTimeout(() => raf(cb), 1000) as unknown as number;

    const log = {
      requests: [] as unknown[],
      getDevicesCalls: 0,
      connects: { 'trainer-1': 0, 'hr-1': 0, 'meter-1': 0 } as Record<string, number>,
      writes: [] as number[][],
      forgets: [] as string[],
      failNext: 0, // make the next N gatt.connect() calls fail
      denyCommands: false, // the control point answers 'control not permitted' to power and grade commands (another app has control)
    };
    const devices: Record<string, any> = {};

    function char(onWrite?: (data: number[]) => void) {
      const c: any = new EventTarget();
      c.value = null;
      c.startNotifications = async () => c;
      const write = async (buf: ArrayBuffer) => {
        if (opts.controlFails && onWrite) throw new DOMException('GATT operation failed for unknown reason.', 'NotSupportedError');
        onWrite?.([...new Uint8Array(buf)]);
      };
      if (opts.legacyWrite) c.writeValue = write;
      else { c.writeValueWithResponse = write; c.writeValue = write; }
      c.emit = (bytes: number[]) => { c.value = new DataView(new Uint8Array(bytes).buffer); c.dispatchEvent(new Event('characteristicvaluechanged')); };
      return c;
    }

    function makeDevice(id: string, name: string) {
      const d: any = new EventTarget();
      d.id = id; d.name = name;
      d.bikeData = null;
      d.hrData = null;
      const server: any = {
        connected: false,
        async connect() {
          log.connects[id]++;
          if (log.failNext > 0) { log.failNext--; throw new DOMException('GATT Server is disconnected.', 'NetworkError'); }
          server.connected = true;
          return server;
        },
        disconnect() {
          if (!server.connected) return;
          server.connected = false;
          d.dispatchEvent(new Event('gattserverdisconnected'));
        },
        async getPrimaryService(uuid: number) {
          if (!server.connected) throw new DOMException('GATT Server is disconnected.', 'NetworkError');
          if (id === 'trainer-1' && uuid === 0x1826) {
            const bike = char();
            const control = char((data) => {
              log.writes.push(data);
              const denied = log.denyCommands && (data[0] === 0x05 || data[0] === 0x11);
              setTimeout(() => control.emit([0x80, data[0], denied ? 0x05 : 0x01]), 0); // success (or not permitted) response
            });
            const status = char(); // Fitness Machine Status
            d.bikeData = bike;
            d.statusData = status;
            return { getCharacteristic: async (u: number) => (u === 0x2ad2 ? bike : u === 0x2ada ? status : control) };
          }
          if (id === 'hr-1' && uuid === 0x180d) {
            const hr = char();
            d.hrData = hr;
            return { getCharacteristic: async () => hr };
          }
          if (id === 'meter-1' && uuid === 0x1818) {
            const cps = char();
            d.meterData = cps;
            return { getCharacteristic: async () => cps };
          }
          throw new DOMException('Service not found', 'NotFoundError');
        },
      };
      d.gatt = server;
      d.watchAdvertisements = async () => { setTimeout(() => d.dispatchEvent(new Event('advertisementreceived')), 100); };
      d.forget = async () => { log.forgets.push(id); };
      devices[id] = d;
      return d;
    }
    makeDevice('trainer-1', 'KICKR Test');
    makeDevice('hr-1', 'Strap Test');
    makeDevice('meter-1', 'Assioma Test');

    const bluetooth: any = {
      async requestDevice(options: any) {
        log.requests.push(JSON.parse(JSON.stringify(options)));
        if (opts.rejectMultiFilter && (options.filters?.length ?? 0) > 1) throw new DOMException('No Services found in device.', 'NotFoundError');
        if (options.acceptAllDevices) return devices['trainer-1']; // the rider picks the trainer from the full list
        const f = options.filters?.[0] ?? {};
        const byName = Object.values(devices).find((d: any) => d.name === f.name);
        if (byName) return byName;
        if (options.filters?.length === 1 && f.services?.includes(0x1818)) return devices['meter-1']; // the power-meter chooser (the trainer's lists FTMS too)
        if (f.services?.includes(0x1826)) return devices['trainer-1'];
        if (f.services?.includes(0x180d)) return devices['hr-1'];
        throw new DOMException('User cancelled the requestDevice() chooser.', 'NotFoundError');
      },
    };
    if (opts.getDevices) bluetooth.getDevices = async () => { log.getDevicesCalls++; return Object.values(devices); };
    Object.defineProperty(navigator, 'bluetooth', { value: bluetooth, configurable: true });

    (window as any).__bt = {
      log,
      devices,
      /** Sends an Indoor Bike Data notification: power and cadence (flags: speed present, cadence, power). */
      pedal(power: number, cadence: number) {
        const b = new DataView(new ArrayBuffer(8));
        b.setUint16(0, 0x0044, true); b.setUint16(2, 0, true); b.setUint16(4, cadence * 2, true); b.setInt16(6, power, true);
        devices['trainer-1'].bikeData.emit([...new Uint8Array(b.buffer)]);
      },
      /** Keeps sending data while the trainer is connected (a reading goes stale after 3 s, and the HUD eases towards it). */
      pedalWhileConnected(power: number, cadence: number) {
        const send = () => { if (devices['trainer-1'].gatt.connected && devices['trainer-1'].bikeData) (window as any).__bt.pedal(power, cadence); };
        send();
        window.setInterval(send, 400);
      },
      /** A Cycling Power Measurement notification from the separate meter: power only (flags 0). */
      meterPedal(power: number) {
        const b = new DataView(new ArrayBuffer(4));
        b.setUint16(0, 0, true); b.setInt16(2, power, true);
        devices['meter-1'].meterData.emit([...new Uint8Array(b.buffer)]);
      },
      /** Returns a function that stops the meter's readings. */
      meterWhileConnected(power: number) {
        const send = () => { if (devices['meter-1'].gatt.connected && devices['meter-1'].meterData) (window as any).__bt.meterPedal(power); };
        send();
        const id = window.setInterval(send, 400);
        (window as any).__stopMeter = () => window.clearInterval(id);
      },
      drop(id: string) { devices[id].gatt.disconnect(); },
    };
  }, o);
}

const bt = (page: Page) => page.evaluate(() => (window as any).__bt.log);
const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('americanflyers.devices') ?? 'null'));
const snap = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

/** The app opens on the hub; these tests are about riding, so press Ride first (the hub's own device banner is checked in the first test). */
async function ride(page: Page) {
  await expect(page.locator('#hub')).toBeVisible();
  await press(page, '#hub-go');
  await expect(page.locator('#hub')).toBeHidden();
}

const REMEMBERED = { trainer: { id: 'trainer-1', name: 'KICKR Test' }, hr: { id: 'hr-1', name: 'Strap Test' } };

test('without getDevices: a banner offers one-tap reconnect through a name-filtered chooser', async ({ page }) => {
  await setup(page, { getDevices: false, remembered: REMEMBERED });
  await page.goto('/');
  // The banner is offered on the hub already, where you'd connect before riding.
  await expect(page.locator('#hub')).toBeVisible();
  await expect(page.locator('#device-banner')).toBeVisible();
  await ride(page);
  await expect(page.locator('.topbar')).toBeVisible();

  // Nothing connects by itself (no way to without the chooser); the banner offers both devices.
  const banner = page.locator('#device-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Reconnect KICKR Test');
  await expect(banner).toContainText('Reconnect Strap Test');
  expect((await bt(page)).requests).toEqual([]);
  await press(page, '#btn-menu');
  await expect(page.locator('#btn-menu-trainer')).toContainText('Reconnect KICKR Test');
  await expect(page.locator('#btn-hr')).toContainText('Reconnect Strap Test');
  await snap(page, 'devices-1-banner-and-menu');
  await press(page, '#btn-menu');

  // One tap on the trainer: requestDevice is asked for just that name, plus the same optional services.
  await press(page, '[data-reconnect="trainer"]');
  await expect(page.locator('#trainer-status')).toContainText('KICKR Test');
  const log = await bt(page);
  expect(log.requests).toEqual([{ filters: [{ name: 'KICKR Test' }], optionalServices: [0x1826, 0x1818] }]);
  await expect(banner).not.toContainText('KICKR Test');
  await expect(banner).toContainText('Reconnect Strap Test');

  await press(page, '[data-reconnect="hr"]');
  await expect(banner).toBeHidden();
  expect((await bt(page)).requests[1]).toEqual({ filters: [{ name: 'Strap Test' }], optionalServices: [0x180d] });

  // The menu and the top bar now show what is connected.
  await press(page, '#btn-menu');
  await expect(page.locator('#btn-menu-trainer')).toContainText('Disconnect KICKR Test');
  await expect(page.locator('#btn-hr')).toContainText('Disconnect Strap Test');
  await expect(page.locator('#btn-trainer')).toHaveText('Disconnect');
  await snap(page, 'devices-2-connected-menu');
  expect(await stored(page)).toEqual(REMEMBERED);
});

test('with getDevices: remembered devices reconnect on load without the chooser', async ({ page }) => {
  await setup(page, { getDevices: true, remembered: REMEMBERED });
  await page.goto('/');
  await ride(page);
  await expect(page.locator('#trainer-status')).toContainText('KICKR Test', { timeout: 20_000 });
  await press(page, '#btn-menu');
  await expect(page.locator('#btn-hr')).toContainText('Disconnect Strap Test', { timeout: 20_000 });
  const log = await bt(page);
  expect(log.requests).toEqual([]); // the chooser was never opened
  expect(log.getDevicesCalls).toBeGreaterThan(0);
  expect(log.connects).toEqual({ 'trainer-1': 1, 'hr-1': 1, 'meter-1': 0 });
  await expect(page.locator('#device-banner')).toBeHidden();
  await snap(page, 'devices-3-auto-connected');

  // Trainer data flows (power shows up in the HUD) and the trainer was sent control commands.
  await page.evaluate(() => (window as any).__bt.pedalWhileConnected(210, 90));
  await expect(page.locator('#hud')).toContainText(/Power[1-9]\d*W/);
});

test('connect from the menu remembers the device; disconnect keeps it; no automatic reconnect after a manual disconnect', async ({ page }) => {
  await setup(page, { getDevices: false });
  await page.goto('/');
  await ride(page);
  await expect(page.locator('#device-banner')).toBeHidden();
  await press(page, '#btn-menu');
  await expect(page.locator('#btn-menu-trainer')).toContainText('Connect trainer');

  await press(page, '#btn-menu-trainer');
  await expect(page.locator('#trainer-status')).toContainText('KICKR Test');
  expect((await bt(page)).requests[0].filters).toEqual([{ services: [0x1826] }, { services: [0x1818] }]);
  expect(await stored(page)).toEqual({ trainer: { id: 'trainer-1', name: 'KICKR Test' } });

  await press(page, '#btn-menu-trainer'); // now "Disconnect"
  await expect(page.locator('#trainer-status')).toContainText('No trainer connected');
  await expect(page.locator('#btn-menu-trainer')).toContainText('Reconnect KICKR Test');
  expect(await stored(page)).toEqual({ trainer: { id: 'trainer-1', name: 'KICKR Test' } });
  await page.waitForTimeout(3500); // longer than the first two retry waits
  expect((await bt(page)).connects['trainer-1']).toBe(1);
});

test('a dropped trainer reconnects by itself, with a backoff, and gets the resistance again', async ({ page }) => {
  await setup(page, { getDevices: false });
  await page.goto('/');
  await ride(page);
  await press(page, '#btn-menu-trainer');
  await expect(page.locator('#trainer-status')).toContainText('KICKR Test');
  await page.evaluate(() => (window as any).__bt.pedalWhileConnected(180, 85));
  await expect(page.locator('#hud')).toContainText(/Power[1-9]\d*W/);

  // The road grade is sent to the trainer once connected (opcode 0x11).
  await expect.poll(async () => (await bt(page)).writes.filter((w: number[]) => w[0] === 0x11).length, { timeout: 10_000 }).toBeGreaterThan(0);
  const before = (await bt(page)).writes.length;

  // Drop it; the first retry (after 1 s) fails, the second (after 2 more) works.
  // (A slow machine can poll too rarely to catch the short "Reconnecting" status, so record every change.)
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as any).__statusSeen = seen;
    new MutationObserver(() => seen.push(document.getElementById('trainer-status')!.textContent ?? '')).observe(document.getElementById('trainer-status')!, { childList: true, characterData: true, subtree: true });
    // Record the toasts too: the account's "Signed in as …" toast can arrive on a slow machine and replace "Reconnected" before it is checked.
    const toasts: string[] = [];
    (window as any).__toastsSeen = toasts;
    new MutationObserver(() => toasts.push(document.getElementById('toast')!.textContent ?? '')).observe(document.getElementById('toast')!, { childList: true, characterData: true, subtree: true });
    (window as any).__bt.log.failNext = 1;
    (window as any).__bt.drop('trainer-1');
  });
  await expect.poll(() => page.evaluate(() => (window as any).__statusSeen.some((t: string) => t.includes('Reconnecting')))).toBe(true);
  await expect(page.locator('#trainer-status')).toContainText('resistance follows the road', { timeout: 15_000 });
  const log = await bt(page);
  expect(log.requests.length).toBe(1); // never went back to the chooser
  expect(log.connects['trainer-1']).toBe(3); // first connect, a failed retry, a good retry
  await expect.poll(async () => (await bt(page)).writes.slice(before).filter((w: number[]) => w[0] === 0x11).length, { timeout: 10_000 }).toBeGreaterThan(0);
  // Notifications were re-subscribed: new data reaches the HUD.
  await expect(page.locator('#hud')).toContainText(/Power[1-9]\d*W/, { timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => (window as any).__toastsSeen.some((t: string) => /Reconnected/.test(t)))).toBe(true);
});

test('forget removes a device from the menu and from Settings', async ({ page }) => {
  await setup(page, { getDevices: true, remembered: REMEMBERED });
  await page.goto('/');
  await ride(page);
  await expect(page.locator('#trainer-status')).toContainText('KICKR Test', { timeout: 20_000 });

  await press(page, '#btn-menu');
  await expect(page.locator('#btn-forget-trainer')).toBeVisible();
  await press(page, '#btn-forget-trainer');
  expect(await stored(page)).toEqual({ hr: REMEMBERED.hr });
  await expect.poll(async () => (await bt(page)).forgets).toEqual(['trainer-1']);
  await expect(page.locator('#btn-forget-trainer')).toBeHidden();

  // Settings lists what is remembered, with a Forget button each.
  await press(page, '#btn-menu');
  await press(page, '#btn-settings');
  const box = page.locator('#settings-devices');
  await expect(box).toContainText('Trainer: none remembered');
  await expect(box).toContainText('Heart rate: Strap Test');
  await snap(page, 'devices-5-settings');
  await press(page, '[data-forget="hr"]');
  expect(await stored(page)).toEqual({});
  await expect(box).toContainText('Heart rate: none remembered');
});

test('Bluefy-style browser without writeValueWithResponse: the trainer connects and takes resistance control', async ({ page }) => {
  await setup(page, { getDevices: false, legacyWrite: true });
  await page.goto('/');
  await ride(page);
  await press(page, '#btn-menu-trainer');
  await expect(page.locator('#trainer-status')).toContainText('KICKR Test · resistance follows the road');
  expect((await bt(page)).writes[0]).toEqual([0x00]); // request control went out through writeValue()
});

test('a control point that refuses writes still leaves the trainer connected for power', async ({ page }) => {
  await setup(page, { getDevices: false, controlFails: true });
  await page.goto('/');
  await ride(page);
  await press(page, '#btn-menu-trainer');
  await expect(page.locator('#trainer-status')).toContainText('KICKR Test · power only');
  await page.evaluate(() => (window as any).__bt.pedalWhileConnected(210, 90));
  await expect(page.locator('#hud')).toContainText(/Power[1-9]\d*W/);
});

test('a browser that refuses the two-filter trainer request falls back to listing every device', async ({ page }) => {
  await setup(page, { getDevices: false, rejectMultiFilter: true });
  await page.goto('/');
  await ride(page);
  await press(page, '#btn-menu-trainer');
  await expect(page.locator('#trainer-status')).toContainText('KICKR Test');
  const requests = (await bt(page)).requests;
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual({ acceptAllDevices: true, optionalServices: [0x1826, 0x1818] });
});

test('a power meter beside the trainer: its watts win, the status names it, and the trainer takes over when it goes quiet', async ({ page }) => {
  await setup(page, { getDevices: false });
  await page.goto('/');
  await ride(page);
  await press(page, '#btn-menu-trainer');
  await expect(page.locator('#trainer-status')).toContainText('KICKR Test · resistance follows the road');
  await page.evaluate(() => (window as any).__bt.pedalWhileConnected(150, 85));
  await expect(page.locator('#hud')).toContainText(/Power1[0-9]{2}W/);

  await press(page, '#btn-meter');
  await expect(page.locator('#btn-meter')).toContainText('Disconnect Assioma Test');
  expect((await bt(page)).requests.at(-1)).toEqual({ filters: [{ services: [0x1818] }] });
  await page.evaluate(() => (window as any).__bt.meterWhileConnected(260));
  await expect(page.locator('#trainer-status')).toContainText('KICKR Test · resistance follows the road · power from Assioma Test');
  // The meter's 260 W drives the HUD, not the trainer's 150 W.
  await expect(page.locator('#hud')).toContainText(/Power2[0-9]{2}W/, { timeout: 15_000 });
  expect(await stored(page)).toEqual({ trainer: { id: 'trainer-1', name: 'KICKR Test' }, meter: { id: 'meter-1', name: 'Assioma Test' } });
  await snap(page, 'devices-meter-status');

  // The meter stops sending (still connected): after 3 s the trainer's own power is used, and the rider is told once.
  await page.evaluate(() => {
    (window as any).__toastsSeen = [];
    new MutationObserver(() => (window as any).__toastsSeen.push(document.getElementById('toast')!.textContent ?? '')).observe(document.getElementById('toast')!, { childList: true, characterData: true, subtree: true });
    (window as any).__stopMeter();
  });
  await expect(page.locator('#trainer-status')).not.toContainText('power from', { timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => (window as any).__toastsSeen.some((t: string) => /Assioma Test stopped sending power/.test(t)))).toBe(true);
  await expect(page.locator('#hud')).toContainText(/Power1[0-9]{2}W/, { timeout: 15_000 });
  // ...and the meter is used again when it returns.
  await page.evaluate(() => (window as any).__bt.meterWhileConnected(260));
  await expect(page.locator('#trainer-status')).toContainText('power from Assioma Test');
});

test('the same device cannot be both the trainer and the power meter', async ({ page }) => {
  await setup(page, { getDevices: false });
  await page.goto('/');
  await ride(page);
  await press(page, '#btn-menu-trainer');
  await expect(page.locator('#trainer-status')).toContainText('KICKR Test');
  // Make the meter chooser hand back the trainer.
  await page.evaluate(() => {
    const bt = navigator.bluetooth as any;
    const ask = bt.requestDevice.bind(bt);
    bt.requestDevice = async (o: any) => (o.filters?.length === 1 && o.filters[0].services?.includes(0x1818) ? (window as any).__bt.devices['trainer-1'] : ask(o));
  });
  await press(page, '#btn-meter');
  await expect(page.locator('#toast')).toContainText('That’s your trainer');
  await expect(page.locator('#btn-meter')).not.toContainText('Disconnect');
});

test('when another app takes control, the rider is told once, and again when the trainer takes commands back', async ({ page }) => {
  await setup(page, { getDevices: false });
  await page.goto('/');
  await ride(page);
  await page.evaluate(() => {
    (window as any).__toastsSeen = [];
    new MutationObserver(() => (window as any).__toastsSeen.push(document.getElementById('toast')!.textContent ?? '')).observe(document.getElementById('toast')!, { childList: true, characterData: true, subtree: true });
  });
  await press(page, '#btn-menu-trainer');
  await expect(page.locator('#trainer-status')).toContainText('KICKR Test · resistance follows the road');

  // Another app grabs control: the trainer says so (Fitness Machine Status, op 0xFF) and refuses commands.
  await page.evaluate(() => {
    (window as any).__bt.log.denyCommands = true;
    (window as any).__bt.devices['trainer-1'].statusData.emit([0xff]);
  });
  const toasts = () => page.evaluate(() => (window as any).__toastsSeen as string[]);
  await expect(page.locator('#trainer-status')).toContainText('not taking resistance commands');
  await expect.poll(async () => (await toasts()).some((t) => t.includes('stopped taking resistance commands: close other apps'))).toBe(true);

  // It lets go again: commands are taken, and the rider is told.
  await page.evaluate(() => { (window as any).__bt.log.denyCommands = false; });
  await expect(page.locator('#trainer-status')).toContainText('resistance follows the road', { timeout: 30_000 });
  await expect.poll(async () => (await toasts()).some((t) => t.includes('taking resistance commands again'))).toBe(true);
  expect((await toasts()).filter((t) => t.includes('stopped taking resistance commands')).length).toBeGreaterThan(0);
});
