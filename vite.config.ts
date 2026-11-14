import { defineConfig, type Plugin } from 'vite';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { CSP_HEADER, NEON_DATA_API_ORIGIN, buildCsp } from './csp.mjs';

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

// src/boot.ts (the page's entry) loads the app, src/main.ts, with a dynamic import after fetching the opening stage's road. That would put the
// app a round trip behind the page, so the built index.html preloads the app's chunk, and the chunks it needs, next to the entry's own.
function preloadApp(): Plugin {
  return {
    name: 'af-preload-app',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) return html;
        const app = Object.values(bundle).find((c) => c.type === 'chunk' && c.moduleIds.some((id) => id.endsWith('/src/main.ts')));
        if (!app || app.type !== 'chunk') return html;
        const wanted = new Set<string>();
        const visit = (name: string) => {
          if (wanted.has(name)) return;
          wanted.add(name);
          const c = bundle[name];
          if (c?.type === 'chunk') c.imports.forEach(visit);
        };
        visit(app.fileName);
        const have = (file: string) => html.includes(`./${file}"`);
        const tags = [...wanted].filter((f) => !have(f)).map((f) => ({ tag: 'link', attrs: { rel: 'modulepreload', crossorigin: '', href: `./${f}` }, injectTo: 'head' as const }));
        // The app's stylesheet belongs to the app's chunk, which loads late: link it from the page, as it was when the app was the entry.
        const css = [...wanted].flatMap((f) => { const c = bundle[f]; return c?.type === 'chunk' ? [...(c.viteMetadata?.importedCss ?? [])] : []; });
        for (const f of css) if (!have(f)) tags.push({ tag: 'link', attrs: { rel: 'stylesheet', crossorigin: '', href: `./${f}` }, injectTo: 'head' as const });
        return { html, tags };
      },
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

// The same Content-Security-Policy as vercel.json (see csp.mjs), sent by `vite preview` and `vite dev` so tests and
// local runs see the violations. A VITE_NEON_DATA_API_URL override is allowed too.
const indexHtml = readFileSync(path.join(import.meta.dirname, 'index.html'), 'utf8');
const dataApiOrigin = env.VITE_NEON_DATA_API_URL ? new URL(env.VITE_NEON_DATA_API_URL).origin : NEON_DATA_API_ORIGIN;
const cspHeaders = (dev: boolean) => ({ [CSP_HEADER]: buildCsp(indexHtml, { dev, dataApiOrigin }) });

export default defineConfig({
  base: './',
  server: { proxy: authProxy, headers: cspHeaders(true) },
  preview: { proxy: authProxy, headers: cspHeaders(false) },
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
          // zod gets its own chunk so cloud/client.ts can switch its code generation off before the SDK (which builds its schemas on load) runs.
          if (/node_modules\/zod\//.test(id)) return 'vendor-zod';
          if (/node_modules\/(@neon|better-auth|@better-auth|better-call|nanostores|zod|@better-fetch|jose|@supabase|@neondatabase)/.test(id)) return 'vendor-neon';
          return undefined;
        },
      },
    },
  },
  plugins: [
    serviceWorkerVersion(),
    preloadApp(),
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
