import { expect, test } from '@playwright/test';
import { mockNeon } from './mockNeon';
test.use({ viewport: { width: 960, height: 540 } });

// SHOTS="stage:startKm:name,..."  SHOT_DIR=...
const shots = (process.env.SHOTS ?? '').split(',').filter(Boolean).map((s) => s.split(':'));
const dir = process.env.SHOT_DIR ?? '/tmp';
for (const [stage, start, name] of shots) {
  test(`shot ${name}`, async ({ page }) => {
    test.setTimeout(200_000);
    await mockNeon(page, { signedIn: true });
    await page.addInitScript(() => { localStorage.setItem('americanflyers.signedIn', '1'); localStorage.setItem('americanflyers.onboarded', '1'); });
    await page.goto(`/?stage=${stage}&start=${start}&graphics=high&adapt=off`);
    await expect(page.locator('#hub')).toBeVisible();
    await page.locator('#hub-go').evaluate((el) => (el as HTMLElement).click());
    await expect(page.locator('#hub')).toBeHidden();
    await page.waitForTimeout(Number(process.env.WAIT ?? 40_000));
    await page.screenshot({ path: `${dir}/${name}.png` });
  });
}
