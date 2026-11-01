import { expect, test, type Page } from '@playwright/test';

// Trainer and heart rate in the ☰ Menu, remembered devices, one-tap reconnect, the
// no-chooser reconnect on load (getDevices), and automatic reconnection after a drop.
// navigator.bluetooth is replaced by a small mock, so no hardware is needed.

test.use({ viewport: { width: 960, height: 600 } });

const SHOTS = process.env.E2E_SHOTS; // set to a folder to save screenshots

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

async function mockNeon(page: Page) {
  await page.route(/neonauth|apirest/, (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: /neonauth/.test(req.url()) ? 'null' : '[]' });
  });
}

const press = (page: Page, selector: string) => page.locator(selector).evaluate((el) => (el as HTMLElement).click());

interface MockOptions {
  /** Offer navigator.bluetooth.getDevices (Chrome with persistent permissions). */
  getDevices: boolean;
  /** localStorage 'americanflyers.devices' to start with. */
  remembered?: unknown;
}

async function setup(page: Page, o: MockOptions) {
  await mockNeon(page);
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
      connects: { 'trainer-1': 0, 'hr-1': 0 } as Record<string, number>,
      writes: [] as number[][],
      forgets: [] as string[],
      failNext: 0, // make the next N gatt.connect() calls fail
    };
    const devices: Record<string, any> = {};

    function char(onWrite?: (data: number[]) => void) {
      const c: any = new EventTarget();
      c.value = null;
      c.startNotifications = async () => c;
      c.writeValueWithResponse = async (buf: ArrayBuffer) => { onWrite?.([...new Uint8Array(buf)]); };
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
              setTimeout(() => control.emit([0x80, data[0], 0x01]), 0); // success response
            });
            d.bikeData = bike;
            return { getCharacteristic: async (u: number) => (u === 0x2ad2 ? bike : control) };
          }
          if (id === 'hr-1' && uuid === 0x180d) {
            const hr = char();
            d.hrData = hr;
            return { getCharacteristic: async () => hr };
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

    const bluetooth: any = {
      async requestDevice(options: any) {
        log.requests.push(JSON.parse(JSON.stringify(options)));
        const f = options.filters?.[0] ?? {};
        const byName = Object.values(devices).find((d: any) => d.name === f.name);
        if (byName) return byName;
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
  expect(log.connects).toEqual({ 'trainer-1': 1, 'hr-1': 1 });
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
  await expect(page.locator('#toast')).toContainText(/Reconnected/);
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
