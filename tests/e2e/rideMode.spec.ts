import { expect, test, type Page } from '@playwright/test';
import { mockNeon } from './mockNeon';

// The ride mode choice in the hub's Ride panel: Solo (the default), With pro teams, and Race.
// The teams on the road show in Riders under "Pro teams on the road", and in ☰ Menu → Pro teams.

const press = (page: Page, selector: string) => page.locator(selector).evaluate((el) => (el as HTMLElement).click());

/**
 * Opens the app signed in. The mocked account's saved settings predate the ride modes (no settingsVersion), so signing in
 * would move them to Solo once; `accountMigrated` says the account has already been through that.
 */
async function open(page: Page, seed?: Record<string, unknown>, accountMigrated = true) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await mockNeon(page, { signedIn: true });
  if (accountMigrated) {
    await page.route(/apirest.*\/profiles/, (route) => {
      const req = route.request();
      if (req.method() !== 'GET') return route.fallback();
      return route.fulfill({
        status: 200,
        headers: { 'access-control-allow-origin': req.headers()['origin'] ?? '*', 'access-control-allow-credentials': 'true', 'content-type': 'application/json' },
        body: JSON.stringify({ settings: { ftp: 245, settingsVersion: 2 } }),
      });
    });
  }
  await page.addInitScript((saved) => {
    localStorage.setItem('americanflyers.signedIn', '1');
    localStorage.setItem('americanflyers.onboarded', '1');
    // Only the first load seeds the settings, so a later change survives a reload.
    if (saved && !localStorage.getItem('americanflyers.settings')) localStorage.setItem('americanflyers.settings', JSON.stringify(saved));
  }, seed ?? null);
  if (!process.env.E2E_FULL_FPS) {
    await page.addInitScript(() => {
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => window.setTimeout(() => raf(cb), 1000) as unknown as number;
    });
  }
  await page.goto('/');
  await expect(page.locator('#hub')).toBeVisible();
  await expect(page.locator('#hub-name')).toHaveText('Sam');
  return errors;
}

/** How many pro team groups the Riders dialog lists (it closes the dialog again). */
async function teamsOnRoad(page: Page) {
  await press(page, '#btn-riders');
  await expect(page.locator('#riders[open]')).toBeVisible();
  const n = await page.locator('#riders-teams .team-row').count();
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((el) => (el as HTMLDialogElement).close()));
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  return n;
}

const mode = (m: string) => `.hub-mode-opt[data-mode="${m}"]`;
const storedSettings = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('americanflyers.settings') ?? '{}'));

test('Solo is the default: no pro teams on the road, and the menu can add and remove them mid-ride', async ({ page }) => {
  const errors = await open(page);

  // Solo is chosen, with a line of help; Race needs a route with a finish (Heartland Rollers is endless).
  await expect(page.locator(mode('solo'))).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.hub-mode-help')).toContainText('Just you');
  await expect(page.locator(mode('race'))).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#hub-go')).toContainText('Ride');

  await press(page, '[data-fkey="stage-route66"]');
  await expect(page.locator('.hub-ride-title')).toHaveText('Route 66 Flats');
  await expect(page.locator(mode('race'))).not.toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator(mode('solo'))).toHaveAttribute('aria-checked', 'true');

  await press(page, '#hub-go');
  await expect(page.locator('#hub')).toBeHidden();
  await expect(page.locator('#stage-name')).toContainText('Route 66 Flats');
  expect(await teamsOnRoad(page)).toBe(0);
  await expect(page.locator('#race-panel')).toBeHidden();

  // ☰ Menu → Pro teams: on brings them in without resetting the ride; off sends them away.
  await press(page, '#btn-menu');
  await expect(page.locator('#btn-proteams')).toHaveText('🚴 Pro teams: off');
  await press(page, '#btn-proteams');
  await expect(page.locator('#btn-proteams')).toHaveText('🚴 Pro teams: on');
  await expect(page.locator('#stage-name')).toContainText('Route 66 Flats');
  expect(await teamsOnRoad(page)).toBeGreaterThan(0);
  expect((await storedSettings(page)).proTeams).toBe(true);
  await press(page, '#btn-proteams');
  await expect(page.locator('#btn-proteams')).toHaveText('🚴 Pro teams: off');
  expect(await teamsOnRoad(page)).toBe(0);

  expect(errors, errors.join('\n')).toEqual([]);
});

test('With pro teams: the teams ride along, the choice is remembered, and Settings agrees', async ({ page }) => {
  const errors = await open(page);
  await press(page, mode('pro'));
  await expect(page.locator(mode('pro'))).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.hub-mode-help')).toContainText('pro teams');
  await expect(page.locator('#hub-go')).toContainText('Ride');
  await press(page, '#hub-go');
  await expect(page.locator('#hub')).toBeHidden();
  expect(await teamsOnRoad(page)).toBeGreaterThan(0);
  await press(page, '#btn-menu');
  await expect(page.locator('#btn-proteams')).toHaveText('🚴 Pro teams: on');

  // The Settings checkbox is the same switch.
  await press(page, '#btn-menu');
  await press(page, '#btn-settings');
  await expect(page.locator('#settings input[name=proTeams]')).toBeChecked();
  await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((el) => (el as HTMLDialogElement).close()));

  // Remembered: after a reload the hub opens on With pro teams.
  await expect.poll(async () => (await storedSettings(page)).proTeams).toBe(true);
  await page.reload();
  await expect(page.locator('#hub')).toBeVisible();
  await expect(page.locator(mode('pro'))).toHaveAttribute('aria-checked', 'true');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('an existing rider with pro teams on is moved to Solo once, then their choice sticks', async ({ page }) => {
  await open(page, { riderKg: 66, proTeams: true }); // saved before the ride-mode choice: no settingsVersion
  await expect(page.locator(mode('solo'))).toHaveAttribute('aria-checked', 'true');
  expect((await storedSettings(page)).settingsVersion).toBeGreaterThanOrEqual(2);
  expect((await storedSettings(page)).riderKg).toBe(66); // nothing else is touched
  await press(page, mode('pro'));
  await expect.poll(async () => (await storedSettings(page)).proTeams).toBe(true);
  await page.reload();
  await expect(page.locator(mode('pro'))).toHaveAttribute('aria-checked', 'true');
});

test('Race on a route with a finish starts a race, and is not remembered', async ({ page }) => {
  const errors = await open(page);
  await press(page, '[data-fkey="stage-route66"]');
  await press(page, mode('race'));
  await expect(page.locator(mode('race'))).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.hub-mode-help')).toContainText('race');
  await expect(page.locator('#hub-go')).toContainText('Race');

  // Choosing a workout (no finish line) puts it back to Solo.
  await press(page, '#hub-tab-training');
  await press(page, '[data-fkey="w-builtin-sweet-spot-3x10"]');
  await expect(page.locator(mode('race'))).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator(mode('solo'))).toHaveAttribute('aria-checked', 'true');
  await press(page, '#hub-tab-route');
  await press(page, '[data-fkey="stage-route66"]');
  await expect(page.locator(mode('race'))).toHaveAttribute('aria-checked', 'true');

  await press(page, '#hub-go');
  await expect(page.locator('#hub')).toBeHidden();
  await expect(page.locator('#stage-name')).toContainText('Route 66 Flats');
  await expect(page.locator('#race-count')).toBeVisible(); // the 3-2-1 on the start line
  await press(page, '#btn-menu');
  await expect(page.locator('#btn-proteams')).toHaveText('🚴 Pro teams: racing');
  await expect(page.locator('#btn-proteams')).toBeDisabled();
  expect((await storedSettings(page)).proTeams).toBe(false); // Race is not a stored mode
  expect(errors, errors.join('\n')).toEqual([]);
});

test('an account saved before the ride modes is moved to Solo once on sign-in', async ({ page }) => {
  // This browser has already been through it (and chose pro teams); the account's settings have no settingsVersion.
  await open(page, { settingsVersion: 2, proTeams: true }, false);
  await expect(page.locator(mode('solo'))).toHaveAttribute('aria-checked', 'true');
  await expect.poll(async () => (await storedSettings(page)).proTeams).toBe(false);
});
