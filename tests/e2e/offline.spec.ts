import { expect, test, type Page } from '@playwright/test';
import { mockNeon } from './mockNeon';

// A signed-in rider loses the connection: the ride is kept on the device (src/rideQueue.ts)
// and uploads by itself when the connection comes back.

const press = (page: Page, selector: string) => page.locator(selector).evaluate((el) => (el as HTMLElement).click());
const queued = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('americanflyers.rideQueue') ?? '[]') as { activity: { id: string } }[]);

test('a ride saved while offline is kept on the device and uploads when the connection is back', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockNeon(page, { signedIn: true });

  // Saving rides fails while "offline"; everything else answers as normal.
  let offline = false;
  const uploads: string[] = [];
  await page.route(/apirest.*\/activities/, async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      if (offline) return route.abort('internetdisconnected');
      uploads.push(JSON.parse(req.postData() ?? '{}').id);
    }
    return route.fallback();
  });
  await page.addInitScript(() => {
    localStorage.setItem('americanflyers.signedIn', '1');
    localStorage.setItem('americanflyers.onboarded', '1');
  });

  await page.goto('/?timescale=20');
  await expect(page.locator('#hub')).toBeVisible();
  await expect(page.locator('#hub-name')).not.toHaveText('Guest rider', { timeout: 30_000 }); // the session has settled
  await press(page, '#hub-go');
  await expect(page.locator('#hub')).toBeHidden();
  await press(page, '#btn-demo');
  await page.evaluate(() => { const r = document.getElementById('demo-power') as HTMLInputElement; r.value = '250'; r.dispatchEvent(new Event('input')); });
  // Ride for more than a minute of ride time (the clock runs 20× here).
  await expect.poll(() => page.evaluate(() => document.getElementById('hud')!.textContent ?? ''), { timeout: 90_000 }).toMatch(/Time\s*([1-9]:\d\d|\d{2,}:\d\d)/);

  // The connection drops; going back to the hub saves the ride.
  offline = true;
  await press(page, '#btn-menu-hub');
  await expect(page.locator('#hub-leave')).toBeVisible();
  await press(page, '#hub-leave-go');
  await expect(page.locator('#toast')).toContainText('Saved on this device', { timeout: 30_000 });
  const waiting = await queued(page);
  expect(waiting).toHaveLength(1);

  // Back online: it uploads by itself, once, and the device copy is cleared.
  offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('#toast')).toContainText('Uploaded your ride', { timeout: 30_000 });
  expect(uploads).toEqual([waiting[0].activity.id]);
  expect(await queued(page)).toEqual([]);
  expect(errors).toEqual([]);
});
