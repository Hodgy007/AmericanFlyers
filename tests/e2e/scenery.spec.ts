import { expect, test } from '@playwright/test';
import { mockNeon } from './mockNeon';

// Round 6: the climbs' roadside extras (painted words, guardrails, crowds) and the terrain textures
// load lazily after the first frame without errors, on Low (three layers) and Medium (seven, with the road's asphalt normal map).

for (const tier of ['low', 'medium']) {
  test(`Alpe d'Huez summit on ${tier}: textures and roadside extras load without errors`, async ({ page }) => {
    test.setTimeout(240_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      const t = m.text();
      if (m.type() === 'error' && !/Failed to load resource|net::ERR|ERR_|CORS/i.test(t)) errors.push(`console.error: ${t}`);
      if (/Shader Error|WebGLProgram/.test(t)) errors.push(`shader: ${t.slice(0, 300)}`);
    });
    const fetched: string[] = [];
    page.on('response', (r) => { if (/textures\/|\/ground-|\/roadExtras-/.test(r.url()) && r.ok()) fetched.push(r.url().split('/').slice(-2).join('/')); });
    await mockNeon(page, { signedIn: true });
    await page.addInitScript(() => {
      localStorage.setItem('americanflyers.signedIn', '1');
      localStorage.setItem('americanflyers.onboarded', '1');
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => window.setTimeout(() => raf(cb), 1000) as unknown as number;
    });
    await page.goto(`/?stage=alpe-dhuez&start=13.55&graphics=${tier}&adapt=off`);
    await expect(page.locator('#hub')).toBeVisible();
    await page.locator('#hub-go').evaluate((el) => (el as HTMLElement).click());
    await expect(page.locator('#hub')).toBeHidden();
    // The lazy chunks and the first terrain layers arrive after the first frame.
    await expect.poll(() => fetched.some((f) => /^assets\/ground-/.test(f)) && fetched.some((f) => /^assets\/roadExtras-/.test(f)), { timeout: 90_000 }).toBe(true);
    // The Alpe shows grass, rock and snow; Low fetches just those three, Medium adds dry grass and dirt (never the desert's sandstone).
    const want = tier === 'low' ? 3 : 5;
    const layers = () => fetched.filter((f) => /^terrain\/[a-z]+\.jpg$/.test(f)).map((f) => f.slice(8, -4));
    await expect.poll(() => layers().length, { timeout: 150_000 }).toBeGreaterThanOrEqual(want);
    expect(new Set(layers())).toEqual(new Set(tier === 'low' ? ['grass', 'rock', 'snow'] : ['grass', 'dry', 'dirt', 'rock', 'snow']));
    expect(errors, errors.join('\n')).toEqual([]);
  });
}
