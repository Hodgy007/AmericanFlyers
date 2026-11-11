import { expect, test, type Page } from '@playwright/test';
import { mockNeon } from './mockNeon';

// KOM segments: approaching a big climb shows the panel with the leaderboard, riding it shows the live gap to a
// stored previous attempt (best and last), the top gives a result toast, and the Settings switch hides the panel.
// A demo ride on a sped-up clock stands in for a real ride: `?komtest` lets it count for the times kept on this device
// (it is never sent to the account), and the Data API is mocked like in the other specs.

const press = (page: Page, selector: string) => page.locator(selector).evaluate((el) => (el as HTMLElement).click());

/** An effort at a steady speed over a segment `length` metres long: splits every 50 m, in tenths of a second. */
const steady = (length: number, seconds: number, at: number) => {
  const s: number[] = [];
  for (let m = 50; m < length; m += 50) s.push(Math.round(((m / length) * seconds) * 10));
  return { t: seconds, p: 280, s, at };
};

async function setup(page: Page, o: { stored?: Record<string, { best?: unknown; last?: unknown }>; settings?: Record<string, unknown> } = {}) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await mockNeon(page, { signedIn: true });
  await page.addInitScript((seed) => {
    localStorage.setItem('americanflyers.signedIn', '1');
    localStorage.setItem('americanflyers.onboarded', '1');
    if (seed.stored) localStorage.setItem('americanflyers.segments', JSON.stringify(seed.stored));
    if (seed.settings) localStorage.setItem('americanflyers.settings', JSON.stringify(seed.settings));
  }, { stored: o.stored, settings: o.settings });
  return errors;
}

async function startDemo(page: Page, watts: number) {
  await expect(page.locator('#hub')).toBeVisible();
  await press(page, '#hub-go');
  await expect(page.locator('#hub')).toBeHidden();
  await press(page, '#btn-menu');
  await press(page, '#btn-demo');
  await page.locator('#demo-power').evaluate((el: HTMLInputElement, w) => { el.value = String(w); el.dispatchEvent(new Event('input', { bubbles: true })); }, watts);
}

test('approaching Alpe d’Huez shows the KOM panel with the board, then the live gap to your best and last attempt', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 960, height: 720 }); // tall enough for the whole top 5 (a short window shows 3)
  const errors = await setup(page, { stored: { 'alpe-dhuez:main': { best: steady(13975, 3600, 1), last: steady(13975, 2900, 2) } } });
  await page.goto('/?stage=alpe-dhuez&timescale=20&komtest');
  await startDemo(page, 450);

  const card = page.locator('#kom-card');
  await expect(card).toBeVisible();
  await expect(page.locator('#kom-title')).toHaveText('Alpe d\'Huez');
  // The card shrinks to a chip after a few seconds: open it the way a rider does (the click or tap on the card) to read the board.
  await expect(async () => { // it may close by itself between the check and the click: look again
    if ((await page.locator('#kom-toggle').getAttribute('aria-expanded')) !== 'true') await page.locator('#kom-toggle').click();
    await expect(page.locator('#kom-toggle')).toHaveAttribute('aria-expanded', 'true', { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  // The top 5 from the (mocked) shared board, the leader crowned, and your own rank below.
  await expect(page.locator('#kom-board li:visible')).toHaveCount(5);
  await expect(page.locator('#kom-board li').first()).toContainText('👑');
  await expect(page.locator('#kom-board li').first()).toContainText('Alex M.');
  await expect(page.locator('#kom-board li').first()).toContainText('50:12');
  await expect(page.locator('#kom-me')).toHaveText('You: #7 · 54:50');

  // On the segment: the gap against your best (an hour) and your last attempt (48 minutes).
  await expect(card).toHaveAttribute('data-state', 'on', { timeout: 60_000 });
  const gap = page.locator('#kom-gap');
  await expect(gap).toBeVisible();
  await expect(page.locator('#kom-gap-main')).toHaveText(/^[−+±]\d+:\d\d$/);
  await expect(page.locator('#kom-gap-text')).toHaveText('vs your best 1:00:00');
  await expect(gap).toHaveAttribute('data-state', 'ahead'); // 450 W on the opening ramps beats an hour
  await expect(page.locator('#kom-gap-last')).toContainText('vs your last');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('on a first attempt it says so and shows the elapsed time; the Settings switch hides the whole panel', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await setup(page);
  await page.goto('/?stage=alpe-dhuez&timescale=20&komtest');
  await startDemo(page, 450);
  await expect(page.locator('#kom-card')).toHaveAttribute('data-state', 'on', { timeout: 60_000 });
  await expect(page.locator('#kom-gap-text')).toHaveText('First attempt: set your time');
  await expect(page.locator('#kom-me')).toHaveText('You: #7 · 54:50'); // the board still knows you from another device

  await press(page, '#btn-settings');
  await page.locator('#settings input[name=komPanel]').uncheck();
  await press(page, '#settings button[value=save]');
  await expect(page.locator('#kom-card')).toBeHidden();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('the top of Morgul-Bismark’s wall gives a result toast with your rank, and the effort is kept for next time', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await setup(page, { stored: { 'hotw-morgul-bismark:the-wall': { best: steady(956, 400, 1), last: steady(956, 400, 1) } } });
  await page.goto('/?stage=hotw-morgul-bismark&start=19.7&timescale=20&komtest');
  await startDemo(page, 600);
  await expect(page.locator('#kom-title')).toContainText('The Wall');
  await expect(page.locator('#toast')).toContainText('The Wall (lap 1) —', { timeout: 150_000 });
  await expect(page.locator('#toast')).toContainText('New PB by'); // 600 W up the wall beats the stored 6:40
  await expect(page.locator('#toast')).toContainText('#7 of 27');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('americanflyers.segments') ?? '{}')['hotw-morgul-bismark:the-wall']);
  expect(stored.best.t).toBeLessThan(400);
  expect(stored.best.s.length).toBe(19); // a split every 50 m up 956 m
  expect(stored.last.t).toBe(stored.best.t);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('without ?komtest a demo ride is timed but never kept: the toast says so and nothing is stored', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await setup(page);
  await page.goto('/?stage=hotw-morgul-bismark&start=19.7&timescale=20');
  await startDemo(page, 600);
  await expect(page.locator('#toast')).toContainText('Demo ride, not saved', { timeout: 150_000 });
  expect(await page.evaluate(() => localStorage.getItem('americanflyers.segments'))).toBeNull();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('the hub’s KOM chip opens a stage’s segments, with the king and your best, and each one’s full board', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await setup(page, { stored: { 'hotw-tour-of-the-moon:the-high-point': { best: steady(750, 100, 1) } } });
  await page.goto('/');
  await expect(page.locator('#hub')).toBeVisible();
  await expect(page.locator('.hub-chip.gold').first()).toBeVisible(); // your rides have loaded: the route cards are drawn for good
  // A stage with several segments opens a list: the king of each climb and your best.
  await press(page, '[data-fkey="kom-hotw-tour-of-the-moon"]');
  const dialog = page.locator('#segment-board');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#sb-title')).toHaveText('Hell of the West · Stage 2: Tour of the Moon');
  await expect(page.locator('.sb-item')).toHaveCount(2);
  await expect(page.locator('.sb-item').nth(1)).toContainText('The high point');
  await expect(page.locator('.sb-item').nth(1)).toContainText('👑 Alex M. 50:12');
  await expect(page.locator('.sb-item').nth(1)).toContainText('You: #7 of 27 · 54:50');
  // Tapping one opens its board: top 5 and you, this month or all time, and a way back.
  await page.locator('.sb-item').nth(1).click();
  await expect(page.locator('#sb-title')).toHaveText('The high point');
  await expect(page.locator('#sb-body .lb-table tbody tr')).toHaveCount(6);
  await expect(page.locator('#sb-body .lb-table tbody tr.me')).toContainText('Sam R. (you)');
  await expect(page.locator('#sb-body')).toContainText('Your best on this device: 1:40');
  await page.locator('#sb-tabs [data-sb-range=month]').click();
  await expect(page.locator('#sb-tabs [data-sb-range=month]')).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: '← All segments on this stage' }).click();
  await expect(page.locator('.sb-item')).toHaveCount(2);
  await press(page, '#segment-board button[value=cancel]');
  await expect(dialog).toBeHidden();
  // A stage with a single segment goes straight to its board; flat stages have no chip.
  await press(page, '[data-fkey="kom-alpe-dhuez"]');
  await expect(page.locator('#sb-title')).toHaveText('Alpe d\'Huez');
  await expect(page.locator('#sb-body .lb-table tbody tr')).toHaveCount(6);
  await press(page, '#segment-board button[value=cancel]');
  await expect(page.locator('[data-fkey="kom-route66"]')).toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);
});
