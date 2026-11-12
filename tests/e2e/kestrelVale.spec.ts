import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { mockNeon } from './mockNeon';

// Kestrel Vale (src/worlds/kestrelVale.ts): the world's five routes are ONE card in the hub with a chip each (picking a chip starts
// that stage), and four places on the lap (the village, the lakeshore bend towards the water, the climb and the Raven Gap cutting)
// load on Low and Medium without page or shader errors. The two partway routes are ridden from 0.2 km (and the Lakeside Sprint from
// 1.6 km too, just past the lap line, where the road behind the rider is the loop's own end rather than a straight). Each place is
// saved as test-results/kestrel-<tier>-<km>.png (or kestrel-<route>-<tier>-<km>.png) for a human (or an agent) to look at: the village,
// the water, the climb and the cutting should read as coherent places, with no floating road, no water over the road and no road under the ground.
// By default (and in CI) the places load on Low only, briefly, as an error check; KESTREL_SHOTS=1 adds Medium, waits for the terrain to
// settle (KESTREL_SETTLE_MS, default 25 s) and saves the screenshots.
const SHOTS = !!process.env.KESTREL_SHOTS;

test.use({ viewport: { width: 800, height: 450 }, deviceScaleFactor: 1 });

const IDS = ['kestrel-vale', 'kestrel-vale-loop', 'kestrel-vale-grand', 'kestrel-vale-raven-scar', 'kestrel-vale-lakeside'];
/** Start points, km along the first lap: the village's high street, the lakeshore bend towards the water, the climb's third hairpin and the cutting. */
const SPOTS = [0.3, 1.8, 8, 10.4];
/** The partway routes: where to start them (km into the route). The Lakeside Sprint crosses the lap line at 1.4 km. */
const PARTIAL: [string, number][] = [['kestrel-vale-raven-scar', 0.2], ['kestrel-vale-lakeside', 0.2], ['kestrel-vale-lakeside', 1.6]];

async function signedIn(page: import('@playwright/test').Page) {
  await mockNeon(page, { signedIn: true });
  await page.addInitScript(() => {
    localStorage.setItem('americanflyers.signedIn', '1');
    localStorage.setItem('americanflyers.onboarded', '1');
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => window.setTimeout(() => raf(cb), 1000) as unknown as number;
  });
}

test('the hub shows one Kestrel Vale card with a chip for each of its five routes, and a chip starts that route', async ({ page }) => {
  await signedIn(page);
  await page.goto('/?adapt=off&graphics=low');
  await expect(page.locator('#hub')).toBeVisible();
  await page.locator('#hub-tab-route').evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator('#hub-s-route .hub-world')).toHaveCount(1);
  await expect(page.locator('#hub-s-route .hub-world .hub-world-name')).toHaveText('Kestrel Vale');
  await expect(page.locator('#hub-s-route .hub-world [data-fkey^="stage-"]')).toHaveCount(5);
  // No separate card for any of them.
  await expect(page.locator('#hub-s-route .hub-stage:not(.hub-world) [data-fkey^="stage-kestrel"]')).toHaveCount(0);
  for (const id of IDS) await expect(page.locator(`#hub-s-route .hub-world [data-fkey="stage-${id}"]`)).toHaveCount(1);
  await expect(page.locator('[data-fkey="stage-kestrel-vale-loop"] .hub-route-name')).toHaveText('Vale Loop');
  await expect(page.locator('[data-fkey="stage-kestrel-vale"] .hub-route-meta')).toContainText('∞');
  await expect(page.locator('[data-fkey="stage-kestrel-vale-lakeside"] .hub-route-meta')).toContainText('5.7 km');
  // Picking a chip chooses that stage (the chip is pressed, the card is chosen) and Ride starts it.
  await page.locator('[data-fkey="stage-kestrel-vale-raven-scar"]').evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator('[data-fkey="stage-kestrel-vale-raven-scar"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-fkey="stage-kestrel-vale-loop"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#hub-s-route .hub-world')).toHaveClass(/selected/);
  mkdirSync('test-results', { recursive: true });
  await page.locator('#hub-s-route .hub-world').screenshot({ path: 'test-results/kestrel-hub-card.png' });
  await page.locator('#hub-go').evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator('#hub')).toBeHidden();
  await expect(page.locator('#stage-name')).toContainText('Raven Scar');
});

test('the hub world card fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await signedIn(page);
  await page.goto('/?adapt=off&graphics=low');
  await page.locator('#hub-tab-route').evaluate((el) => (el as HTMLElement).click());
  const card = page.locator('#hub-s-route .hub-world');
  await expect(card).toBeVisible();
  const box = (await card.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  mkdirSync('test-results', { recursive: true });
  await card.screenshot({ path: 'test-results/kestrel-hub-card-phone.png' });
});

/** Loads a stage at `km`, rides nothing, waits for the lazy chunks and the terrain, and with KESTREL_SHOTS saves a screenshot of the 3D scene. */
async function loads(page: import('@playwright/test').Page, stage: string, km: number, tier: string, file: string, village = false) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && !/Failed to load resource|net::ERR|ERR_|CORS/i.test(t)) errors.push(`console.error: ${t}`);
    if (/Shader Error|WebGLProgram/.test(t)) errors.push(`shader: ${t.slice(0, 300)}`);
  });
  const fetched: string[] = [];
  page.on('response', (r) => { if (/\/ground-|\/roadExtras-|\/monuments-/.test(r.url()) && r.ok()) fetched.push(r.url().split('/').slice(-1)[0]); });
  await signedIn(page);
  await page.goto(`/?stage=${stage}&start=${km}&graphics=${tier}&adapt=off`);
  await expect(page.locator('#hub')).toBeVisible();
  await page.locator('#hub-go').evaluate((el) => (el as HTMLElement).click());
  await expect(page.locator('#hub')).toBeHidden();
  // The lazy chunks (the splatted ground, and by the village the code-built terraces and church) arrive after the first frame.
  await expect.poll(() => fetched.some((f) => /^ground-/.test(f)) && (!village || fetched.some((f) => /^monuments-/.test(f))), { timeout: 120_000 }).toBe(true);
  // Terrain tiles build a few a frame, at one frame a second here.
  await page.waitForTimeout(SHOTS ? Number(process.env.KESTREL_SETTLE_MS ?? 25_000) : 3_000);
  if (SHOTS) {
    mkdirSync('test-results', { recursive: true });
    // Only the 3D scene: the HUD panels would cover the places being looked at.
    await page.addStyleTag({ content: 'body * { visibility: hidden !important } #scene { visibility: visible !important }' });
    await page.screenshot({ path: `test-results/${file}.png` });
  }
  expect(errors, errors.join('\n')).toEqual([]);
}

for (const tier of SHOTS ? ['low', 'medium'] : ['low']) {
  for (const km of SPOTS) {
    test(`Kestrel Vale at ${km} km on ${tier}: loads without errors`, async ({ page }) => {
      test.setTimeout(300_000);
      await loads(page, 'kestrel-vale-loop', km, tier, `kestrel-${tier}-${km}`, km <= 1);
    });
  }
}

for (const [id, km] of PARTIAL) {
  test(`${id} at ${km} km on low: loads without errors (the road behind the start is the loop's)`, async ({ page }) => {
    test.setTimeout(300_000);
    await loads(page, id, km, 'low', `kestrel-${id.replace('kestrel-vale-', '')}-low-${km}`);
  });
}
