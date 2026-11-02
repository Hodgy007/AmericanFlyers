import { expect, test, type Page } from '@playwright/test';
import { mockNeon } from './mockNeon';

// Auto graphics: starts on Ultra (a software renderer normally starts on Low, so ?softgpu=off pretends
// this browser has a real GPU), notices jerky frames (?jank= makes them on purpose), steps down with a
// note, remembers what it settled on for the next visit.

const press = (page: Page, selector: string) => page.locator(selector).evaluate((el) => (el as HTMLElement).click());
type Info = { tier: string; choice: string; autoTier: string; scale: number; remembered: string; retest: boolean; change: string };
const gfx = (page: Page) => page.evaluate(() => (window as unknown as { __afGraphics?: Info }).__afGraphics) as Promise<Info>;
const memory = (page: Page) => page.evaluate(() => localStorage.getItem('americanflyers.graphicsAuto'));

async function setup(page: Page, seed?: Record<string, string>) {
  await mockNeon(page, { signedIn: true });
  await page.addInitScript((entries) => {
    // Only on the first load of the test: a reload must see what the first one remembered.
    if (sessionStorage.getItem('af-test-init')) return;
    sessionStorage.setItem('af-test-init', '1');
    localStorage.setItem('americanflyers.signedIn', '1');
    localStorage.setItem('americanflyers.onboarded', '1');
    for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
  }, seed ?? {});
}

test('Auto steps down when frames are jerky, says so, and remembers what worked', async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await setup(page);
  await page.setViewportSize({ width: 320, height: 200 }); // Ultra in software is slow: keep the canvas small
  await page.goto('/?softgpu=off&jank=80&settle=4000');
  await expect(page.locator('#hub')).toBeVisible();

  // No memory, a "real" GPU: Auto starts on Ultra.
  expect(await gfx(page)).toMatchObject({ tier: 'ultra', choice: 'auto', autoTier: 'ultra', remembered: '', retest: false });
  expect(await memory(page)).toBeNull();

  await press(page, '#hub-go');
  await expect(page.locator('#hub')).toBeHidden();

  // 80 ms of extra work in every frame: clearly struggling, so a whole tier goes at once, with a note.
  await expect.poll(async () => (await gfx(page)).tier, { timeout: 120_000 }).not.toBe('ultra');
  expect((await gfx(page)).change).toContain('fast');
  await expect(page.locator('#toast')).toContainText(/Graphics lowered to \w+ for a smoother ride/);

  // Settings names what Auto is running now and explains it.
  await press(page, '#btn-settings');
  await expect(page.locator('#settings[open]')).toBeVisible();
  const now = (await gfx(page)).tier;
  await expect(page.locator('#graphics-choice option[value=auto]')).toHaveText(`Auto (now: ${now[0].toUpperCase()}${now.slice(1)})`);
  await expect(page.locator('#graphics-note')).toContainText('Auto starts on Ultra');
  await expect(page.locator('#graphics-note')).toContainText(`lowered to ${now[0].toUpperCase()}${now.slice(1)}`);
  await press(page, '#settings button[value=cancel]');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Auto starts from what it remembered, and re-tests one tier higher every third session', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  const gpu = 'Test GPU (?softgpu=off)';
  const now = Date.now();
  const saved = { tier: 'medium', scale: 0.85, at: now - 1000, tested: now - 1000, sessions: 0, gpu };
  await setup(page, { 'americanflyers.graphicsAuto': JSON.stringify(saved) });
  await page.goto('/?softgpu=off&adapt=off');
  await expect(page.locator('#hub')).toBeVisible();
  expect(await gfx(page)).toMatchObject({ tier: 'medium', scale: 0.85, remembered: 'medium', retest: false });
  expect(JSON.parse((await memory(page))!).sessions).toBe(1); // this visit counts

  await page.reload();
  await expect(page.locator('#hub')).toBeVisible();
  expect(await gfx(page)).toMatchObject({ tier: 'medium', remembered: 'medium', retest: false });
  await page.reload();
  await expect(page.locator('#hub')).toBeVisible();
  expect(JSON.parse((await memory(page))!).sessions).toBe(3); // three visits so far

  // The fourth visit re-tests one tier above; the remembered tier stays in storage.
  await page.reload();
  await expect(page.locator('#hub')).toBeVisible();
  expect(await gfx(page)).toMatchObject({ tier: 'high', scale: 1, remembered: 'medium', retest: true });
  expect(JSON.parse((await memory(page))!)).toMatchObject({ tier: 'medium', sessions: 0 });
  await page.reload();
  expect(await gfx(page)).toMatchObject({ tier: 'medium', retest: false }); // and then back to the remembered tier
  expect(errors, errors.join('\n')).toEqual([]);
});
