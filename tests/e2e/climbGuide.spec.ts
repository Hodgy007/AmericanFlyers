import { expect, test, type Page } from '@playwright/test';
import { mockNeon } from './mockNeon';

// The hub's Climb guide, end to end in the built app. Neon and /api/ai are mocked: no real network and no
// Perplexity. Set E2E_SHOTS=<dir> to save screenshots at phone (390x844) and laptop (960x540) sizes.

const SHOTS = process.env.E2E_SHOTS;
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const press = (page: Page, selector: string) => page.locator(selector).evaluate((el) => (el as HTMLElement).click());

const ANSWER = {
  stageId: 'alpe-dhuez',
  topic: 'history',
  summary: 'Alpe d’Huez first hosted a Tour de France stage finish in 1952, won by Fausto Coppi. [1] The 21 numbered hairpins made it a fixture of the race. [2]',
  facts: ['The climb is about 13.8 km at an average of 8.1% [2].', 'The Tour has finished here more than 30 times [3].'],
  sources: [
    { n: 1, title: 'Alpe d\'Huez - Wikipedia', host: 'en.wikipedia.org', url: 'https://en.wikipedia.org/wiki/Alpe_d%27Huez' },
    { n: 2, title: 'Alpe d\'Huez | Tour de France', host: 'letour.fr', url: 'https://www.letour.fr/en/alpe-dhuez' },
    { n: 3, title: 'Alpe d\'Huez guide', host: 'cyclingnews.com', url: 'https://www.cyclingnews.com/features/alpe-dhuez/' },
  ],
  asOf: '2026-11-09',
};

interface Fixture {
  consent: { coach: boolean; rivals: boolean };
  aiCalls: { kind: string; payload: any; auth: string | undefined }[];
  rpcCalls: { name: string; body: any }[];
  aiStatus?: number;
}

async function setup(page: Page, f: Partial<Fixture> = {}): Promise<Fixture> {
  const fx: Fixture = { consent: { coach: true, rivals: false }, aiCalls: [], rpcCalls: [], ...f };
  await mockNeon(page, { signedIn: true });
  // Registered after mockNeon, so these win: the consent functions and /api/ai.
  await page.route(/apirest.*\/rpc\/(my_ai_consent|set_ai_consent)/, async (route) => {
    const req = route.request();
    const origin = req.headers()['origin'] ?? '*';
    const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': req.headers()['access-control-request-headers'] ?? '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const name = /rpc\/(\w+)/.exec(req.url())![1];
    const body = req.postData() ? JSON.parse(req.postData()!) : {};
    fx.rpcCalls.push({ name, body });
    if (name === 'set_ai_consent') fx.consent = { coach: body.p_coach, rivals: body.p_rivals };
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(fx.consent) });
  });
  await page.route('**/api/ai', async (route) => {
    const req = route.request();
    const { kind, payload } = JSON.parse(req.postData() ?? '{}');
    fx.aiCalls.push({ kind, payload, auth: req.headers().authorization });
    if (fx.aiStatus) {
      const error = fx.aiStatus === 429 ? 'quota' : 'unavailable';
      const message = fx.aiStatus === 429 ? 'You’ve used all of today’s AI messages for this. They come back tomorrow (UTC).' : 'The climb guide is taking a break. Try again in a bit.';
      return route.fulfill({ status: fx.aiStatus, contentType: 'application/json', body: JSON.stringify({ ok: false, error, message }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, kind, source: 'web', data: { ...ANSWER, stageId: payload.stageId, topic: payload.topic }, remaining: 7 }) });
  });
  await page.addInitScript(() => {
    localStorage.setItem('americanflyers.signedIn', '1');
    localStorage.setItem('americanflyers.onboarded', '1');
    // Software WebGL: run the render loop at ~1 fps so the test's own clicks aren't starved.
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => window.setTimeout(() => raf(cb), 1000) as unknown as number;
  });
  await page.setViewportSize({ width: 960, height: 540 });
  await page.goto('/');
  await expect(page.locator('#hub')).toBeVisible();
  await expect(page.locator('#hub-s-route .hub-stage')).not.toHaveCount(0);
  // The opt-in is read from the database after sign-in; give the app a moment to apply it to the settings.
  await expect.poll(() => fx.rpcCalls.some((c) => c.name === 'my_ai_consent'), { timeout: 30_000 }).toBe(true);
  await page.waitForTimeout(500);
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

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

test('only the real-road stages have a Climb guide button', async ({ page }) => {
  const errors = errorsOf(page);
  await setup(page);
  await expect(page.locator('[data-guide="alpe-dhuez"]')).toHaveCount(1);
  await expect(page.locator('[data-guide="stelvio"]')).toHaveCount(1);
  await expect(page.locator('[data-guide="hell-of-the-west"]')).toHaveCount(1);
  await expect(page.locator('[data-guide="heartland"]')).toHaveCount(0);
  await expect(page.locator('[data-guide="route66"]')).toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('open a stage’s Climb guide, pick a topic, see the answer with numbered sources; reopening uses the saved answer', async ({ page }) => {
  const errors = errorsOf(page);
  const fx = await setup(page);
  await press(page, '[data-guide="alpe-dhuez"]');
  await expect(page.locator('.hub-climb')).toBeVisible();
  await expect(page.locator('[data-guide="alpe-dhuez"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.hub-climb-chip')).toHaveCount(4);
  await expect(page.locator('.hub-climb-note')).toContainText('AI-generated from web sources, may be wrong');
  await shot(page, 'climb-1-open-960x540');

  await press(page, '.hub-climb-chip[data-topic="history"]');
  await expect(page.locator('.hub-climb-summary')).toContainText('Fausto Coppi');
  await expect(page.locator('.hub-climb-asof')).toContainText('as of 2026-11-09');
  await expect(page.locator('.hub-climb-chip[data-topic="history"]')).toHaveAttribute('aria-pressed', 'true');
  const links = page.locator('.hub-climb-sources a');
  await expect(links).toHaveCount(3);
  await expect(links.first()).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Alpe_d%27Huez');
  await expect(links.first()).toHaveAttribute('target', '_blank');
  await expect(links.first()).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.locator('.hub-climb-host').nth(1)).toHaveText('letour.fr');
  await expect(page.locator('.hub-climb-sources li').nth(2)).toHaveAttribute('value', '3');
  expect(fx.aiCalls).toHaveLength(1);
  expect(fx.aiCalls[0]).toMatchObject({ kind: 'coach_climb', payload: { stageId: 'alpe-dhuez', topic: 'history' } });
  expect(fx.aiCalls[0].auth).toMatch(/^Bearer /);
  await page.locator('.hub-climb').scrollIntoViewIfNeeded();
  await shot(page, 'climb-2-answer-960x540');

  // A second topic is a second call; going back to the first, or closing and reopening, is not.
  await press(page, '.hub-climb-chip[data-topic="visit"]');
  await expect.poll(() => fx.aiCalls.length).toBe(2);
  expect(fx.aiCalls[1].payload).toEqual({ stageId: 'alpe-dhuez', topic: 'visit' });
  await press(page, '.hub-climb-head button');
  await expect(page.locator('.hub-climb')).toHaveCount(0);
  await press(page, '[data-guide="alpe-dhuez"]');
  await press(page, '.hub-climb-chip[data-topic="history"]');
  await expect(page.locator('.hub-climb-asof')).toContainText('Saved answer');
  await expect(page.locator('.hub-climb-sources a')).toHaveCount(3);
  expect(fx.aiCalls).toHaveLength(2);

  // Phone size: nothing spills sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.hub-climb').scrollIntoViewIfNeeded();
  expect(await noSideScroll(page)).toBe(true);
  await expect(page.locator('.hub-climb')).toBeVisible();
  await shot(page, 'climb-3-answer-390x844');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('the AI coach is off: the guide asks first, saves the opt-in, then answers', async ({ page }) => {
  const errors = errorsOf(page);
  const fx = await setup(page, { consent: { coach: false, rivals: false } });
  await press(page, '[data-guide="stelvio"]');
  await press(page, '.hub-climb-chip[data-topic="conditions"]');
  await expect(page.locator('[data-act="consent"]')).toBeVisible();
  await expect(page.locator('.hub-climb-out')).toContainText('AI coach');
  expect(fx.aiCalls).toHaveLength(0); // nothing was sent
  await shot(page, 'climb-4-consent-960x540');
  await press(page, '[data-act="consent"]');
  await expect.poll(() => fx.rpcCalls.find((c) => c.name === 'set_ai_consent')?.body).toEqual({ p_coach: true, p_rivals: false });
  await expect(page.locator('.hub-climb-summary')).toContainText('Fausto Coppi'); // the mock answers whichever stage
  expect(fx.aiCalls).toHaveLength(1);
  expect(fx.aiCalls[0].payload).toEqual({ stageId: 'stelvio', topic: 'conditions' });
  expect(errors, errors.join('\n')).toEqual([]);
});

test('when the AI is busy or over quota the guide shows a line from the stage’s own figures and the message', async ({ page }) => {
  const errors = errorsOf(page);
  const fx = await setup(page, { aiStatus: 503 });
  await press(page, '[data-guide="alpe-dhuez"]');
  await press(page, '.hub-climb-chip[data-topic="records"]');
  await expect(page.locator('.hub-climb-summary')).toContainText('Alpe d’Huez: 14.0 km, 1,118 m of climbing, 8.0% on average. Live climb guide unavailable right now.');
  await expect(page.locator('.hub-climb-msg')).toContainText('taking a break');
  await expect(page.locator('.hub-climb-sources')).toHaveCount(0);
  await shot(page, 'climb-5-unavailable-960x540');

  fx.aiStatus = 429;
  await press(page, '.hub-climb-chip[data-topic="visit"]');
  await expect(page.locator('.hub-climb-msg')).toContainText('come back tomorrow');
  await expect(page.locator('.hub-climb-summary')).toContainText('Live climb guide unavailable right now.');
  // A failed call isn't saved: asking again calls again.
  fx.aiStatus = undefined;
  await press(page, '.hub-climb-chip[data-topic="records"]');
  await expect(page.locator('.hub-climb-sources a')).toHaveCount(3);
  expect(fx.aiCalls.map((c) => c.payload.topic)).toEqual(['records', 'visit', 'records']);
  expect(errors, errors.join('\n')).toEqual([]);
});
