import { expect, test, type Page } from '@playwright/test';
import { mockNeon, sampleRides } from './mockNeon';

// An account is required: the home page (sign in with Google, or email) is the only way in for
// someone who is not signed in. There is no guest hub and no way past the home page.

const press = (page: Page, selector: string) => page.locator(selector).evaluate((el) => (el as HTMLElement).click());
const hint = (page: Page) => page.evaluate(() => localStorage.getItem('americanflyers.signedIn'));

/** Software WebGL is slow: run the render loop at ~1 fps so the test's own work isn't starved. */
async function slowFrames(page: Page) {
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => window.setTimeout(() => raf(cb), 1000) as unknown as number;
  });
}

test('a visitor with no account sees the home page and has no way past it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await mockNeon(page); // no session
  await slowFrames(page);
  await page.goto('/');

  await expect(page.locator('#home')).toBeVisible();
  await expect(page.locator('#hub')).toBeHidden();
  await expect(page.locator('[data-provider=google]')).toBeVisible();
  await expect(page.locator('#home-email-toggle')).toBeVisible();
  // No "ride without an account".
  await expect(page.locator('#home-ride')).toHaveCount(0);
  await expect(page.locator('#home')).not.toContainText(/without an account|guest/i);

  // Escape does not leave it, even after the session check has answered (nothing signed in).
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await expect(page.locator('#home')).toBeVisible();
  await expect(page.locator('#hub')).toBeHidden();

  // The email sign-up form opens in place; it is still the home page.
  await press(page, '#home-email-toggle');
  await expect(page.locator('#home-email input[name=name]')).toBeVisible();
  await expect(page.locator('#hub')).toBeHidden();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('a stale signed-in hint with no session ends on the home page, not the hub', async ({ page }) => {
  await mockNeon(page); // the session is gone
  await slowFrames(page);
  await page.addInitScript(() => {
    localStorage.setItem('americanflyers.signedIn', '1'); // left over from an earlier visit
    localStorage.setItem('americanflyers.onboarded', '1');
  });
  await page.goto('/');

  // The hint makes the app open on the hub for a fast start; the session check then corrects it.
  await expect(page.locator('#home')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('#hub')).toBeHidden();
  expect(await hint(page)).toBeNull();
  await expect(page.locator('html')).not.toHaveAttribute('data-start', 'hub');
  await expect(page.locator('#home-ride')).toHaveCount(0);

  // And it stays: Escape does not open a guest hub.
  await page.keyboard.press('Escape');
  await expect(page.locator('#home')).toBeVisible();
  await expect(page.locator('#hub')).toBeHidden();
});

test('signing out closes the hub and shows the home page', async ({ page }) => {
  await mockNeon(page, { signedIn: true });
  await slowFrames(page);
  await page.addInitScript(() => {
    localStorage.setItem('americanflyers.signedIn', '1');
    localStorage.setItem('americanflyers.onboarded', '1');
  });
  await page.goto('/');
  await expect(page.locator('#hub-name')).toHaveText('Sam', { timeout: 30_000 });
  await expect(page.locator('#home')).toBeHidden();

  await press(page, '#hub-account'); // the profile
  await expect(page.locator('#profile-dialog[open]')).toBeVisible();
  await press(page, '#profile-signout');
  await expect(page.locator('#home')).toBeVisible();
  await expect(page.locator('#hub')).toBeHidden();
  expect(await hint(page)).toBeNull();
});

test('a ride kept by the old guest flow is saved once at sign-in, then deleted', async ({ page }) => {
  const saved: string[] = [];
  await mockNeon(page, { signedIn: true });
  await page.route(/apirest.*\/activities/, async (route) => {
    const req = route.request();
    if (req.method() === 'POST') saved.push(JSON.parse(req.postData() ?? '{}').id);
    return route.fallback();
  });
  await slowFrames(page);
  await page.addInitScript((ride) => {
    localStorage.setItem('americanflyers.signedIn', '1');
    localStorage.setItem('americanflyers.onboarded', '1');
    localStorage.setItem('americanflyers.pendingRide', JSON.stringify(ride));
  }, { ...sampleRides()[0], id: 'old-guest-ride', samples: null });
  await page.goto('/');
  await expect(page.locator('#hub-name')).toHaveText('Sam', { timeout: 30_000 });

  await expect.poll(() => page.evaluate(() => localStorage.getItem('americanflyers.pendingRide')), { timeout: 30_000 }).toBeNull();
  expect(saved).toContain('old-guest-ride');
  expect(saved.filter((id) => id === 'old-guest-ride')).toHaveLength(1);
});

test('a workout made on this device before there were accounts syncs to the account at first sign-in', async ({ page }) => {
  const uploaded: string[] = [];
  await mockNeon(page, { signedIn: true });
  await page.route(/apirest.*\/workouts/, async (route) => {
    const req = route.request();
    if (req.method() === 'POST') uploaded.push(...(JSON.parse(req.postData() ?? '[]') as { id: string }[]).map((w) => w.id));
    return route.fallback();
  });
  await slowFrames(page);
  await page.addInitScript(() => {
    localStorage.setItem('americanflyers.signedIn', '1');
    localStorage.setItem('americanflyers.onboarded', '1');
    localStorage.setItem('americanflyers.workouts', JSON.stringify([
      { id: 'guest-made', name: 'My old workout', description: '', source: 'custom', blocks: [{ kind: 'steady', duration: 600, power: 0.7 }] },
    ]));
  });
  await page.goto('/');
  await expect(page.locator('#hub-name')).toHaveText('Sam', { timeout: 30_000 });
  await expect.poll(() => uploaded, { timeout: 30_000 }).toContain('guest-made');
});
