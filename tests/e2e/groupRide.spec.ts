import { expect, test, type Page } from '@playwright/test';
import { eventClockAt } from './eventClock';
import { collectPageErrors, press, signedInRider } from './helpers';
import { sampleEvent } from './mockNeon';
import { slowFrames } from './slowFrames';

// Joining a scheduled group ride (src/schedule.ts joinState, raceSession.ts, eventsUi.ts, the hub's Events section): the lobby strip
// with its countdown, the rider held on the line until the start, the "with the group" status once under way, and the strip going
// when the rider leaves. mockNeon's `events` option supplies a ride half an hour away (inside the join window, which opens an hour
// before); `eventClockAt` then makes the server's clock say it starts `leadS` seconds after the join, whatever the page's load time.

const RIDE_ROW = () => sampleEvent('group_ride', 1800, { waiting: 3 });

/** The value of a HUD tile ("Distance", "Time"), as text. */
const tile = (page: Page, label: string) => page.locator('#hud .tile', { has: page.locator('.label', { hasText: new RegExp(`^${label}$`) }) }).locator('.value span');
const distanceM = async (page: Page) => Number((await tile(page, 'Distance').textContent())?.replace(/[^\d.]/g, '') ?? 'NaN') * 1000;

async function open(page: Page, leadS: number) {
  const errors = collectPageErrors(page);
  const row = RIDE_ROW();
  // A screen over 760 px wide gets the hub's tabs: the tab I press is then the active section for certain. On the default phone-sized
  // viewport the hub is one scrolling column and a section only starts its work (here: asking for the real events) once scrolled into view.
  await page.setViewportSize({ width: 800, height: 400 });
  await signedInRider(page, { neon: { events: [sampleEvent('race', 3 * 3600), row] } });
  await eventClockAt(page, new Date(row.starts_at).getTime(), leadS);
  await slowFrames(page);
  await page.goto('/');
  await expect(page.locator('#hub')).toBeVisible();
  await expect(page.locator('#hub-name')).toHaveText('Sam'); // the session is confirmed: the Events section asks for the real rows when it opens, not up to a minute later
  return errors;
}

/** Sets the demo rider's power from ☰ Menu (the hub is already closed). */
async function demoAt(page: Page, watts: number) {
  await press(page, '#btn-menu');
  await press(page, '#btn-demo');
  await page.locator('#demo-power').evaluate((el: HTMLInputElement, w) => { el.value = String(w); el.dispatchEvent(new Event('input', { bubbles: true })); }, watts);
}

test('a group ride joined from the hub: held on the line, then riding with the group, and Leave ends it', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await open(page, 30);
  await press(page, '#hub-tab-events');
  const card = page.locator('.hub-event.group_ride');
  await expect(card.locator('h3')).toContainText('Heartland Rollers');
  await expect(card.locator('.hub-chip')).toHaveText('3 on the line', { timeout: 45_000 }); // the mocked rows are in (not the daily schedule the hub starts with)
  await expect(card.locator('[data-fkey="join-group_ride"]')).toHaveText('Join the lobby');
  await expect(page.locator('#event-bar')).toBeHidden();
  await press(page, '[data-fkey="join-group_ride"]');

  // On the line: the hub gives way to the road and the strip counts down.
  await expect(page.locator('#hub')).toBeHidden();
  const bar = page.locator('#event-bar');
  await expect(bar).toBeVisible();
  await expect(page.locator('#eb-title')).toHaveText('Group ride: Heartland Rollers, 2.6 W/kg');
  await expect(page.locator('#eb-status')).toHaveText(/^Starts in 0:[0-3]\d/);
  await demoAt(page, 250);

  // Held: pedalling at 250 W goes nowhere before the start.
  await expect(page.locator('#eb-status')).toHaveText(/^Starts in 0:[0-3]\d/);
  expect(await distanceM(page)).toBe(0);

  // Under way: the strip reports where the rider is against the back of the group, and the clock in the ride.
  await expect(page.locator('#eb-status')).toHaveText(/(m behind the group|with the group|m ahead of the group|m off the back) · \d+:\d\d in$/, { timeout: 90_000 });
  await expect.poll(() => distanceM(page), { timeout: 30_000 }).toBeGreaterThan(20);
  await expect(bar).toBeVisible();

  // Leave: the strip goes, and the ride is a normal one again.
  await press(page, '#eb-leave');
  await expect(bar).toBeHidden();
  await expect(page.locator('#toast')).toContainText('You left Group ride');
  expect(errors, errors.join('\n')).toEqual([]);
});

/** From the hub, on the road: ☰ Menu → Events, with the group ride's card in view. */
async function eventsDialog(page: Page) {
  await press(page, '#btn-menu');
  await press(page, '#btn-events');
  const dialog = page.locator('#events');
  await expect(dialog).toBeVisible();
  const ride = dialog.locator('.event-card', { hasText: 'Group ride' });
  await expect(ride.locator('.event-count')).toContainText('starts in');
  await expect(ride.locator('button')).toHaveText('Join the lobby');
  await expect(dialog.locator('.event-card', { hasText: 'Evening race' }).locator('button')).toHaveText('Opens an hour before'); // the race is 3 hours away
  return { dialog, join: '#events .event-card:has-text("Group ride") button' };
}

test('a group ride joined from the Events dialog holds the rider in the lobby; Reset leaves it', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = await open(page, 600); // ten minutes to go: the whole test is the lobby
  await press(page, '#hub-go'); // out of the hub, onto the road
  await expect(page.locator('#hub')).toBeHidden();
  const { dialog, join } = await eventsDialog(page);
  await press(page, join);

  await expect(dialog).toBeHidden();
  await expect(page.locator('#event-bar')).toBeVisible();
  await expect(page.locator('#eb-status')).toHaveText(/^Starts in (9|10):\d\d/);
  await demoAt(page, 300);
  await page.waitForTimeout(5000);
  expect(await distanceM(page)).toBe(0); // held on the line
  await expect(page.locator('#eb-status')).toContainText('Starts in 9:'); // and the countdown is running

  // ☰ Menu → Reset asks, then leaves the ride: the strip is gone.
  await press(page, '#btn-menu');
  await press(page, '#btn-reset');
  await expect(page.locator('#hub-leave')).toBeVisible();
  await expect(page.locator('#hub-leave')).toContainText('group ride');
  await press(page, '#hub-leave-go');
  await expect(page.locator('#event-bar')).toBeHidden();
  expect(errors, errors.join('\n')).toEqual([]);
});

// The Events list can be opened from the hub ("Open the events list"): joining there closes the hub too, as the hub's own Join button does.
test('a group ride joined from the hub\'s Events list takes the rider out of the hub', async ({ page }) => {
  test.setTimeout(90_000);
  const errors = await open(page, 600);
  await press(page, '#hub-tab-events');
  await press(page, '[data-fkey="all-events"]');
  const dialog = page.locator('#events');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.event-card', { hasText: 'Group ride' }).locator('button')).toHaveText('Join the lobby');
  await press(page, '#events .event-card:has-text("Group ride") button');
  await expect(dialog).toBeHidden();
  await expect(page.locator('#event-bar')).toBeVisible(); // joined...
  await expect(page.locator('#hub')).toBeHidden({ timeout: 5000 }); // ...but the hub is still on top
  expect(errors, errors.join('\n')).toEqual([]);
});
