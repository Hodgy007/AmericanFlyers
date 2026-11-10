import { expect, test } from '@playwright/test';
import { mockNeon } from './mockNeon';

// The music and sound toggles: the ☰ Menu entry, the N and M keys and Settings,
// all kept in step with each other.
test('music and sound switch on and off, from the menu, keys and settings', async ({ page }) => {
  test.setTimeout(240_000);
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
  await expect(page.locator('#hub')).toBeVisible();
  await page.locator('#hub-go').click({ force: true });
  await expect(page.locator('.topbar')).toBeVisible();

  const menu = page.locator('#btn-menu');
  const musicBtn = page.locator('#btn-music');
  const soundBtn = page.locator('#btn-sound');
  /** Opening an entry closes the menu, so reopen it before each click. */
  const choose = async (id: string) => {
    if (!(await page.locator(id).isVisible())) await menu.click({ force: true });
    await page.locator(id).click({ force: true });
  };

  // Music: on by default, off and back on from the ☰ Menu (the click also unlocks the audio).
  await menu.click({ force: true });
  await expect(musicBtn).toHaveText('🎵 Music on');
  await expect(soundBtn).toHaveText('🔊 Sound on');
  await choose('#btn-music');
  await expect(musicBtn).toHaveText('🔇 Music off');
  await choose('#btn-music');
  await expect(musicBtn).toHaveText('🎵 Music on');

  // The N key turns the music off and on, whatever the menu is doing.
  await page.keyboard.press('n');
  await menu.click({ force: true });
  await expect(musicBtn).toHaveText('🔇 Music off');
  await page.keyboard.press('n');
  await expect(musicBtn).toHaveText('🎵 Music on');

  // Settings' Music switch mirrors the ☰ Menu.
  await choose('#btn-settings');
  await expect(page.locator('#settings')).toBeVisible();
  const musicBox = page.locator('#settings input[name="music"]');
  await expect(musicBox).toBeChecked();
  await musicBox.uncheck();
  await page.locator('#settings button[value="save"]').first().click({ force: true });
  await expect(page.locator('#settings')).toBeHidden();
  await menu.click({ force: true });
  await expect(musicBtn).toHaveText('🔇 Music off');

  // Sound off takes the music with it; sound on brings it back as the rider chose it.
  await soundBtn.click({ force: true });
  await expect(soundBtn).toHaveText('🔇 Sound off');
  await choose('#btn-sound');
  await expect(soundBtn).toHaveText('🔊 Sound on');
  await expect(musicBtn).toHaveText('🔇 Music off');

  // The choice is remembered.
  await expect.poll(async () => (await page.evaluate(() => localStorage.getItem('americanflyers.settings')))?.includes('"music":false')).toBe(true);

  expect(errors).toEqual([]);
});