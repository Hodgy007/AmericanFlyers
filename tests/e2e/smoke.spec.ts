import { expect, test, type Page } from '@playwright/test';

// A fast smoke test of the built app: it loads with Neon mocked (signed out),
// a demo ride starts, each main dialog opens and closes, and nothing throws.

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
};

/** Neon Auth and the Data API are unreachable (and not wanted) in tests: answer them locally. */
async function mockNeon(page: Page) {
  await page.route(/neonauth|apirest/, (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const isAuth = /neonauth/.test(req.url());
    // No session for Auth; empty result sets for the Data API.
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: isAuth ? 'null' : '[]' });
  });
}

/**
 * Clicks with the DOM, not the mouse. The 3D scene renders in software in CI and
 * on small machines, so frames are slow and Playwright's real-click checks (which
 * wait for animation frames to settle) can take many seconds each.
 */
const press = (page: Page, selector: string) => page.locator(selector).evaluate((el) => (el as HTMLElement).click());

/**
 * Each entry opens a dialog from the top bar or from ☰ Menu. `dialog` lists the
 * dialogs that count as success: signed out, some entries ask you to sign in instead.
 */
const DIALOGS: { name: string; button: string; dialog: string[]; menu?: boolean }[] = [
  { name: 'stages', button: '#btn-stage', dialog: ['#stages'] },
  { name: 'workouts', button: '#btn-workouts', dialog: ['#workouts'] },
  { name: 'riders', button: '#btn-riders', dialog: ['#riders'] },
  { name: 'leaderboard', button: '#btn-leaderboard', dialog: ['#leaderboard', '#signin'], menu: true },
  { name: 'time and weather', button: '#btn-weather', dialog: ['#atmosphere'], menu: true },
  { name: 'training plans', button: '#btn-menu-plans', dialog: ['#plans'], menu: true },
  { name: 'kit', button: '#btn-menu-kit', dialog: ['#kit-dialog'], menu: true },
  { name: 'tour', button: '#btn-tour', dialog: ['#tour'], menu: true },
  { name: 'settings', button: '#btn-settings', dialog: ['#settings'], menu: true },
  { name: 'feedback', button: '#btn-feedback', dialog: ['#feedback-dialog', '#signin'], menu: true },
  { name: 'sign in', button: '#btn-account', dialog: ['#signin'] },
];

/** The ids of the dialogs that are open right now. */
const openDialogs = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll('dialog[open]')).map((d) => `#${d.id}`));

test('loads, starts a demo ride and opens every main dialog without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    // Blocked/failed network requests (fonts, analytics, Sentry) are not app errors.
    if (/Failed to load resource|net::ERR|ERR_BLOCKED|ERR_NAME|ERR_INTERNET|ERR_CONNECTION|ERR_TUNNEL|CORS/i.test(text)) return;
    errors.push(`console.error: ${text}`);
  });

  await mockNeon(page);
  await page.addInitScript(() => {
    // Skip the home page and the first-ride guide.
    localStorage.setItem('americanflyers.signedIn', '1');
    localStorage.setItem('americanflyers.onboarded', '1');
  });
  // Software WebGL makes every frame expensive, which starves the test's own clicks and
  // checks. Run the render loop at ~1 fps: the app code still runs, the machine doesn't choke.
  // (Set E2E_FULL_FPS=1 to turn this off.)
  if (!process.env.E2E_FULL_FPS) {
    await page.addInitScript(() => {
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => window.setTimeout(() => raf(cb), 1000) as unknown as number;
    });
  }

  await page.goto('/');
  await expect(page.locator('.topbar')).toBeVisible();
  await expect(page.locator('canvas').first()).toBeAttached();

  // Demo ride from the menu: the demo power slider appears and the HUD fills in.
  await press(page, '#btn-menu');
  await press(page, '#btn-demo');
  await expect(page.locator('#demo-panel')).toBeVisible();
  await expect(page.locator('#hud')).not.toBeEmpty();

  // Pedal for a moment: speed should come up from zero.
  await page.locator('#demo-power').evaluate((el: HTMLInputElement) => {
    el.value = '250';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(2500);
  await expect(page.locator('#hud')).toContainText(/km\/h|mph/i);

  // Every main dialog opens, then closes.
  for (const d of DIALOGS) {
    if (d.menu) await press(page, '#btn-menu');
    await press(page, d.button);
    await expect.poll(async () => (await openDialogs(page)).some((id) => d.dialog.includes(id)), { message: `${d.name} dialog opens` }).toBe(true);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((el) => (el as HTMLDialogElement).close()));
    await expect.poll(() => openDialogs(page), { message: `${d.name} dialog closes` }).toEqual([]);
  }

  // Escape closes a dialog too (checked once, on the last one opened below).
  await press(page, '#btn-stage');
  await expect(page.locator('#stages[open]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#stages[open]')).toHaveCount(0);

  // Still riding, and nothing threw.
  await expect(page.locator('#demo-panel')).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});
