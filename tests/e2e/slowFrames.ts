import type { Page } from '@playwright/test';

/** Software WebGL is slow: run the render loop at about one frame every `ms` so the test's own work isn't starved. */
export async function slowFrames(page: Page, ms = 1000) {
  await page.addInitScript((ms) => {
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => window.setTimeout(() => raf(cb), ms) as unknown as number;
  }, ms);
}
