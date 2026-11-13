import { expect, test, type Page } from '@playwright/test';
import { mockNeon } from './mockNeon';

// A built-in stage's road loads on demand (src/stages.ts). Picking one whose road has not arrived keeps the hub up with the Ride button
// busy until it has; a road that cannot be fetched says so and can be asked for again; and a page opened on a stage waits for its road.

test.use({ serviceWorkers: 'block' }); // (so page.route sees the chunk requests)

const press = (page: Page, selector: string) => page.locator(selector).evaluate((el) => (el as HTMLElement).click());
const ALPE = /\/assets\/alpe-[^/]*\.js/;

async function openHub(page: Page, url = '/') {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await mockNeon(page, { signedIn: true });
  await page.addInitScript(() => {
    localStorage.setItem('americanflyers.signedIn', '1');
    localStorage.setItem('americanflyers.onboarded', '1');
  });
  await page.goto(url);
  await expect(page.locator('#hub')).toBeVisible();
  return errors;
}

test('Ride waits, busy, for the chosen stage’s road, then starts on it', async ({ page }) => {
  const errors = await openHub(page);
  // Every stage is listed at once, with its length and climbing, though none of their roads has been fetched.
  const card = page.locator('[data-fkey="stage-alpe-dhuez"]');
  await expect(card).toBeVisible();
  await expect(page.locator('#hub-stage-meta-alpe-dhuez')).toContainText('14.0 km');
  await expect(page.locator('#stage-name')).not.toHaveText(/Alpe/);

  let requested = 0;
  await page.route(ALPE, async (route) => {
    requested++;
    await new Promise((r) => setTimeout(r, 2500));
    await route.continue();
  });
  await press(page, '[data-fkey="stage-alpe-dhuez"]');
  await press(page, '#hub-go');
  await expect(page.locator('#hub-go')).toHaveAttribute('aria-busy', 'true'); // the road is on its way
  await expect(page.locator('#hub')).toBeVisible(); // not a wrong road behind the hub
  await expect(page.locator('#hub')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#hub-go')).not.toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#stage-name')).toContainText("Alpe d'Huez");
  expect(requested).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('a road that cannot be fetched says so and leaves the hub up', async ({ page }) => {
  const errors = await openHub(page);
  await page.route(ALPE, (route) => route.abort('connectionfailed'));
  await press(page, '[data-fkey="stage-alpe-dhuez"]');
  await press(page, '#hub-go');
  await expect(page.locator('#toast')).toContainText('Couldn’t load that');
  await expect(page.locator('#hub')).toBeVisible();
  await expect(page.locator('#hub-go')).not.toHaveAttribute('aria-busy', 'true');
  // (A browser keeps a failed module fetch for the life of the page, so a retry here needs a reload; src/lazy.ts starts a fresh attempt either way.)
  expect(errors.filter((e) => !/Failed to fetch|dynamically imported|ERR_/.test(e))).toEqual([]);
});

test('a page opened with ?stage= on a stage whose road cannot be fetched opens on Heartland and says so', async ({ page }) => {
  await page.route(ALPE, (route) => route.abort('connectionfailed'));
  await openHub(page, '/?stage=alpe-dhuez');
  await expect(page.locator('#stage-name')).toContainText('Heartland Rollers');
  await expect(page.locator('#toast')).toContainText('Couldn’t load Alpe');
});

test('a page opened with ?stage= waits for that stage’s road before drawing it', async ({ page }) => {
  const errors = await openHub(page, '/?stage=alpe-dhuez');
  await expect(page.locator('#stage-name')).toContainText("Alpe d'Huez");
  await press(page, '#hub-go');
  await expect(page.locator('#hub')).toBeHidden();
  expect(errors).toEqual([]);
});
