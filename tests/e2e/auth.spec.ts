import { expect, test } from '@playwright/test';
import { mockNeon } from './mockNeon';

// Sign-in goes through our own origin (/api/auth, proxied to Neon Auth), so the session
// cookie is first-party: Safari blocks third-party cookies, which left riders who signed in
// with Google stuck on the home page. After Google, Neon sends the browser back with a
// one-time ?neon_auth_session_verifier=…, which the first get-session exchanges.

test('sign-in talks to /api/auth on our own origin and exchanges the verifier from Google', async ({ page, baseURL }) => {
  const authCalls: string[] = [];
  page.on('request', (r) => { if (/\/auth\//.test(r.url()) && !/apirest/.test(r.url())) authCalls.push(r.url()); });
  await mockNeon(page, { signedIn: true });

  await page.goto('/?neon_auth_session_verifier=one-time-code');
  await expect(page.locator('#hub')).toBeVisible();
  await expect(page.locator('#hub-name')).toHaveText('Sam', { timeout: 30_000 });

  // Every auth call went to our own origin, never straight to Neon's domain.
  expect(authCalls.length).toBeGreaterThan(0);
  const origin = new URL(baseURL!).origin;
  for (const u of authCalls) expect(u.startsWith(`${origin}/api/auth/`), u).toBe(true);
  // The verifier went with the session request, and is gone from the address bar afterwards.
  expect(authCalls.some((u) => u.includes('/api/auth/get-session') && u.includes('neon_auth_session_verifier=one-time-code'))).toBe(true);
  await expect.poll(() => page.evaluate(() => location.search)).not.toContain('neon_auth_session_verifier');
});
