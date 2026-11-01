import { expect, test } from '@playwright/test';
import { mockNeon } from './mockNeon';
test('the garage opens again after it has been closed (fresh preview canvas each time)', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1366, height: 768 });
  const logs: string[] = [];
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') logs.push('error: ' + m.text()); });
  await mockNeon(page, { signedIn: true });
  await page.addInitScript(() => { localStorage.setItem('americanflyers.signedIn', '1'); localStorage.setItem('americanflyers.onboarded', '1'); });
  await page.goto('/');
  await expect(page.locator('#hub-name')).not.toHaveText('Guest rider', { timeout: 30_000 });
  await page.locator('#hub-tab-garage').click();
  const isOpen = () => page.evaluate(() => (document.getElementById('garage-dialog') as HTMLDialogElement).open);
  for (let i = 1; i <= 3; i++) {
    await page.locator('[data-fkey="open-garage"]').click();
    await page.waitForTimeout(2500);
    expect(await isOpen(), `open #${i}`).toBe(true);
    await page.evaluate(() => (document.getElementById('garage-dialog') as HTMLDialogElement).close());
    await page.waitForTimeout(800);
  }
  expect(logs).toEqual([]);
});
