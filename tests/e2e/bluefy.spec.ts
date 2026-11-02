import { expect, test, type Page } from '@playwright/test';
import { mockNeon } from './mockNeon';

// iPhone and iPad can't use Web Bluetooth outside the Bluefy browser, so signed-in riders there get a
// card in the hub with a link to Bluefy on the App Store. Nobody else does.

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const APP_STORE = 'https://apps.apple.com/app/bluefy-web-ble-browser/id1492822055';

const SHOT = process.env.BLUEFY_SHOT; // a file path: save a screenshot of the card

async function setup(page: Page, o: { signedIn: boolean; bluetooth: boolean }) {
  await mockNeon(page, { signedIn: o.signedIn });
  await page.addInitScript((opts) => {
    localStorage.setItem('americanflyers.onboarded', '1');
    if (opts.signedIn) localStorage.setItem('americanflyers.signedIn', '1');
    // Software WebGL: run the render loop at ~1 fps so the test's own work isn't starved.
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => window.setTimeout(() => raf(cb), 1000) as unknown as number;
    // Headless Chromium has navigator.bluetooth: take it away (Safari on iPhone) or give a stand-in (Bluefy).
    delete (Navigator.prototype as any).bluetooth;
    delete (navigator as any).bluetooth;
    if (opts.bluetooth) Object.defineProperty(navigator, 'bluetooth', { value: { requestDevice: async () => { throw new DOMException('cancelled', 'NotFoundError'); } }, configurable: true });
  }, o);
  await page.goto('/');
}

test.describe('iPhone', () => {
  test.use({ userAgent: IPHONE_UA, viewport: { width: 390, height: 844 } });

  test('a signed-in rider without Web Bluetooth sees the Bluefy card in the hub', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await setup(page, { signedIn: true, bluetooth: false });
    await expect(page.locator('#hub')).toBeVisible();

    const card = page.locator('#hub #hub-bluefy');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Connect your trainer on iPhone');
    const link = card.getByRole('link', { name: 'Get Bluefy on the App Store' });
    await expect(link).toHaveAttribute('href', APP_STORE);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noopener/);
    await expect(card.locator('img')).toHaveAttribute('src', '/images/bluefy-icon.png');
    expect(await card.locator('img').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBe(128);

    // No horizontal scroll at phone width.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    if (SHOT) {
      await card.scrollIntoViewIfNeeded();
      await page.screenshot({ path: SHOT });
    }
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('"Copy link" confirms', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
    await setup(page, { signedIn: true, bluetooth: false });
    const copy = page.locator('#hub-bluefy .bluefy-copy');
    await copy.evaluate((el) => (el as HTMLElement).click());
    await expect(copy).toHaveText(/Copied ✓|Copy failed/);
    await expect(copy).toHaveText('Copy link', { timeout: 5000 });
  });

  test('a signed-out visitor does not see it', async ({ page }) => {
    await setup(page, { signedIn: false, bluetooth: false });
    await expect(page.locator('#home')).toBeVisible();
    await expect(page.locator('#hub-bluefy')).toBeHidden();
    await expect(page.getByText('Get Bluefy on the App Store')).toBeHidden();
  });

  test('inside Bluefy (Web Bluetooth present) there is no card', async ({ page }) => {
    await setup(page, { signedIn: true, bluetooth: true });
    await expect(page.locator('#hub')).toBeVisible();
    await expect(page.locator('#hub-bluefy')).toBeHidden();
  });
});

test.describe('desktop', () => {
  test.use({ userAgent: DESKTOP_UA, viewport: { width: 960, height: 600 } });

  test('desktop Chrome without Web Bluetooth gets no card', async ({ page }) => {
    await setup(page, { signedIn: true, bluetooth: false });
    await expect(page.locator('#hub')).toBeVisible();
    await expect(page.locator('#hub-bluefy')).toBeHidden();
  });
});
