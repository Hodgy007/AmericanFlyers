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
    chunkSizeWarningLimit: 600, // three.js is ~550 kB minified, in its own vendor chunk
    sourcemap: uploadMaps ? 'hidden' : false,
    rollupOptions: {
      output: {
        // Libraries change far less often than the app, so each gets a chunk of its
        // own that browsers (and the service worker) keep across deploys.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules\/three\//.test(id)) return 'vendor-three';
          if (/node_modules\/@sentry/.test(id)) return 'vendor-sentry';
          if (/node_modules\/(@neon|better-auth|@better-auth|better-call|nanostores|zod|@better-fetch|jose|@supabase|@neondatabase)/.test(id)) return 'vendor-neon';
          return undefined;
        },
      },
    },
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
