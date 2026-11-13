import { expect, test, type Page } from '@playwright/test';
import { mockNeon } from './mockNeon';
import { DIALOGS } from './dialogs';

// The Content-Security-Policy (csp.mjs, sent as Content-Security-Policy-Report-Only by `vite preview` and by vercel.json in
// production) must produce no violation while the app does what riders do: open the home page, sign in, open the hub, ride on
// Medium graphics (the post-processing chunk) through Kestrel Vale's village (code-built dressing, a .glb hero model decoded with
// WebAssembly, textures from blob URLs, the tick worker), and open the main dialogs. A violation event or a "[Report Only]" console
// message fails the test. See docs/developer-guide/security.md for what the policy allows and why.

const press = (page: Page, selector: string) => page.locator(selector).evaluate((el) => (el as HTMLElement).click());

/** Collects every securitypolicyviolation (the page's own) and every console message that reports one (which also covers workers). */
async function watchCsp(page: Page) {
  const found: string[] = [];
  await page.exposeFunction('__cspViolation', (text: string) => { found.push(text); });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { __cspViolation: (t: string) => void }).__cspViolation(`${e.disposition} ${e.effectiveDirective} blocked ${e.blockedURI || '(inline)'} at ${e.sourceFile || 'page'}:${e.lineNumber} ${e.sample ?? ''}`);
    });
  });
  page.on('console', (m) => {
    const t = m.text();
    if (/Content Security Policy|Content-Security-Policy|\[Report Only\]/i.test(t)) found.push(`console: ${t}`);
  });
  return found;
}

test('the home page, with the email form open, reports no CSP violation', async ({ page }) => {
  const found = await watchCsp(page);
  await mockNeon(page, { signedIn: false });
  await page.goto('/?hero=dog');
  await expect(page.locator('#home')).toBeVisible();
  await press(page, '#home-email-toggle');
  await expect(page.locator('#home-email')).toBeVisible();
  await page.waitForTimeout(1500); // the fonts, the hero clip and the lazy chunks arrive
  expect(found, found.join('\n')).toEqual([]);
});

test('signed in: the hub, a Medium ride through Kestrel Vale and the main dialogs report no CSP violation', async ({ page }) => {
  test.setTimeout(300_000);
  const found = await watchCsp(page);
  const seen = new Set<string>();
  page.on('response', (r) => { const u = r.url(); if (r.ok()) seen.add(u.split('/').slice(-1)[0].replace(/-[\w-]{8}\.(js|css)$/, '.$1')); });

  await mockNeon(page, { signedIn: true });
  await page.addInitScript(() => {
    localStorage.setItem('americanflyers.signedIn', '1');
    localStorage.setItem('americanflyers.onboarded', '1');
    // Software WebGL: run the render loop at ~1 fps so the test's own clicks aren't starved (as smoke.spec.ts does).
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => window.setTimeout(() => raf(cb), 1000) as unknown as number;
  });

  // Kestrel Vale's village, on Medium: the splatted ground, the code-built dressing and the Hollins Cross Inn (a .glb with Meshopt-compressed geometry).
  await page.goto('/?stage=kestrel-vale-loop&start=0&graphics=medium&adapt=off');
  await expect(page.locator('#hub')).toBeVisible();
  await expect(page.locator('#hub-name')).toHaveText('Sam', { timeout: 90_000 }); // Medium in software WebGL is slow to settle
  for (const tab of ['training', 'plan', 'stats', 'garage', 'events', 'route']) await press(page, `#hub-tab-${tab}`);
  await press(page, '#hub-go');
  await expect(page.locator('#hub')).toBeHidden();
  await expect.poll(() => [...seen].some((f) => f.startsWith('hollins-cross-inn.glb')), { timeout: 120_000, message: 'the inn model is fetched' }).toBe(true);
  await expect.poll(() => [...seen].some((f) => f.startsWith('vendor-three-post')), { timeout: 120_000, message: 'the post-processing chunk is fetched' }).toBe(true);
  await page.waitForTimeout(4000); // the model decodes (WebAssembly, workers), the textures upload

  // A demo ride, pedalling for a moment, then every main dialog (the same list smoke.spec.ts uses).
  await press(page, '#btn-menu');
  await press(page, '#btn-demo');
  await expect(page.locator('#demo-panel')).toBeVisible();
  await page.locator('#demo-power').evaluate((el: HTMLInputElement) => { el.value = '250'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(2500);
  for (const d of DIALOGS) {
    if (d.menu) await press(page, '#btn-menu');
    await press(page, d.button);
    await expect.poll(async () => (await page.evaluate(() => Array.from(document.querySelectorAll('dialog[open]')).map((x) => `#${x.id}`))).some((id) => d.dialog.includes(id)), { message: `${d.name} dialog opens` }).toBe(true);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach((el) => (el as HTMLDialogElement).close()));
  }

  expect(found, found.join('\n')).toEqual([]);
});
