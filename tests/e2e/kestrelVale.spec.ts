import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { mockNeon } from './mockNeon';

// Kestrel Vale (src/worlds/kestrelVale.ts): the world's three routes are listed in the hub, and four places on the lap (the
// village, the lakeshore, the climb and the Raven Gap cutting) load on Low and Medium without page or shader errors. Each
// place is saved as test-results/kestrel-<tier>-<km>.png for a human (or an agent) to look at: the village, the water, the
// climb and the cutting should read as coherent places, with no floating road, no water over the road and no road under the ground.

test.use({ viewport: { width: 800, height: 450 }, deviceScaleFactor: 1 });

const IDS = ['kestrel-vale', 'kestrel-vale-loop', 'kestrel-vale-grand'];
/** Start points, km along the first lap: the village's high street, the lakeshore, the climb's third hairpin and the cutting. */
const SPOTS = [0.3, 2.5, 8, 10.4];

async function signedIn(page: import('@playwright/test').Page) {
  await mockNeon(page, { signedIn: true });
  await page.addInitScript(() => {
    localStorage.setItem('americanflyers.signedIn', '1');
    localStorage.setItem('americanflyers.onboarded', '1');
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => window.setTimeout(() => raf(cb), 1000) as unknown as number;
  });
}

test('the hub lists the three Kestrel Vale routes', async ({ page }) => {
  await signedIn(page);
  await page.goto('/?adapt=off&graphics=low');
  await expect(page.locator('#hub')).toBeVisible();
  await page.locator('#hub-tab-route').evaluate((el) => (el as HTMLElement).click());
  for (const id of IDS) await expect(page.locator(`#hub-s-route [data-fkey="stage-${id}"]`)).toHaveCount(1);
  await expect(page.locator('#hub-s-route [data-fkey="stage-kestrel-vale-loop"]')).toHaveText('Kestrel Vale · Vale Loop');
});

for (const tier of ['low', 'medium']) {
  for (const km of SPOTS) {
    test(`Kestrel Vale at ${km} km on ${tier}: loads without errors`, async ({ page }) => {
      test.setTimeout(300_000);
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
      await page.goto(`/?stage=kestrel-vale-loop&start=${km}&graphics=${tier}&adapt=off`);
      await expect(page.locator('#hub')).toBeVisible();
      await page.locator('#hub-go').evaluate((el) => (el as HTMLElement).click());
      await expect(page.locator('#hub')).toBeHidden();
      // The lazy chunks (the splatted ground, and by the village the code-built terraces and church) arrive after the first frame.
      await expect.poll(() => fetched.some((f) => /^ground-/.test(f)) && (km > 3 || fetched.some((f) => /^monuments-/.test(f))), { timeout: 120_000 }).toBe(true);
      await page.waitForTimeout(Number(process.env.KESTREL_SETTLE_MS ?? 25_000)); // terrain tiles build a few a frame, at one frame a second here
      mkdirSync('test-results', { recursive: true });
      await page.screenshot({ path: `test-results/kestrel-${tier}-${km}.png` });
      expect(errors, errors.join('\n')).toEqual([]);
    });
  }
}
