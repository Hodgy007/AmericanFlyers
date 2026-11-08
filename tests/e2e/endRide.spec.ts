import { expect, test, type Page } from '@playwright/test';
import { mockNeon } from './mockNeon';

// The ⏹ End button on the ride screen, and ☰ Menu → ⏹ End ride.

const press = (page: Page, selector: string) => page.locator(selector).evaluate((el) => (el as HTMLElement).click());

/** Signed in, into a demo ride at 250 W. `timescale` runs the clock faster so a minute passes quickly. */
async function ride(page: Page, timescale = 1) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await mockNeon(page, { signedIn: true });
  await page.addInitScript(() => {
    localStorage.setItem('americanflyers.signedIn', '1');
    localStorage.setItem('americanflyers.onboarded', '1');
  });
  await page.goto(timescale > 1 ? `/?timescale=${timescale}` : '/');
  await expect(page.locator('#hub')).toBeVisible();
  await press(page, '#hub-go');
  await expect(page.locator('#hub')).toBeHidden();
  await press(page, '#btn-menu');
  await press(page, '#btn-demo');
  await page.locator('#demo-power').evaluate((el: HTMLInputElement) => { el.value = '250'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  return errors;
}


test('under a minute, ⏹ End goes straight to the hub', async ({ page }) => {
  const errors = await ride(page);
  await expect(page.locator('#btn-end')).toBeVisible();
  await press(page, '#btn-end');
  await expect(page.locator('#hub')).toBeVisible();
  await expect(page.locator('#hub-leave[open]')).toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('after a minute, ⏹ End asks; Keep riding keeps riding; Save and finish shows the summary', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await ride(page, 20);
  // Wait for the ride time to reach a minute: the question itself tells us (End on a short ride would go to the hub, so poll the data block).
  await expect.poll(async () => page.evaluate(() => {
    const m = /(\d+):(\d\d)(?::(\d\d))?/.exec(document.getElementById('hud')?.textContent ?? '');
    if (!m) return 0;
    return m[3] !== undefined ? 3600 * +m[1] + 60 * +m[2] + +m[3] : 60 * +m[1] + +m[2];
  }), { timeout: 90_000 }).toBeGreaterThanOrEqual(61);
  await press(page, '#btn-end');
  const dialog = page.locator('#hub-leave');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('h2')).toHaveText('End ride?');
  await expect(dialog).toContainText('You’ve ridden');
  await expect(page.locator('#hub-leave-go')).toHaveText('Save and finish');
  await press(page, '#hub-leave-keep');
  await expect(dialog).toBeHidden();
  await expect(page.locator('#hub')).toBeHidden();
  await expect(page.locator('#finish')).toBeHidden();

  // The menu item does the same, and finishing shows the summary with the ways on.
  await press(page, '#btn-menu');
  await press(page, '#btn-reset');
  await expect(dialog).toBeVisible();
  await press(page, '#hub-leave-go');
  await expect(page.locator('#finish')).toBeVisible();
  await expect(page.locator('#finish-title')).toHaveText('Ride summary');
  await expect(page.locator('#finish-actions')).toContainText('Start a new ride');
  await expect(page.locator('#finish-actions')).toContainText('Back to the hub');
  expect(errors, errors.join('\n')).toEqual([]);
});

for (const [name, width, height] of [['phone', 390, 844], ['iPad landscape', 1024, 768]] as const) {
  test(`${name}: ⏹ End is on screen and the menu's last item can be scrolled to`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await ride(page);
    const end = page.locator('#btn-end');
    await expect(end).toBeVisible();
    const box = (await end.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await press(page, '#btn-menu');
    await expect(page.locator('#menu')).toBeVisible();
    // The menu fits the screen (and scrolls inside it) rather than running off the bottom.
    const m = await page.locator('#menu').evaluate((el) => ({ bottom: el.getBoundingClientRect().bottom, vh: innerHeight, overflowY: getComputedStyle(el).overflowY }));
    expect(m.bottom).toBeLessThanOrEqual(m.vh);
    expect(m.overflowY).toBe('auto');
    const last = page.locator('#menu button:visible').last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    // The two exits are at the top of the menu, before Demo ride.
    const ids = await page.locator('#menu button').evaluateAll((els) => els.map((e) => e.id));
    expect(ids.indexOf('btn-reset')).toBeLessThan(ids.indexOf('btn-demo'));
    expect(ids.indexOf('btn-menu-hub')).toBeLessThan(ids.indexOf('btn-demo'));
  });
}
