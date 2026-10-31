import { defineConfig } from 'vite';
import { sentryVitePlugin } from '@sentry/vite-plugin';

// Sentry: the DSN is public (it only lets the browser send error reports).
// The Vercel Sentry integration provides it as SENTRY_DSN or
// NEXT_PUBLIC_SENTRY_DSN; VITE_SENTRY_DSN works too. Without one, error
// reporting is simply off.
const env = process.env;
const dsn = env.VITE_SENTRY_DSN ?? env.NEXT_PUBLIC_SENTRY_DSN ?? env.SENTRY_DSN ?? '';
const release = env.VERCEL_GIT_COMMIT_SHA ?? '';
// With an auth token (also from the integration), source maps are uploaded so
// stack traces point at the TypeScript, then deleted so they aren't published.
const uploadMaps = !!env.SENTRY_AUTH_TOKEN;

export default defineConfig({
  base: './',
  define: {
    __SENTRY_DSN__: JSON.stringify(dsn),
    __RELEASE__: JSON.stringify(release),
  },
  build: {
    chunkSizeWarningLimit: 1000, // three.js is ~550 kB minified
    sourcemap: uploadMaps ? 'hidden' : false,
  },
  plugins: uploadMaps
    ? [
        sentryVitePlugin({
          org: env.SENTRY_ORG ?? 'hodgy007',
          project: env.SENTRY_PROJECT ?? 'sentry-byzantium-car',
          authToken: env.SENTRY_AUTH_TOKEN,
          release: release ? { name: release } : undefined,
          sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
          telemetry: false,
        }),
      ]
    : [],
});
