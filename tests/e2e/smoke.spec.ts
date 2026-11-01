import { expect, test, type Page } from '@playwright/test';
import { mockNeon } from './mockNeon';

// Fast smoke tests of the built app, with Neon mocked (tests/e2e/mockNeon.ts): it opens on the hub,
// Ride starts a demo ride, each main dialog opens and closes, ☰ Menu → Hub comes back, and nothing
// throws. A second test signs in a rider with rides, a plan and a wallet and checks the hub's sections.

/**
 * Clicks with the DOM, not the mouse. The 3D scene renders in software in CI and
 * on small machines, so frames are slow and Playwright's real-click checks (which
 * wait for animation frames to settle) can take many seconds each.
 */
const press = (page: Page, selector: string) => page.locator(selector).evaluate((el) => (el as HTMLElement).click());

/**
 * Each entry opens a dialog from the top bar or from ☰ Menu. `dialog` lists the
 * dialogs that count as success. (An account is required to ride, so every entry opens its own dialog.)
 */
const DIALOGS: { name: string; button: string; dialog: string[]; menu?: boolean }[] = [
  { name: 'stages', button: '#btn-stage', dialog: ['#stages'] },
  { name: 'workouts', button: '#btn-workouts', dialog: ['#workouts'] },
  { name: 'riders', button: '#btn-riders', dialog: ['#riders'] },
  { name: 'leaderboard', button: '#btn-leaderboard', dialog: ['#leaderboard'], menu: true },
  { name: 'time and weather', button: '#btn-weather', dialog: ['#atmosphere'], menu: true },
  { name: 'training plans', button: '#btn-menu-plans', dialog: ['#plans'], menu: true },
  { name: 'kit', button: '#btn-menu-kit', dialog: ['#kit-dialog'], menu: true },
  { name: 'garage', button: '#btn-menu-garage', dialog: ['#garage-dialog'], menu: true },
  { name: 'tour', button: '#btn-tour', dialog: ['#tour'], menu: true },
  { name: 'events', button: '#btn-events', dialog: ['#events'], menu: true },
  { name: 'rivals', button: '#btn-rivals', dialog: ['#rivals'], menu: true },
  { name: 'settings', button: '#btn-settings', dialog: ['#settings'], menu: true },
  { name: 'feedback', button: '#btn-feedback', dialog: ['#feedback-dialog'], menu: true },
  { name: 'privacy', button: '#btn-privacy', dialog: ['#privacy'], menu: true },
  { name: 'profile', button: '#btn-account', dialog: ['#profile-dialog'] },
];

/** The ids of the dialogs that are open right now. */
const openDialogs = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll('dialog[open]')).map((d) => `#${d.id}`));

test('loads, starts a demo ride and opens every main dialog without errors', async ({ page }) => {
  // The longest test: the hub, a demo ride and about fifteen dialogs, each loaded on first use, all in software WebGL.
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    // Blocked/failed network requests (fonts, analytics, Sentry) are not app errors.
    if (/Failed to load resource|net::ERR|ERR_BLOCKED|ERR_NAME|ERR_INTERNET|ERR_CONNECTION|ERR_TUNNEL|CORS/i.test(text)) return;
    errors.push(`console.error: ${text}`);
  });

  await mockNeon(page, { signedIn: true }); // an account is required to ride
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
  await expect(page.locator('canvas').first()).toBeAttached();

  // The hub comes first: header, seven sections, a route to pick.
  await expect(page.locator('#hub')).toBeVisible();
  await expect(page.locator('#home')).toBeHidden();
  await expect(page.locator('.hub-ride-title')).toHaveText('Heartland Rollers');
  await expect(page.locator('.hub-tab')).toHaveCount(7);
  await expect(page.locator('#hub-name')).toHaveText('Sam');
  await expect(page.locator('#hub-s-route .hub-stage')).not.toHaveCount(0);
  await press(page, '#hub-tab-training');
  await expect(page.locator('#hub-s-training .hub-workout').first()).toBeVisible();
  await press(page, '#hub-tab-route');
  await press(page, '[data-fkey="stage-route66"]');
  await expect(page.locator('.hub-ride-title')).toHaveText('Route 66 Flats');
  // There is no guest hub: no sign-in prompts, every section is the rider's own.
  await press(page, '#hub-tab-achievements');
  await expect(page.locator('#hub-s-achievements .hub-bignum strong')).toHaveText('7');
  await expect(page.locator('#hub .hub-guest, #hub .hub-signin-card')).toHaveCount(0);
  await press(page, '#hub-go');
  await expect(page.locator('#hub')).toBeHidden();
  await expect(page.locator('.topbar')).toBeVisible();
  await expect(page.locator('#stage-name')).toContainText('Route 66 Flats');

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

  // ☰ Menu → 🏠 Hub (a ride of under a minute needs no questions), then Ride goes back to the road.
  await press(page, '#btn-menu');
  await press(page, '#btn-menu-hub');
  await expect(page.locator('#hub')).toBeVisible();
  await expect(page.locator('#hub-leave[open]')).toHaveCount(0);
  await page.keyboard.press('Escape'); // never strands you: focus returns to Ride
  await expect(page.locator('#hub-go')).toBeFocused();
  await press(page, '#hub-go');
  await expect(page.locator('#hub')).toBeHidden();

  // Still riding, and nothing threw.
  await expect(page.locator('#demo-panel')).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('the hub for a signed-in rider: header, sections, and back from a ride', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/Failed to load resource|net::ERR|ERR_BLOCKED|ERR_NAME|ERR_INTERNET|ERR_CONNECTION|ERR_TUNNEL|CORS/i.test(m.text())) return;
    errors.push(`console.error: ${m.text()}`);
  });

  await mockNeon(page, { signedIn: true });
  await page.addInitScript(() => {
    localStorage.setItem('americanflyers.signedIn', '1');
    localStorage.setItem('americanflyers.onboarded', '1');
  });
  if (!process.env.E2E_FULL_FPS) {
    await page.addInitScript(() => {
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => window.setTimeout(() => raf(cb), 1000) as unknown as number;
    });
  }
  await page.goto('/');

  // Header: name, level, credits from the wallet; the plan's next session is one click away.
  await expect(page.locator('#hub')).toBeVisible();
  await expect(page.locator('#hub-name')).toHaveText('Sam');
  await expect(page.locator('.hub-lv')).toHaveText('Level 7');
  await expect(page.locator('.hub-credits').first()).toContainText('1,240');
  await expect(page.locator('.hub-plan-row')).toContainText('Tempo 2×20');

  // Route: best times come from the rider's finished rides.
  await expect(page.locator('#hub-s-route .hub-chip.gold').first()).toBeVisible();

  // Training: choosing a workout sets what Ride starts, on a road without a finish line.
  await press(page, '#hub-tab-training');
  await press(page, '[data-fkey="w-builtin-sweet-spot-3x10"]');
  await expect(page.locator('.hub-ride-title')).toHaveText('Sweet Spot 3×10');
  await expect(page.locator('.hub-ride-meta')).toContainText('Heartland Rollers');

  // Plan, Achievements, Stats, Garage and Events fill in from the account.
  await press(page, '#hub-tab-plan');
  await expect(page.locator('#hub-s-plan .hub-next-session h3')).toHaveText('Tempo 2×20');
  await press(page, '#hub-tab-achievements');
  await expect(page.locator('#hub-s-achievements .hub-bignum strong')).toHaveText('7');
  await press(page, '#hub-tab-stats');
  await expect(page.locator('#hub-s-stats .hub-kpi').first()).toBeVisible();
  await expect(page.locator('#hub-s-stats .hub-ride-row').first()).toContainText('Sweet Spot');
  await press(page, '#hub-tab-garage');
  await expect(page.locator('#hub-s-garage .hub-challenge').first()).toBeVisible();
  await press(page, '#hub-tab-events');
  await expect(page.locator('#hub-s-events .hub-event')).toHaveCount(2);

  // A ride row opens the existing ride detail in the profile.
  await press(page, '#hub-tab-stats');
  await press(page, '#hub-s-stats .hub-ride-row >> nth=0');
  await expect(page.locator('#profile-dialog[open]')).toBeVisible();
  await expect(page.locator('#profile-dialog details.activity[open]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('#profile-dialog[open]')).toHaveCount(0);
  await expect(page.locator('#hub')).toBeVisible();

  // Ride starts the chosen workout; the finish card's way back is "Back to the hub".
  await press(page, '#hub-go');
  await expect(page.locator('#hub')).toBeHidden();
  await expect(page.locator('#workout-panel')).toBeVisible();
  await expect(page.locator('#wp-name')).toHaveText('Sweet Spot 3×10');
  await press(page, '#btn-menu');
  await press(page, '#btn-menu-hub');
  await expect(page.locator('#hub')).toBeVisible();
  await expect(page.locator('#workout-panel')).toBeHidden();

  expect(errors, errors.join('\n')).toEqual([]);
});
