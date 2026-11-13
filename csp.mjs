// The Content-Security-Policy, in one place. vite.config.ts sends it from `vite preview` and `vite dev`;
// vercel.json carries the same text for production (tests/unit/csp.test.ts fails when they differ, and
// `npm run csp:sync` rewrites vercel.json). It is sent as Content-Security-Policy-Report-Only for now:
// see docs/developer-guide/security.md for what each directive allows and why.

import { createHash } from 'node:crypto';

/** The Neon Data API origin the browser calls directly (src/cloud/client.ts). Auth goes through our own origin, /api/auth. */
export const NEON_DATA_API_ORIGIN = 'https://ep-winter-voice-za03vb20.apirest.c-2.eu-west-2.aws.neon.tech';

/** Sentry's ingest hosts (the DSN's host is only known at build time, from an env var, so the regions are listed). */
export const SENTRY_INGEST = ['https://*.ingest.sentry.io', 'https://*.ingest.us.sentry.io', 'https://*.ingest.de.sentry.io'];

/** sha256 source expressions for the inline <script> blocks in index.html (the exact text between the tags). */
export function inlineScriptHashes(html) {
  const out = [];
  for (const m of html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    out.push(`'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
  }
  return out;
}

/**
 * The policy text. `html` is index.html's source (for the inline script hashes).
 * `dev` adds what the Vite dev server needs (its HMR websocket and style injection); production never has them.
 */
export function buildCsp(html, { dev = false, dataApiOrigin = NEON_DATA_API_ORIGIN } = {}) {
  const d = {
    'default-src': ["'none'"],
    // Our own bundles, the three inline scripts in index.html by hash, and WebAssembly (the Meshopt decoder that reads the .glb models).
    'script-src': ["'self'", "'wasm-unsafe-eval'", ...inlineScriptHashes(html)],
    // Our stylesheet, and Google Fonts' CSS. No inline <style> and no style="" attributes: those are blocked, so the app sets styles through the CSSOM.
    'style-src': ["'self'", 'https://fonts.googleapis.com', ...(dev ? ["'unsafe-inline'"] : [])],
    'font-src': ['https://fonts.gstatic.com'],
    // data: for the CSS arrow in selects; blob: for textures three.js decodes from the .glb models.
    'img-src': ["'self'", 'data:', 'blob:'],
    'media-src': ["'self'"], // the home page hero clips and the commentary clips
    // /api/auth and /api/ai are our own origin; the Data API is Neon's; blob: is where three.js's ImageBitmapLoader fetches textures from (the home page's scene already does).
    'connect-src': ["'self'", 'blob:', dataApiOrigin, ...SENTRY_INGEST, ...(dev ? ['ws://localhost:*', 'ws://127.0.0.1:*'] : [])],
    'worker-src': ["'self'", 'blob:'], // the service worker (/sw.js), the ride-clock tick worker (src/tickWorker.ts) and the Meshopt decoder's workers
    'manifest-src': ["'self'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'object-src': ["'none'"],
    'frame-ancestors': ["'none'"], // as X-Frame-Options: DENY
  };
  return Object.entries(d).map(([k, v]) => `${k} ${v.join(' ')}`).join('; ');
}

export const CSP_HEADER = 'Content-Security-Policy-Report-Only';
