import { expect, test, type Page } from '@playwright/test';

// The AI coach and AI rivals, end to end in the built app. Neon and /api/ai are
// both mocked: no real network, no Anthropic. Set E2E_SHOTS=<dir> to save screenshots.

// The auth client sends cookies, so CORS must name the origin (a wildcard is refused with credentials).
const CORS = {
  'access-control-allow-origin': `http://localhost:${process.env.E2E_PORT ?? 4185}`,
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': '*',
  'access-control-expose-headers': 'set-auth-jwt',
};
const JWT = 'aaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbb.cccccccccccccccccccc';
const SHOTS = process.env.E2E_SHOTS;
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
/** Stops the render loop (the last frame stays on screen) and keeps the coach card up, so a screenshot shows them. */
const freeze = (page: Page) => page.evaluate(() => {
  (window as unknown as { __rafPaused: boolean }).__rafPaused = true;
  const b = document.getElementById('coach-bubble');
  if (b?.querySelector('p')?.textContent) { b.hidden = false; b.classList.add('show'); }
});
const thaw = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __rafPaused: boolean; __rafQueue: FrameRequestCallback[] };
  w.__rafPaused = false;
  for (const cb of w.__rafQueue.splice(0)) requestAnimationFrame(cb);
});
const press = (page: Page, selector: string) => page.locator(selector).evaluate((el) => (el as HTMLElement).click());

interface Fixture {
  signedIn: boolean;
  consent: { coach: boolean; rivals: boolean };
  rivals: unknown[];
  aiCalls: { kind: string; payload: any; auth: string | undefined }[];
  rpcCalls: { name: string; body: any }[];
  aiStatus?: number;
}

const DEBRIEF = {
  headline: 'Steady ride, strong finish',
  summary: 'You held a smooth rhythm for the whole ride and kept your power even. That is the kind of riding that builds a base.',
  went_well: ['Very even power', 'Good cadence'],
  work_on: ['Drink a little more', 'Stand up on the steep bits'],
  next: { id: 'builtin-sweet-spot-3x10', why: 'Builds on your steady base.' },
};
const RIVAL_LINES = Object.fromEntries(['start', 'you_pass', 'they_attack', 'they_drop_you', 'you_drop_them', 'last_km', 'they_win', 'you_win'].map((t) => [t, [`Mock ${t} line one`, `Mock ${t} line two`]]));

async function mock(page: Page, f: Fixture) {
  await page.route(/neonauth/, (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (!f.signedIn) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: 'null' });
    const body = { session: { id: 's1', token: 'plain-session-token', userId: 'u1', expiresAt: '2099-01-01T00:00:00Z' }, user: { id: 'u1', name: 'Alex Rider', email: 'alex@example.invalid', emailVerified: true, image: null } };
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json', 'set-auth-jwt': JWT }, body: JSON.stringify(body) });
  });
  await page.route(/apirest/, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const json = (body: unknown, status = 200) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const m = /\/rpc\/(\w+)/.exec(req.url());
    if (!m) return json([]);
    const body = req.postData() ? JSON.parse(req.postData()!) : {};
    f.rpcCalls.push({ name: m[1], body });
    switch (m[1]) {
      case 'my_ai_consent': return json(f.consent);
      case 'set_ai_consent': f.consent = { coach: body.p_coach, rivals: body.p_rivals }; return json(f.consent);
      case 'my_rivals': return json(f.rivals);
      case 'forget_rival': f.rivals = []; return route.fulfill({ status: 204, headers: CORS });
      case 'save_coach_debrief': return route.fulfill({ status: 204, headers: CORS });
      case 'my_coach_debrief': return json(null);
      default: return json([]);
    }
  });
  await page.route('**/api/ai', async (route) => {
    const req = route.request();
    const { kind, payload } = JSON.parse(req.postData() ?? '{}');
    f.aiCalls.push({ kind, payload, auth: req.headers().authorization });
    const reply = (data: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, kind, source: 'claude', data, remaining: 5 }) });
    if (f.aiStatus) return route.fulfill({ status: f.aiStatus, contentType: 'application/json', body: JSON.stringify({ ok: false, error: f.aiStatus === 429 ? 'quota' : 'unavailable', message: 'nope' }) });
    switch (kind) {
      case 'coach_plan': return reply({ tips: [{ at_m: 30, at_s: null, text: 'Easy start. Find a smooth rhythm before anything else.' }, { at_m: 250, at_s: null, text: 'Settle into a steady rhythm here. Breathe and relax your shoulders.' }] });
      case 'coach_tip': return reply({ text: 'Spin it up a little, lighter gear and quicker legs.' });
      case 'coach_debrief': return reply(DEBRIEF);
      case 'rival_pre': return reply({ lines: RIVAL_LINES });
      case 'rival_post': return reply({ line: 'Great ride, friend. Same time next week?', note: 'Stayed close all ride on Heartland.' });
    }
    return route.fulfill({ status: 400, body: '{}' });
  });
}

/** The app opens on the hub (signed-in hint set below); these tests are about the ride, so press Ride first. */
async function ride(page: Page) {
  await expect(page.locator('#hub')).toBeVisible();
  await press(page, '#hub-go');
  await expect(page.locator('#hub')).toBeHidden();
}

async function setup(page: Page, f: Partial<Fixture> = {}, query = ''): Promise<Fixture> {
  const fx: Fixture = { signedIn: true, consent: { coach: false, rivals: false }, rivals: [], aiCalls: [], rpcCalls: [], ...f };
  await mock(page, fx);
  if (process.env.E2E_DEBUG) page.on('request', (r) => { if (/neonauth|apirest|api\/ai/.test(r.url())) console.log(new Date().toISOString().slice(11, 19), r.method(), r.url().replace(/^.*\/(auth|rest\/v1)/, '$1').slice(0, 90)); });
  await page.addInitScript(() => {
    localStorage.setItem('americanflyers.signedIn', '1');
    localStorage.setItem('americanflyers.onboarded', '1');
    // Software WebGL: run the render loop at ~4 fps so the test's own clicks aren't starved.
    const raf = window.requestAnimationFrame.bind(window);
    const w = window as unknown as { __rafDelay: number; __rafPaused: boolean; __rafQueue: FrameRequestCallback[] };
    w.__rafDelay = 250;
    w.__rafPaused = false;
    w.__rafQueue = [];
    window.requestAnimationFrame = (cb) => window.setTimeout(() => { if (w.__rafPaused) w.__rafQueue.push(cb); else raf(cb); }, w.__rafDelay) as unknown as number;
  });
  await page.setViewportSize({ width: 960, height: 600 });
  await page.goto(`/${query}`);
  await ride(page);
  await expect(page.locator('#btn-menu')).toBeVisible();
  return fx;
}

const errorsOf = (page: Page) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/Failed to load resource|net::ERR|ERR_BLOCKED|ERR_NAME|ERR_INTERNET|ERR_CONNECTION|ERR_TUNNEL|CORS|status of (4|5)\d\d/i.test(m.text())) return;
    errors.push(`console.error: ${m.text()}`);
  });
  return errors;
};

test('signed out: the AI switches are off and ask you to sign in', async ({ page }) => {
  const errors = errorsOf(page);
  await setup(page, { signedIn: false });
  await press(page, '#btn-menu');
  await press(page, '#btn-settings');
  await expect(page.locator('#settings[open]')).toBeVisible();
  await expect(page.locator('#settings [name=aiCoach]')).toBeDisabled();
  await expect(page.locator('#settings [name=aiRivals]')).toBeDisabled();
  await expect(page.locator('#ai-signin')).toBeVisible();
  await page.locator('#settings .ai-settings').scrollIntoViewIfNeeded();
  await shot(page, '01-settings-signed-out');
  await page.evaluate(() => (document.getElementById('settings') as HTMLDialogElement).close());
  // Rivals still open and ride with ready-made lines.
  await press(page, '#btn-menu');
  await press(page, '#btn-rivals');
  await expect(page.locator('#rivals[open]')).toBeVisible();
  await expect(page.locator('.rival-card')).toHaveCount(4);
  await expect(page.locator('#rivals-note')).toContainText('Sign in');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('opt in, coach tips, rival lines and debriefs (mocked AI)', async ({ page }) => {
  test.setTimeout(420_000);
  const errors = errorsOf(page);
  const fx = await setup(page, { rivals: [{ rival: 'blaze', wins: 2, losses: 3, rides: 5, last_ride: '2026-10-30T10:00:00Z', notes: ['Cracked on the wall at 12 km.', 'Won the sprint on Heartland.'] }] }, '?timescale=20');

  // --- opt in from Settings: saved in the database through set_ai_consent ---
  await press(page, '#btn-menu');
  await press(page, '#btn-settings');
  await expect(page.locator('#settings [name=aiCoach]')).toBeEnabled();
  await page.locator('#settings [name=aiCoach]').check();
  await page.locator('#settings [name=aiRivals]').check();
  await page.locator('#settings .ai-settings').scrollIntoViewIfNeeded();
  await shot(page, '02-settings-opt-in');
  await press(page, '#settings button[value=save]');
  await expect.poll(() => fx.rpcCalls.find((c) => c.name === 'set_ai_consent')?.body).toEqual({ p_coach: true, p_rivals: true });

  // --- pick a rival: head-to-head record and what they remember ---
  await press(page, '#btn-menu');
  await press(page, '#btn-rivals');
  await expect(page.locator('.rival-card[data-rival=blaze] .rival-record')).toContainText('You 2 – 3 them');
  await expect(page.locator('.rival-card[data-rival=blaze] .rival-memory')).toContainText('Cracked on the wall');
  await shot(page, '03-rivals-dialog');
  await press(page, '.rival-card[data-rival=blaze] .rival-actions button.primary');
  await expect.poll(() => fx.aiCalls.map((c) => c.kind)).toContain('rival_pre');
  const pre = fx.aiCalls.find((c) => c.kind === 'rival_pre')!;
  expect(pre.auth).toBe(`Bearer ${JWT}`); // the rider's own token goes to the function
  expect(pre.payload.rival).toBe('blaze');

  // --- ride (demo): the coach's plan arrives, tips show as you reach them ---
  await press(page, '#btn-menu');
  await press(page, '#btn-demo');
  // The rival speaks as you set off (a toast and a bubble over their head), with the AI's line.
  await expect(page.locator('#toast.show')).toContainText(/Kit Blaze: “Mock start line/, { timeout: 60_000 });
  await freeze(page);
  await shot(page, '05-rival-line');
  await thaw(page);
  await expect.poll(() => fx.aiCalls.map((c) => c.kind), { timeout: 60_000 }).toContain('coach_plan');
  await expect(page.locator('#coach-bubble.show')).toContainText('Settle into a steady rhythm', { timeout: 60_000 });
  await freeze(page);
  await shot(page, '04-coach-bubble');
  await thaw(page);

  // --- keep riding for 3 minutes of ride time, then end the ride: summary with the coach's debrief ---
  // Software rendering is slow: shrink the window and drop the frame throttle while the clock runs.
  await page.setViewportSize({ width: 360, height: 240 });
  await page.evaluate(() => { (window as unknown as { __rafDelay: number }).__rafDelay = 20; });
  // Wait until the ride has run 3+ minutes of ride time (the debrief needs it): the time block shows m:ss.
  await expect.poll(async () => {
    const txt = await page.evaluate(() => Array.from(document.querySelectorAll('#hud *')).map((e) => e.textContent).join(' '));
    const m = /(\d+):(\d\d)(?::(\d\d))?/.exec(txt.replace(/\s+/g, ' '));
    return m ? (m[3] ? Number(m[1]) * 60 : Number(m[1])) : 0;
  }, { timeout: 250_000, intervals: [1000] }).toBeGreaterThanOrEqual(3);
  await page.setViewportSize({ width: 960, height: 600 });
  await page.evaluate(() => { (window as unknown as { __rafDelay: number }).__rafDelay = 250; });
  await press(page, '#btn-menu');
  await press(page, '#btn-reset');
  await expect(page.locator('#finish .coach-debrief')).toContainText('Steady ride, strong finish', { timeout: 30_000 });
  await expect(page.locator('#finish .coach-next')).toContainText('Sweet Spot');
  await page.locator('#finish .coach-card').scrollIntoViewIfNeeded();
  await shot(page, '06-debrief-on-summary');
  const debriefCall = fx.aiCalls.find((c) => c.kind === 'coach_debrief')!;
  expect(debriefCall.payload.durationS).toBeGreaterThanOrEqual(180);
  expect(JSON.stringify(debriefCall.payload)).not.toMatch(/alex|@/i); // no name or email goes in the payload

  // The rival says goodbye and, because this was a demo ride, the result is flagged as not counting.
  await expect(page.locator('#finish .rival-closing')).toContainText('Great ride, friend', { timeout: 30_000 });
  expect(fx.aiCalls.find((c) => c.kind === 'rival_post')!.payload.counts).toBe(false);

  // "Load it" starts the suggested workout.
  await press(page, '#finish .coach-next button');
  await expect(page.locator('#workout-panel')).toBeVisible();
  await expect(page.locator('#wp-name')).toContainText('Sweet Spot');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('when the AI is over quota the ride carries on with the built-in tips', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = errorsOf(page);
  const fx = await setup(page, { consent: { coach: true, rivals: true }, aiStatus: 429 }, '?timescale=20');
  await expect.poll(() => fx.rpcCalls.some((c) => c.name === 'my_ai_consent')).toBe(true);
  await press(page, '#btn-menu');
  await press(page, '#btn-demo');
  await expect.poll(() => fx.aiCalls.map((c) => c.kind), { timeout: 60_000 }).toContain('coach_plan');
  // The canned plan has a first tip at 100 m.
  await expect(page.locator('#coach-bubble.show')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#coach-bubble p')).not.toHaveText('');
  expect(errors, errors.join('\n')).toEqual([]);
});
