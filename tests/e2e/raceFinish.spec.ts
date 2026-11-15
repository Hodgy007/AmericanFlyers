import { expect, test } from '@playwright/test';
import { collectPageErrors, press, signedInRider } from './helpers';
import { slowFrames } from './slowFrames';

// A race ridden to the line: the race itself, then the finish card with your place, the results
// table and "Race again", and the road going back to normal (the race panel gone, pro teams no longer "racing").
// A demo rider on a sped-up clock stands in for the rider; the Data API is mocked as in the other specs.

const mode = (m: string) => `.hub-mode-opt[data-mode="${m}"]`;

test('a race on Route 66 runs to the finish card with your place and the results', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = collectPageErrors(page);
  await signedInRider(page);
  await slowFrames(page);
  await page.goto('/?timescale=20');
  await expect(page.locator('#hub')).toBeVisible();
  await press(page, '[data-fkey="stage-route66"]');
  await press(page, mode('race'));
  await expect(page.locator('#hub-go')).toContainText('Race');
  await press(page, '#hub-go');
  await expect(page.locator('#hub')).toBeHidden();
  // (The 3-2-1 on the line is checked in rideMode.spec.ts; at 20× it is over in a frame.)

  await press(page, '#btn-menu');
  await press(page, '#btn-demo');
  await page.locator('#demo-power').evaluate((el: HTMLInputElement) => { el.value = '500'; el.dispatchEvent(new Event('input', { bubbles: true })); });

  // Under way: the race panel shows a place out of the field.
  await expect(page.locator('#race-panel')).toBeVisible({ timeout: 60_000 });

  // The line: the card names the stage and a place, lists the field, and offers another go.
  const card = page.locator('#finish');
  await expect(card).toBeVisible({ timeout: 240_000 });
  await expect(page.locator('#finish-title')).toContainText('Route 66 Flats');
  await expect(page.locator('#finish-title')).toContainText(/\d+(st|nd|rd|th)/);
  await expect(card.locator('table tbody tr').first()).toBeVisible(); // the results table
  await expect(card.locator('tr.me, tr.you').first()).toBeVisible(); // your own row is marked
  await expect(page.locator('#finish-actions')).toContainText('Race again');
  await expect(page.locator('#finish-actions')).toContainText('Keep riding');

  // The race is over: the panel is gone and the teams are back to riding the road.
  await expect(page.locator('#race-panel')).toBeHidden();
  expect(errors, errors.join('\n')).toEqual([]);
});
