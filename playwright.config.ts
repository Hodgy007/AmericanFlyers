import { existsSync } from 'node:fs';
import { chromium, defineConfig } from '@playwright/test';

// End-to-end smoke test: serves the production build with `vite preview` and
// drives it in headless Chromium. Build first (`npm run test:e2e` does).
//
// Browser: the default Playwright Chromium (CI installs it with
// `npx playwright install --with-deps chromium`). Only where that download
// isn't there (the offline Claude Code sandbox ships a Chromium of its own),
// fall back to that one.
const PORT = Number(process.env.E2E_PORT ?? 4185);

function sandboxChromium(): string | undefined {
  try {
    if (existsSync(chromium.executablePath())) return undefined;
  } catch { /* no default browser: fall through */ }
  const fallback = '/opt/pw-browsers/chromium';
  return existsSync(fallback) ? fallback : undefined;
}

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 150_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 640, height: 400 }, // small: the 3D scene renders in software
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: sandboxChromium(),
      args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
