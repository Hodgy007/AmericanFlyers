import { expect, test, type Page } from '@playwright/test';
import { mockNeon } from './mockNeon';

// Ground cover (grass tufts, flowers, stones beside the road): High and Ultra only. Low and Medium never
// download its chunk; on High it appears after the first frame; stepping down to Medium disposes it and
// stepping back up makes it again, all without errors.

const press = (page: Page, selector: string) => page.locator(selector).evaluate((el) => (el as HTMLElement).click());
type Cover = { calls: number; instances: number; triangles: number; cells: number };
const cover = (page: Page) => page.evaluate(() => (window as unknown as { __afCover?: Cover }).__afCover);

async function start(page: Page, tier: string, errors: string[], fetched: string[]) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !/Failed to load resource|net::ERR|ERR_|CORS/i.test(t)) errors.push(`console.error: ${t}`);
    if (/Shader Error|WebGLProgram/.test(t)) errors.push(`shader: ${t.slice(0, 400)}`);
  });
  page.on('response', (r) => { if (/\/groundCover-/.test(r.url()) && r.ok()) fetched.push(r.url()); });
  await mockNeon(page, { signedIn: true });
  await page.addInitScript(() => {
    localStorage.setItem('americanflyers.signedIn', '1');
    localStorage.setItem('americanflyers.onboarded', '1');
    const raf = window.requestAnimationFrame.bind(window);
    const w = window as unknown as { __frames: number };
    w.__frames = 0; // frames drawn so far: a time-free way to say "long enough for High to have fetched its cover"
    window.requestAnimationFrame = (cb) => window.setTimeout(() => raf((t) => { w.__frames++; cb(t); }), 1000) as unknown as number; // software rendering is slow: one frame a second
  });
  await page.goto(`/?stage=heartland&start=3&graphics=${tier}&adapt=off`);
  await expect(page.locator('#hub')).toBeVisible();
  await press(page, '#hub-go');
  await expect(page.locator('#hub')).toBeHidden();
}

test('Medium never downloads the ground cover', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  const fetched: string[] = [];
  await start(page, 'medium', errors, fetched);
  // High fetches its cover within the first few frames (the next test sees it after about four): give Medium many more, then look.
  await expect.poll(() => page.evaluate(() => (window as unknown as { __frames: number }).__frames), { timeout: 120_000 }).toBeGreaterThanOrEqual(12);
  expect(await cover(page)).toBeUndefined();
  expect(fetched).toEqual([]);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('High grows the cover after the first frame, and Auto-style tier changes remove and restore it', async ({ page }) => {
  test.setTimeout(400_000);
  const errors: string[] = [];
  const fetched: string[] = [];
  await start(page, 'high', errors, fetched);
  await expect.poll(() => fetched.length, { timeout: 90_000 }).toBeGreaterThan(0);
  await expect.poll(async () => (await cover(page))?.instances ?? 0, { timeout: 150_000 }).toBeGreaterThan(300);
  const c = (await cover(page))!;
  expect(c.calls).toBeLessThanOrEqual(4);
  expect(c.triangles).toBeGreaterThan(c.instances * 10);

  const choose = async (tier: string) => {
    await press(page, '#btn-settings');
    await expect(page.locator('#settings[open]')).toBeVisible();
    await page.locator('#graphics-choice').selectOption(tier);
    await press(page, '#settings button[value=save]');
    await expect(page.locator('#settings[open]')).toHaveCount(0);
  };
  await choose('medium');
  await expect.poll(() => cover(page), { timeout: 60_000 }).toBeUndefined();
  await choose('ultra');
  await expect.poll(async () => (await cover(page))?.instances ?? 0, { timeout: 200_000 }).toBeGreaterThan(300);
  expect(errors, errors.join('\n')).toEqual([]);
});
