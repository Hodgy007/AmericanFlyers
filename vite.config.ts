import { defineConfig, type Plugin } from 'vite';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
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

// Neon Auth is served from our own origin at /api/auth (vercel.json rewrites it in
// production): the same here for `npm run dev` and `vite preview`, so the session
// cookie is first-party everywhere (Safari blocks third-party ones).
const NEON_AUTH = new URL(env.NEON_AUTH_URL ?? 'https://ep-winter-voice-za03vb20.neonauth.c-2.eu-west-2.aws.neon.tech/neondb/auth');
const authProxy = {
  '/api/auth': {
    target: NEON_AUTH.origin,
    changeOrigin: true,
    secure: true,
    rewrite: (p: string) => p.replace(/^\/api\/auth/, NEON_AUTH.pathname),
    cookieDomainRewrite: '',
  },
};

// public/sw.js carries `const VERSION = '__AF_VERSION__';` so a new deploy gets
// a new cache; put the commit (or, failing that, the build time) in place of the
// placeholder in the copy written to dist/. In dev the file is served as-is.
// (public/ is copied outside the Rollup bundle, so generateBundle never sees it.)
function serviceWorkerVersion(): Plugin {
  let outDir = 'dist';
  return {
    name: 'af-service-worker-version',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const file = path.join(outDir, 'sw.js');
      if (!existsSync(file)) return;
      const source = readFileSync(file, 'utf8');
      const version = env.VERCEL_GIT_COMMIT_SHA || shortCommit() || String(Date.now());
      const stamped = source.replace('__AF_VERSION__', version);
      if (stamped === source) this.warn(`${file} has no __AF_VERSION__ placeholder to replace`);
      else writeFileSync(file, stamped);
    },
  };
}

function shortCommit(): string | null {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch {
    return null; // no git, or not a checkout: the build time will do
  }
}

export default defineConfig({
  base: './',
  server: { proxy: authProxy },
  preview: { proxy: authProxy },
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
          // The post-processing addons load with src/world/post.ts, only on Medium and up: not in the eager three chunk.
          if (/node_modules\/three\/examples\/jsm\/(postprocessing|shaders)\//.test(id)) return 'vendor-three-post';
          if (/node_modules\/three\//.test(id)) return 'vendor-three';
          if (/node_modules\/@sentry/.test(id)) return 'vendor-sentry';
          if (/node_modules\/(@neon|better-auth|@better-auth|better-call|nanostores|zod|@better-fetch|jose|@supabase|@neondatabase)/.test(id)) return 'vendor-neon';
          return undefined;
        },
      },
    },
  },
  plugins: [
    serviceWorkerVersion(),
    ...(uploadMaps
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
      : []),
  ],
});
