import type { Page } from '@playwright/test';

/**
 * Answers `rpc/server_now` (the clock a scheduled event is joined against) so that the event starting at `startMs` is
 * `leadS` seconds away the moment it is joined, however long the page took to load. The first answer fixes the offset
 * from the machine's clock; every later answer keeps it. (Register after `mockNeon`/`signedInRider`: the last route wins.)
 * The app asks for the time only when an event is joined, so before that the hub counts down on the real clock.
 */
export async function eventClockAt(page: Page, startMs: number, leadS: number) {
  let skew: number | null = null;
  await page.route(/rpc\/server_now/, (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fallback();
    skew ??= startMs - leadS * 1000 - Date.now();
    return route.fulfill({
      status: 200,
      headers: { 'access-control-allow-origin': req.headers()['origin'] ?? '*', 'access-control-allow-credentials': 'true', 'content-type': 'application/json' },
      body: JSON.stringify(new Date(Date.now() + skew).toISOString()),
    });
  });
}
