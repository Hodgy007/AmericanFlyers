import { expect, test } from '@playwright/test';
import { eventClockAt } from './eventClock';
import { collectPageErrors, press, signedInRider } from './helpers';
import { sampleEvent } from './mockNeon';
import { slowFrames } from './slowFrames';

// A scheduled evening race joined from the hub and ridden to the line (src/raceSession.ts, eventsUi.ts, main.ts's eventFinishPanel):
// the lobby strip, the race itself on the shared event clock, then the finish card with your place, the results and the event's
// own table. A demo rider on a sped-up clock stands in for the rider, so the result is not eligible to be posted, and the card says so.

test('a scheduled race joined from the hub runs to the finish card with the event results, and the lobby strip is gone', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = collectPageErrors(page);
  const race = sampleEvent('race', 1800, { waiting: 2 }); // Route 66 Flats, half an hour away: inside the join window (it opens an hour before)
  await page.setViewportSize({ width: 800, height: 400 }); // wider than 760 px: the hub shows tabs, so the section I press is the active one
  await signedInRider(page, { neon: { events: [race, sampleEvent('group_ride', 20 * 3600)] } });
  await eventClockAt(page, new Date(race.starts_at).getTime(), 20); // the server's clock says: 20 seconds to the start, when I join
  await slowFrames(page);
  await page.goto('/?timescale=20');
  await expect(page.locator('#hub')).toBeVisible();
  await expect(page.locator('#hub-name')).toHaveText('Sam');
  await press(page, '#hub-tab-events');
  const card = page.locator('.hub-event.race');
  await expect(card.locator('.hub-chip')).toHaveText('2 on the line', { timeout: 45_000 }); // the mocked rows have replaced the daily schedule
  await expect(card.locator('[data-fkey="join-race"]')).toHaveText('Join the lobby');
  await press(page, '[data-fkey="join-race"]');

  // The lobby: on the Route 66 line, with the strip counting down.
  await expect(page.locator('#hub')).toBeHidden();
  await expect(page.locator('#event-bar')).toBeVisible();
  await expect(page.locator('#eb-title')).toHaveText('Evening race: Route 66 Flats');
  await expect(page.locator('#eb-status')).toHaveText(/^Starts in 0:\d\d/);
  await press(page, '#btn-menu');
  await press(page, '#btn-demo');
  await page.locator('#demo-power').evaluate((el: HTMLInputElement) => { el.value = '500'; el.dispatchEvent(new Event('input', { bubbles: true })); });

  // The start: the strip gives way to the race panel (a race has its own, a group ride keeps the strip).
  await expect(page.locator('#race-panel')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#event-bar')).toBeHidden();

  // The line.
  const finish = page.locator('#finish');
  await expect(finish).toBeVisible({ timeout: 240_000 });
  await expect(page.locator('#finish-title')).toContainText('Route 66 Flats');
  await expect(page.locator('#finish-title')).toContainText(/\d+(st|nd|rd|th)/);
  await expect(page.locator('#finish-actions')).toContainText('Race again');
  // The stage's own results, and the event's: the computer-ridden field with you among it, and why this result is not sent.
  const event = finish.locator('.event-finish');
  await expect(event.locator('h3')).toContainText('Event results · 1 real rider so far'); // (the count includes you, though a demo ride is not posted)
  await expect(event.locator('table tbody tr').first()).toBeVisible();
  await expect(event.locator('tr.me')).toHaveCount(1);
  await expect(finish).toContainText('Demo rides and sped-up clocks don’t count towards the event results.');
  // The event is over: no strip, no race panel.
  await expect(page.locator('#event-bar')).toBeHidden();
  await expect(page.locator('#race-panel')).toBeHidden();
  expect(errors, errors.join('\n')).toEqual([]);
});
