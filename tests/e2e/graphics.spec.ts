import { expect, test, type Page } from '@playwright/test';
import { mockNeon } from './mockNeon';

// The Graphics setting: in this software-rendered browser Auto picks Low (and turns shadows off),
// the choice is saved on this device (not in the synced settings), and picking a tier applies it.

const press = (page: Page, selector: string) => page.locator(selector).evaluate((el) => (el as HTMLElement).click());
const gfx = (page: Page) => page.evaluate(() => (window as unknown as { __afGraphics?: { tier: string; choice: string; autoTier: string; shadows: boolean } }).__afGraphics);

test('Graphics: Auto picks Low on a software renderer, and the choice is kept on this device', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
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
  await expect(page.locator('#hub')).toBeVisible();

  // Auto on SwiftShader: Low, no shadow map.
  expect(await gfx(page)).toMatchObject({ tier: 'low', choice: 'auto', autoTier: 'low', shadows: false });

  // Settings shows the choice and what Auto picked.
  await press(page, '#btn-settings');
  await expect(page.locator('#settings[open]')).toBeVisible();
  await expect(page.locator('#graphics-choice')).toHaveValue('auto');
  await expect(page.locator('#graphics-note')).toContainText('Auto picked Low');

  // Choose Medium and save: applied at once, remembered on this device only.
  await page.locator('#graphics-choice').selectOption('medium');
  await press(page, '#settings button[value=save]');
  await expect(page.locator('#settings[open]')).toHaveCount(0);
  await expect.poll(async () => (await gfx(page))?.tier).toBe('medium');
  expect(await page.evaluate(() => localStorage.getItem('americanflyers.graphics'))).toBe('medium');
  expect(await page.evaluate(() => localStorage.getItem('americanflyers.settings') ?? '')).not.toContain('graphics');

  // Back to Auto clears it.
  await press(page, '#btn-settings');
  await expect(page.locator('#settings[open]')).toBeVisible();
  await expect(page.locator('#graphics-choice')).toHaveValue('medium');
  await expect(page.locator('#graphics-note')).toContainText('Fixed at Medium');
  await page.locator('#graphics-choice').selectOption('auto');
  await press(page, '#settings button[value=save]');
  await expect.poll(async () => (await gfx(page))?.tier).toBe('low');
  expect(await page.evaluate(() => localStorage.getItem('americanflyers.graphics'))).toBeNull();
  expect(errors, errors.join('\n')).toEqual([]);
});
