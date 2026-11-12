import type { Page } from '@playwright/test';

/**
 * Throttle `requestAnimationFrame` to about 1 fps (`ms` between frames), so the software-rendered 3D scene stops hogging the one thread
 * the test and the page share. The ride itself is stepped from real elapsed time (src/rideClock.ts), not once per
 * frame, so it is unaffected; only the pictures are fewer. Caveat: at 1 fps a demo rider's power drifts to 0 W after about a minute of ride time at ?timescale=20 (seen locally), so a test that must ride longer than that should not use it. Not for the KOM tests either: they read the panel at moments of a 20× ride, and on CI throttled frames left it a step behind (#55). Use it in a test that checks the DOM, the HUD or stored
 * data and not the rendering. `E2E_FULL_FPS=1` turns it off (as in the other specs).
 */
export async function slowFrames(page: Page, ms = 1000) {
  if (process.env.E2E_FULL_FPS) return;
  await page.addInitScript((delay) => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => window.setTimeout(() => raf(cb), delay) as unknown as number;
  }, ms);
}
