import { expect, type Page } from '@playwright/test';
import { mockNeon } from './mockNeon';

// Setup the browser tests share. Everything here works on the page it is given and keeps nothing between calls, so tests can run in
// parallel. A test with its own twist (a different init script, an extra route, steps in another order) keeps writing its own.

/**
 * Clicks with the DOM, not the mouse. The 3D scene renders in software in CI and
 * on small machines, so frames are slow and Playwright's real-click checks (which
 * wait for animation frames to settle) can take many seconds each.
 */
export const press = (page: Page, selector: string) => page.locator(selector).evaluate((el) => (el as HTMLElement).click());

/** Starts collecting uncaught page errors; the returned array fills as they happen (`expect(errors, errors.join('\n')).toEqual([])`). */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

/**
 * Page errors plus `console.error` messages. Blocked or failed network requests (fonts, analytics, Sentry) are not app errors;
 * `ignoreHttpStatus` also drops the console's "status of 4xx/5xx" lines (for tests that answer with an error on purpose).
 */
export function collectErrors(page: Page, o: { ignoreHttpStatus?: boolean } = {}): string[] {
  const errors = collectPageErrors(page);
  const ignored = o.ignoreHttpStatus
    ? /Failed to load resource|net::ERR|ERR_BLOCKED|ERR_NAME|ERR_INTERNET|ERR_CONNECTION|ERR_TUNNEL|CORS|status of (4|5)\d\d/i
    : /Failed to load resource|net::ERR|ERR_BLOCKED|ERR_NAME|ERR_INTERNET|ERR_CONNECTION|ERR_TUNNEL|CORS/i;
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (ignored.test(m.text())) return;
    errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

/**
 * A signed-in rider (an account is required to ride): Neon answers as a rider with rides, a plan and a wallet (mockNeon.ts), and
 * localStorage carries the signed-in hint (the hub shows before the session is confirmed) and skips the first-ride guide.
 * `neon` is passed on to mockNeon; `localStorage` adds more keys (values are strings, JSON already encoded). Call before `page.goto`.
 */
export async function signedInRider(page: Page, o: { neon?: Parameters<typeof mockNeon>[1]; localStorage?: Record<string, string> } = {}) {
  await mockNeon(page, { signedIn: true, ...o.neon });
  await page.addInitScript((extra) => {
    localStorage.setItem('americanflyers.signedIn', '1');
    localStorage.setItem('americanflyers.onboarded', '1');
    for (const [key, value] of Object.entries(extra)) localStorage.setItem(key, value);
  }, o.localStorage ?? {});
}

/** From the hub: press Ride, open ☰ Menu, start the demo rider and set its power to `watts`. */
export async function startDemo(page: Page, watts: number) {
  await expect(page.locator('#hub')).toBeVisible();
  await press(page, '#hub-go');
  await expect(page.locator('#hub')).toBeHidden();
  await press(page, '#btn-menu');
  await press(page, '#btn-demo');
  await page.locator('#demo-power').evaluate((el: HTMLInputElement, w) => { el.value = String(w); el.dispatchEvent(new Event('input', { bubbles: true })); }, watts);
}
