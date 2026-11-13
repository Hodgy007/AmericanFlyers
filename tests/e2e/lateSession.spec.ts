import { expect, test, type Page } from '@playwright/test';
import { mockNeon } from './mockNeon';
import { slowFrames } from './slowFrames';

// The signed-in hint shows the hub at once, but the session itself is only checked after the first frame. On a slow
// device (here: one frame a second) a rider can be riding before it answers. When it does, the ride is theirs: it
// must carry on, not be reset with the demo switched off (which, three seconds later, zeroed the power and stalled it).

const press = (page: Page, selector: string) => page.locator(selector).evaluate((el) => (el as HTMLElement).click());
const hud = (page: Page) => page.evaluate(() => {
  const text = document.getElementById('hud')?.textContent ?? '';
  return { power: Number(/Power\s*(\d+)\s*W/.exec(text)?.[1] ?? NaN), km: Number(/Distance\s*([\d.]+)\s*km/.exec(text)?.[1] ?? NaN) };
});

test('a demo ride started before the session check answers keeps going at 1 fps', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  let sessionAnsweredAt = 0;
  await mockNeon(page, { signedIn: true });
  page.on('requestfinished', (r) => { if (/get-session/.test(r.url()) && !sessionAnsweredAt) sessionAnsweredAt = Date.now(); });
  await page.addInitScript(() => {
    localStorage.setItem('americanflyers.signedIn', '1');
    localStorage.setItem('americanflyers.onboarded', '1');
  });
  await slowFrames(page, 1000);
  await page.goto('/?timescale=20');
  await expect(page.locator('#hub')).toBeVisible();
  await press(page, '#hub-go');
  await expect(page.locator('#hub')).toBeHidden();
  await press(page, '#btn-menu');
  await press(page, '#btn-demo');
  await page.locator('#demo-power').evaluate((el: HTMLInputElement) => { el.value = '250'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  const startedAt = Date.now();

  // The session answers while riding (that is the case under test), then the ride carries on well past the 3 s stale window.
  await expect.poll(() => sessionAnsweredAt, { timeout: 30_000 }).toBeGreaterThan(0);
  expect(sessionAnsweredAt, 'the session check answered before the ride began: this test no longer covers the late case').toBeGreaterThan(startedAt);
  await page.waitForTimeout(1500);
  const before = await hud(page);
  await page.waitForTimeout(6000); // 2 minutes of ride time at 20×
  const after = await hud(page);

  await expect(page.locator('#demo-panel')).toBeVisible();
  expect(after.power).toBe(250);
  expect(after.km).toBeGreaterThan(before.km);
  expect(errors, errors.join('\n')).toEqual([]);
});
