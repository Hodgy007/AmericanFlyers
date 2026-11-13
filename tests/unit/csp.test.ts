import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CSP_HEADER, buildCsp, inlineScriptHashes } from '../../csp.mjs';

// vercel.json carries the Content-Security-Policy text for production; vite.config.ts sends the same from csp.mjs
// for `vite preview` and `vite dev`, so the browser tests see what production would. They must not drift apart.

const html = readFileSync('index.html', 'utf8');
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as { headers: { source: string; headers: { key: string; value: string }[] }[] };
const sent = vercel.headers.find((h) => h.source === '/(.*)')!.headers;

describe('Content-Security-Policy', () => {
  it('vercel.json carries the policy csp.mjs builds from index.html (run `npm run csp:sync` if this fails)', () => {
    expect(sent.find((h) => h.key === CSP_HEADER)?.value).toBe(buildCsp(html));
  });

  it('is report-only for now: no enforcing header yet', () => {
    expect(sent.some((h) => h.key === 'Content-Security-Policy')).toBe(false);
  });

  it('allows every inline script in index.html by hash, and there is no inline handler or style attribute to block', () => {
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/gi)].length;
    expect(inline).toBeGreaterThan(0);
    expect(inlineScriptHashes(html)).toHaveLength(inline);
    const markup = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    expect(markup).not.toMatch(/\sstyle\s*=/i);
    expect(markup).not.toMatch(/\son[a-z]+\s*=/i);
  });

  it('is tight where it matters: no unsafe-inline or unsafe-eval in production, nothing framed, no plugins', () => {
    const policy = buildCsp(html);
    expect(policy).not.toMatch(/'unsafe-(inline|eval)'/);
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
  });

  it('the dev server adds only its websocket and style injection', () => {
    const dev = buildCsp(html, { dev: true });
    expect(dev).toContain('ws://localhost:*');
    expect(buildCsp(html)).not.toContain('ws://');
  });
});
