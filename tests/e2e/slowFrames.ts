import type { Page } from '@playwright/test';

/**
 * Throttle `requestAnimationFrame` to about 1 fps (`ms` between frames), so the software-rendered 3D scene stops hogging the one thread
 * the test and the page share. The ride itself is stepped from real elapsed time (src/rideClock.ts), not once per
 * frame, so it is unaffected; only the pictures are fewer. Not for the KOM tests: they read the panel at moments of a 20× ride, and on CI throttled frames left it a step behind (#55).
 * (An earlier note here blamed slow frames for a demo rider's power fading to 0 W after about a minute at ?timescale=20. That was the
 * session arriving late and stopping the demo ride, a bug in main.ts that is fixed: rideTiming.spec.ts. If power still reads 0 W
 * in a test after a few seconds, check that the demo is still on and that nothing called abandonRide().)
 * Use it in a test that checks the DOM, the HUD or stored
 * data and not the rendering. `E2E_FULL_FPS=1` turns it off (as in the other specs).
 */
export async function slowFrames(page: Page, ms = 1000) {
  if (process.env.E2E_FULL_FPS) return;
  await page.addInitScript((delay) => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => window.setTimeout(() => raf(cb), delay) as unknown as number;
  }, ms);
}
