import { expect, test, type Page } from '@playwright/test';
import { slowFrames } from './slowFrames';
import { collectPageErrors, signedInRider, startDemo } from './helpers';

// Ride timing under load (docs/developer-guide/improvement-plan.md, workstream A):
//  1. a KOM effort is timed from the simulation step, so frames a second apart (`slowFrames`) at `?timescale=20` still give the result;
//  2. a demo ride started before the session has come back from the network is not stopped and reset when it lands.


async function setup(page: Page, o: { sessionDelayMs?: number } = {}) {
  const errors = collectPageErrors(page);
  await signedInRider(page, { neon: { sessionDelayMs: o.sessionDelayMs } });
  return errors;
}

/** The HUD's power reading, in watts. */
const hudPower = (page: Page) => page.evaluate(() => {
  const m = /POWER\s*\n?\s*(\d+)\s*W/i.exec((document.getElementById('hud') as HTMLElement).innerText);
  return m ? Number(m[1]) : -1;
});

test('a KOM effort is timed with one frame a second at 20×: the result toast, a split every 50 m, no void', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await setup(page);
  await slowFrames(page, 1000);
  await page.goto('/?stage=hotw-morgul-bismark&start=19.7&timescale=20&komtest');
  await startDemo(page, 600);
  await expect(page.locator('#toast')).toContainText('The Wall (lap 1) —', { timeout: 180_000 });
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('americanflyers.segments') ?? '{}')['hotw-morgul-bismark:the-wall']);
  expect(stored.best.s.length).toBe(19); // a split every 50 m up 956 m
  expect(stored.best.t).toBeGreaterThan(60);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('a demo ride started before the session lands carries on when it does (it used to stop and reset, so power read 0 W)', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await setup(page, { sessionDelayMs: 4000 });
  await slowFrames(page, 250);
  await page.goto('/');
  await startDemo(page, 250);
  await expect.poll(() => hudPower(page)).toBe(250);
  await expect(page.locator('#toast')).toContainText('Signed in as Sam Rider', { timeout: 30_000 });
  const seconds = () => page.evaluate(() => (document.getElementById('hud') as HTMLElement).innerText.match(/TIME\s*\n?\s*(\d+):(\d\d)/)?.slice(1).reduce((m, v) => m * 60 + Number(v), 0) ?? -1);
  const before = await seconds();
  await page.waitForTimeout(3000);
  expect(await hudPower(page)).toBe(250);
  await expect(page.locator('#btn-demo')).toHaveText('🎮 Stop demo');
  expect(await seconds()).toBeGreaterThanOrEqual(before); // the ride was not reset to 0:00
  expect(errors, errors.join('\n')).toEqual([]);
});
