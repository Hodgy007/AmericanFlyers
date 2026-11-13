import { expect, test } from '@playwright/test';
import { mockNeon } from './mockNeon';
import { slowFrames } from './slowFrames';
test('the garage opens again after it has been closed (fresh preview canvas each time)', async ({ page }) => {
  test.setTimeout(120_000);
  // The default small viewport: nothing here depends on the window's size, and at 1366x768 every software-rendered frame (hub scene plus the garage turntable) is several times dearer.
  const logs: string[] = [];
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') logs.push('error: ' + m.text()); });
  await mockNeon(page, { signedIn: true });
  await slowFrames(page, 250); // each opening still builds a real preview and its WebGL context; it just draws fewer frames in software
  await page.addInitScript(() => { localStorage.setItem('americanflyers.signedIn', '1'); localStorage.setItem('americanflyers.onboarded', '1'); });
  await page.goto('/');
  await expect(page.locator('#hub-name')).not.toHaveText('Guest rider', { timeout: 30_000 });
  await page.locator('#hub-tab-garage').click();
  const isOpen = () => page.evaluate(() => (document.getElementById('garage-dialog') as HTMLDialogElement).open);
  for (let i = 1; i <= 3; i++) {
    await page.locator('[data-fkey="open-garage"]').click();
    // Give the fresh preview canvas a few frames to render, then it must still be open.
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => r())))));
    expect(await isOpen(), `open #${i}`).toBe(true);
    await page.evaluate(() => (document.getElementById('garage-dialog') as HTMLDialogElement).close());
    await expect.poll(isOpen, `close #${i}`).toBe(false);
  }
  expect(logs).toEqual([]);
});
