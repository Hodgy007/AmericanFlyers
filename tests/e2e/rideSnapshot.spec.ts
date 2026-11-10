import { expect, test, type Page } from '@playwright/test';
import { mockNeon } from './mockNeon';

// A ride interrupted by a crash or a closed tab is offered back at the next visit (src/rideSnapshot.ts).

const KEY = 'americanflyers.rideSnapshot';
const press = (page: Page, selector: string) => page.locator(selector).evaluate((el) => (el as HTMLElement).click());

function snapshot(over: { takenAt?: number; seconds?: number } = {}) {
  const n = over.seconds ?? 120;
  const col = (v: number) => Array(n).fill(v);
  return {
    v: 1, takenAt: over.takenAt ?? Date.now() - 5 * 60_000, accountId: 'u-test', stageId: 'route66', stageName: 'Route 66 Flats',
    ride: { distance: 900, startDistance: 0, movingTime: n, climbed: 12, work: 200 * n, proM: 0, planCounted: false },
    flags: { usedDemo: false, timeScale: 1, splitByWorkout: false },
    span: {
      id: 'interrupted-ride-1', startedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      samples: { power: col(200), cadence: col(90), hr: col(0), speed: col(75), distance: Array.from({ length: n }, (_, i) => Math.round(i * 7.5)), elevation: col(3000) },
      dist0: 0, climb0: 0, proM0: 0, workout: null, workoutCompleted: null, distanceM: 900, climbedM: 12,
    },
  };
}

async function open(page: Page, snap: unknown) {
  const saved: Record<string, unknown>[] = [];
  await mockNeon(page, { signedIn: true });
  await page.route(/apirest.*\/activities/, async (route) => {
    const req = route.request();
    if (req.method() === 'POST') { const b = JSON.parse(req.postData() ?? '{}'); saved.push(...(Array.isArray(b) ? b : [b])); }
    return route.fallback();
  });
  await page.addInitScript(([key, value]) => {
    localStorage.setItem('americanflyers.signedIn', '1');
    localStorage.setItem('americanflyers.onboarded', '1');
    if (value) localStorage.setItem(key, value);
  }, [KEY, snap ? JSON.stringify(snap) : ''] as const);
  await page.goto('/');
  return saved;
}

test('Resume picks the ride up on its stage, with the same activity id', async ({ page }) => {
  await open(page, snapshot());
  const dialog = page.locator('#hub-resume');
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog.locator('h2')).toHaveText('Pick up your ride on Route 66 Flats?');
  await expect(page.locator('#hub-resume-text')).toContainText('2:00 · 0.9 km, interrupted 5 min ago');
  await press(page, '#hub-resume-go');
  await expect(dialog).toBeHidden();
  await expect(page.locator('#hub')).toBeHidden();
  await expect(page.locator('#stage-name')).toContainText('Route 66 Flats');
  await expect(page.locator('#toast')).toContainText('picked up');
  // The ride goes on from where it stopped: the clock shows the two minutes already ridden.
  await expect.poll(() => page.evaluate(() => /Time(\d+:\d\d)/.exec(document.getElementById('hud')?.textContent ?? '')?.[1] ?? '')).toMatch(/^[2-9]:\d\d$/);
  await expect(page.locator('#hud')).toContainText('0.9');
});

test('Save it and start fresh saves the activity as it was, and clears the copy', async ({ page }) => {
  const saved = await open(page, snapshot());
  await expect(page.locator('#hub-resume')).toBeVisible({ timeout: 30_000 });
  await press(page, '#hub-resume-save');
  await expect.poll(() => saved.length, { timeout: 15_000 }).toBe(1);
  expect(saved[0]).toMatchObject({ id: 'interrupted-ride-1', stage_id: 'route66', duration_s: 120, distance_m: 900, finished: false });
  await expect(page.locator('#hub')).toBeVisible();
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();
});

test('Discard drops the copy and saves nothing', async ({ page }) => {
  const saved = await open(page, snapshot());
  await expect(page.locator('#hub-resume')).toBeVisible({ timeout: 30_000 });
  await press(page, '#hub-resume-discard');
  await expect(page.locator('#hub-resume')).toBeHidden();
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();
  expect(saved).toHaveLength(0);
});

test('an old copy is saved quietly and a short one dropped, with no question', async ({ page }) => {
  const saved = await open(page, snapshot({ takenAt: Date.now() - 5 * 3600_000 }));
  await expect.poll(() => saved.length, { timeout: 30_000 }).toBe(1);
  await expect(page.locator('#hub-resume')).toBeHidden();
  expect(saved[0]).toMatchObject({ id: 'interrupted-ride-1' });
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();
});

test('a copy under a minute is dropped without a question', async ({ page }) => {
  const saved = await open(page, snapshot({ seconds: 30 }));
  await expect(page.locator('#hub-name')).toHaveText('Sam', { timeout: 30_000 });
  await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();
  await expect(page.locator('#hub-resume')).toBeHidden();
  expect(saved).toHaveLength(0);
});
