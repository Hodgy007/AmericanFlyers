import { expect, test, type Page } from '@playwright/test';
import { mockNeon, sampleRides } from './mockNeon';

const press = (page: Page, selector: string) => page.locator(selector).evaluate((el) => (el as HTMLElement).click());

async function openApp(page: Page, signedIn = true) {
  await mockNeon(page, { signedIn });
  await page.addInitScript((inAccount) => {
    localStorage.setItem('americanflyers.onboarded', '1');
    localStorage.setItem('americanflyers.graphics', 'low');
    if (inAccount) localStorage.setItem('americanflyers.signedIn', '1');
    localStorage.setItem('americanflyers.settings', JSON.stringify({ settingsVersion: 2, sound: false, music: false }));
  }, signedIn);
  if (!process.env.E2E_FULL_FPS) {
    await page.addInitScript(() => {
      const raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => window.setTimeout(() => raf(cb), 1000) as unknown as number;
    });
  }
  await page.goto('/');
  await expect(page.locator(signedIn ? '#hub' : '#home')).toBeVisible();
  if (signedIn) await expect(page.locator('#hub-name')).toHaveText('Sam');
}

async function openEmail(page: Page) {
  await openApp(page, false);
  await press(page, '#home-email-toggle');
  await expect(page.locator('#home-email form')).toBeVisible();
}

test('typing on the home form does not trigger ride shortcuts or steal the caret', async ({ page }) => {
  await openEmail(page);
  const name = page.locator('#home-email input[name=name]');
  await name.pressSequentially('Fiona C M N');
  await expect(name).toHaveValue('Fiona C M N');
  const end = await name.evaluate((el: HTMLInputElement) => el.selectionStart!);
  await name.press('ArrowLeft');
  expect(await name.evaluate((el: HTMLInputElement) => el.selectionStart)).toBe(end - 1);
  expect(await page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  expect(await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('americanflyers.settings') ?? '{}');
    return { sound: s.sound, music: s.music };
  })).toEqual({ sound: false, music: false });
});

test('invalid signup-only fields cannot block a subsequent sign-in', async ({ page }) => {
  await openEmail(page);
  await page.locator('#home-email input[name=weight]').fill('10');
  await press(page, '#home-email [data-mode=signin]');
  await expect(page.locator('#home-email input[name=weight]')).toBeDisabled();
  await page.locator('#home-email input[name=email]').fill('rider@example.com');
  await page.locator('#home-email input[name=password]').fill('valid-test-password');
  const request = page.waitForRequest((r) => r.method() === 'POST' && /\/sign-in\/email/.test(r.url()));
  await press(page, '#home-email button[type=submit]');
  expect((await request).postDataJSON().email).toBe('rider@example.com');
});

test('a hidden short password cannot block the password-reset request', async ({ page }) => {
  await openEmail(page);
  await press(page, '#home-email [data-mode=signin]');
  await page.locator('#home-email input[name=password]').pressSequentially('short');
  await press(page, '#home-email [data-go=forgot]');
  await expect(page.locator('#home-email input[name=password]')).toBeDisabled();
  await page.locator('#home-email input[name=email]').fill('rider@example.com');
  const request = page.waitForRequest((r) => r.method() === 'POST' && /\/request-password-reset/.test(r.url()));
  await press(page, '#home-email button[type=submit]');
  expect((await request).postDataJSON().email).toBe('rider@example.com');
});

test('every native popup has one red circular close control that cancels', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page);
  await press(page, '#hub-go');
  await expect(page.locator('#hub')).toBeHidden();
  const results = await page.evaluate(async () => {
    const out: { id: string; count: number; round: boolean; red: boolean; closed: boolean; value: string }[] = [];
    for (const dialog of document.querySelectorAll('dialog')) {
      try {
        if (dialog.open) dialog.close();
        dialog.showModal();
        await new Promise((resolve) => setTimeout(resolve, 0));
        const controls = dialog.querySelectorAll<HTMLButtonElement>('button.dialog-close');
        const close = controls[0];
        if (!close) {
          out.push({ id: dialog.id, count: 0, round: false, red: false, closed: false, value: dialog.returnValue });
          dialog.close();
          continue;
        }
        const style = getComputedStyle(close);
        const color = style.backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
        const round = style.borderRadius === '50%';
        const red = color[0] > 150 && color[1] < 110 && color[2] < 120;
        close.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        out.push({ id: dialog.id, count: controls.length, round, red, closed: !dialog.open, value: dialog.returnValue });
      } catch (e) {
        out.push({ id: dialog.id, count: -1, round: false, red: false, closed: false, value: String(e) });
        try { dialog.close(); } catch { /* already closed */ }
      }
    }
    return out;
  });
  expect(results.length).toBeGreaterThanOrEqual(23);
  for (const result of results) {
    expect(result, result.id).toMatchObject({ count: 1, round: true, red: true, closed: true });
    // A close control must never leave a saving action behind (Setup and the workouts use their own values).
    expect(['', 'cancel', 'close'], result.id).toContain(result.value);
  }
});

for (const dismiss of ['corner', 'Escape'] as const) {
  test(`the creator discards a reopened draft via ${dismiss} after Save and Ride`, async ({ page }) => {
    await openApp(page);
    await press(page, '#hub-go');
    await expect(page.locator('#hub')).toBeHidden();
    await press(page, '#btn-workouts');
    await expect(page.locator('#workouts[open]')).toBeVisible();
    await press(page, '#workout-new');
    await expect(page.locator('#creator[open]')).toBeVisible();
    await page.locator('#creator input[name=name]').fill('Intentionally saved workout');
    await press(page, '#creator button[value=ride]');
    await expect(page.locator('#wp-name')).toHaveText('Intentionally saved workout');

    await press(page, '#btn-workouts');
    await press(page, '#workout-new');
    await expect(page.locator('#creator[open]')).toBeVisible();
    await page.locator('#creator input[name=name]').fill('Discarded workout draft');
    if (dismiss === 'corner') await press(page, '#creator .dialog-close');
    else await page.keyboard.press('Escape');
    await expect(page.locator('#creator[open]')).toHaveCount(0);
    await expect(page.locator('#wp-name')).toHaveText('Intentionally saved workout');
    await press(page, '#btn-workouts');
    await expect(page.locator('#workout-list')).not.toContainText('Discarded workout draft');
  });
}

test('mobile Stats keeps chart descriptions hidden and equal data at equal heights', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await mockNeon(page, { signedIn: true });
  // Eight weeks of identical distance: any visible difference is layout, not data.
  const rides = sampleRides().slice(0, 8).map((r) => ({ ...r, distance_m: 32_000 }));
  await page.route(/apirest.*\/activities/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rides) });
  });
  await page.addInitScript(() => {
    localStorage.setItem('americanflyers.signedIn', '1');
    localStorage.setItem('americanflyers.onboarded', '1');
    localStorage.setItem('americanflyers.graphics', 'low');
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => window.setTimeout(() => raf(cb), 1000) as unknown as number;
  });
  await page.goto('/');
  await expect(page.locator('#hub-name')).toHaveText('Sam');
  await press(page, '#hub-tab-stats');
  await expect(page.locator('.hub-week-bar')).toHaveCount(8);
  const chart = await page.evaluate(() => ({
    heights: Array.from(document.querySelectorAll('.hub-week-bar'), (el) => el.getBoundingClientRect().height),
    descriptions: Array.from(document.querySelectorAll('.hub-weeks .hub-sr'), (el) => ({
      position: getComputedStyle(el).position,
      width: Math.round(el.getBoundingClientRect().width),
    })),
  }));
  // Equal distances must give equal bars: the hidden descriptions used to take height at random.
  expect(Math.max(...chart.heights) - Math.min(...chart.heights)).toBeLessThan(1);
  for (const description of chart.descriptions) expect(description).toEqual({ position: 'absolute', width: 1 });
});
