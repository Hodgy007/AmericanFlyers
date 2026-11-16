import { expect, test } from '@playwright/test';
import { collectPageErrors, press, signedInRider } from './helpers';
import { slowFrames } from './slowFrames';

// The Hell of the West tour (src/tour.ts, tourUi.ts, raceSession.ts's finish): start the tour from its dialog, ride stage 1 to the line,
// then the finish card offers the next stage, and the dialog shows the stage recorded with the standings (and the jerseys, if you lead).
// A demo rider at 500 W on a 20x clock stands in for the rider.

test('tour stage 1 ridden from the tour dialog ends with "Next: stage 2" and is recorded with standings', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = collectPageErrors(page);
  await signedInRider(page);
  await slowFrames(page);
  await page.goto('/?timescale=20');
  await expect(page.locator('#hub')).toBeVisible();
  await press(page, '#hub-go');
  await expect(page.locator('#hub')).toBeHidden();
  await press(page, '#btn-menu');
  await press(page, '#btn-tour');
  const dialog = page.locator('#tour');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#tour-stages li')).toHaveCount(3);
  await expect(page.locator('#tour-stages li').first()).toContainText('Morgul-Bismark');
  await expect(page.locator('#tour-standings table')).toHaveCount(0); // nothing recorded yet
  await press(page, '#tour-actions button.primary'); // Start the tour: stage 1 lines up
  await expect(dialog).toBeHidden();

  await press(page, '#btn-menu');
  await press(page, '#btn-demo');
  await page.locator('#demo-power').evaluate((el: HTMLInputElement) => { el.value = '500'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(page.locator('#race-panel')).toBeVisible({ timeout: 60_000 });

  const finish = page.locator('#finish');
  await expect(finish).toBeVisible({ timeout: 270_000 });
  await expect(page.locator('#finish-title')).toContainText('Morgul-Bismark');
  const place = Number(/(\d+)(?:st|nd|rd|th)/.exec((await page.locator('#finish-title').textContent()) ?? '')?.[1]);
  expect(place).toBeGreaterThan(0);
  await expect(page.locator('#finish-actions')).toContainText('Next: stage 2');
  await expect(page.locator('#finish-actions')).toContainText('Keep riding');
  await expect(page.locator('#finish-actions')).not.toContainText('Race again'); // a tour stage is not raced again on its own
  await expect(finish.locator('table tbody tr').first()).toBeVisible(); // the stage results and the classifications

  // Keep riding, then the tour dialog: stage 1 is ticked off with the rider's place and time, and the standings are in.
  await press(page, '#finish-actions button:has-text("Keep riding")');
  await expect(finish).toBeHidden();
  await press(page, '#btn-menu');
  await press(page, '#btn-tour');
  await expect(dialog).toBeVisible();
  const stage1 = page.locator('#tour-stages li').first();
  await expect(stage1).toHaveClass(/done/);
  await expect(stage1.locator('.ts-num')).toHaveText('✓');
  await expect(stage1.locator('.ts-status')).toContainText(new RegExp(`^${place}(st|nd|rd|th) · \\d+:\\d\\d`));
  await expect(page.locator('#tour-stages li').nth(1)).toHaveClass(/next/);
  await expect(page.locator('#tour-standings table').first()).toBeVisible();
  await expect(page.locator('#tour-standings tr.me, #tour-standings tr.you').first()).toBeVisible();
  await expect(page.locator('#tour-jerseys')).toBeVisible();
  await expect(page.locator('#tour-actions')).toContainText('Race stage 2');
  // The jerseys: the rider wears the yellow one if they lead the tour (they do after a win on the stage).
  if (place === 1) await expect(page.locator('#tour-jerseys .tour-jersey.you').first()).toContainText('Yellow jersey');
  expect(errors, errors.join('\n')).toEqual([]);
});
