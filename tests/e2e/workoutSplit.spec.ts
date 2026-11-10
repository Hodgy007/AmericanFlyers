import { expect, test, type Page } from '@playwright/test';
import { mockNeon } from './mockNeon';

// A workout is a clean boundary: the ride so far, the workout and the ride after are saved as separate activities that never overlap.
const press = (page: Page, selector: string) => page.locator(selector).evaluate((el) => (el as HTMLElement).click());
const hudSeconds = (page: Page) => page.evaluate(() => {
  const m = /(\d+):(\d\d)(?::(\d\d))?/.exec(document.getElementById('hud')?.textContent ?? '');
  if (!m) return 0;
  return m[3] !== undefined ? 3600 * +m[1] + 60 * +m[2] + +m[3] : 60 * +m[1] + +m[2];
});

test('ride, workout, stop: separate non-overlapping activities', async ({ page }) => {
  test.setTimeout(240_000);
  // ?timescale=20 so a minute of riding takes a few seconds; the clock follows real time, not frames.
  const posts: Record<string, any>[] = [];
  await mockNeon(page, { signedIn: true });
  await page.route(/apirest.*\/activities/, async (route) => {
    const req = route.request();
    if (req.method() === 'POST') { const b = JSON.parse(req.postData() ?? '{}'); posts.push(...(Array.isArray(b) ? b : [b])); }
    return route.fallback();
  });
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(() => {
    localStorage.setItem('americanflyers.signedIn', '1');
    localStorage.setItem('americanflyers.onboarded', '1');
  });
  await page.goto('/?timescale=20');
  await expect(page.locator('#hub')).toBeVisible();
  await press(page, '#hub-go');
  await press(page, '#btn-menu');
  await press(page, '#btn-demo');
  await page.locator('#demo-power').evaluate((el: HTMLInputElement) => { el.value = '250'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect.poll(() => hudSeconds(page), { timeout: 90_000 }).toBeGreaterThanOrEqual(90);

  // Start a workout from the library.
  await press(page, '#btn-workouts');
  await press(page, '#workouts [data-act=ride] >> nth=0');
  await expect(page.locator('#workout-panel')).toBeVisible();
  await expect.poll(() => posts.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  const ride = posts[0];

  // Ride the workout for a while, then stop it.
  await page.waitForTimeout(8000); // ~160 s of workout at 20x
  await press(page, '#wp-stop');
  await expect.poll(() => posts.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  const w = posts[1];
  expect(w.id).not.toBe(ride.id);
  expect(w.title).toMatch(/ · /);
  expect(w.workout_name).toBeNull();
  expect(w.samples.distance[0]).toBeLessThan(400);
  expect(Math.abs((w.samples.distance.at(-1) as number) - w.distance_m)).toBeLessThan(400);
  expect(ride.finish_s ?? null).toBeNull();

  // Then ride on, end the ride: a third activity, not overlapping.
  await page.waitForTimeout(6000);
  await press(page, '#btn-end');
  await press(page, '#hub-leave-go');
  await expect.poll(() => posts.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(3);
  const after = posts[2];
  expect(new Set([ride.id, w.id, after.id]).size).toBe(3);
  await expect(page.locator('#finish-title')).toHaveText('Ride summary');
});
