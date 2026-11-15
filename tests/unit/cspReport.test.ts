import { describe, expect, it } from 'vitest';
import {
  MAX_BODY_BYTES, MAX_FIELD, MAX_REPORTS, MAX_FORWARDED, MAX_SAMPLE, bodyToText, browserFamily, handleCspReport, normaliseReport, sentryEndpoint,
} from '../../api/_lib/cspReport';

const legacy = {
  'csp-report': {
    'document-uri': 'https://americanflyers.vercel.app/ride?token=secret#frag',
    referrer: 'https://example.com/private?x=1',
    'violated-directive': 'script-src-elem',
    'effective-directive': 'script-src-elem',
    'original-policy': "default-src 'none'",
    disposition: 'report',
    'blocked-uri': 'https://evil.example/x.js?k=1',
    'line-number': 12,
    'column-number': 34,
    'source-file': 'https://americanflyers.vercel.app/assets/app.js?v=3',
    'script-sample': 'a'.repeat(200),
  },
};
const modern = [
  { type: 'csp-violation', age: 10, url: 'https://americanflyers.vercel.app/?q=1', user_agent: 'x', body: {
    documentURL: 'https://americanflyers.vercel.app/hub?u=1', referrer: 'https://r.example/?a=b', effectiveDirective: 'img-src', blockedURL: 'https://img.example/a.png#x',
    disposition: 'enforce', sourceFile: 'https://americanflyers.vercel.app/a.js', lineNumber: 5, columnNumber: 6, sample: '', originalPolicy: 'p', statusCode: 200,
  } },
  { type: 'network-error', body: {} },
];
const CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

const post = (body: unknown, contentType = 'application/csp-report', ua = CHROME) =>
  new Request('https://x.example/api/csp-report', { method: 'POST', headers: { 'content-type': contentType, 'user-agent': ua }, body: typeof body === 'string' ? body : JSON.stringify(body) });

function run(req: Request, dsn?: string, fetchImpl?: typeof fetch) {
  const logs: string[] = [];
  const calls: { url: string; init: RequestInit }[] = [];
  const fakeFetch = (fetchImpl ?? (async () => new Response('ok'))) as typeof fetch;
  const wrapped = (async (url: string, init: RequestInit) => { calls.push({ url: String(url), init }); return fakeFetch(url, init); }) as unknown as typeof fetch;
  return handleCspReport(req, { dsn, fetch: wrapped, log: (l) => logs.push(l) }).then((res) => ({ res, logs, calls }));
}
const logged = (l: string) => JSON.parse(l.replace(/^csp-report /, ''));

describe('POST /api/csp-report: formats', () => {
  it('reads the legacy report-uri body, strips query strings and fragments, drops the referrer, clips the sample', async () => {
    const { res, logs } = await run(post(legacy));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/^csp-report \{/);
    const rec = logged(logs[0]);
    expect(rec).toEqual({
      directive: 'script-src-elem', violated: 'script-src-elem', blocked: 'https://evil.example/x.js', document: 'https://americanflyers.vercel.app/ride',
      source: 'https://americanflyers.vercel.app/assets/app.js', line: 12, column: 34, disposition: 'report', sample: 'a'.repeat(MAX_SAMPLE), browser: 'Chrome',
    });
    expect(logs[0]).not.toMatch(/secret|example\.com\/private|token|frag|Mozilla/);
  });

  it('reads the Reporting API body and ignores other report types', async () => {
    const { res, logs } = await run(post(modern, 'application/reports+json'));
    expect(res.status).toBe(204);
    expect(logs).toHaveLength(1);
    expect(logged(logs[0])).toMatchObject({ directive: 'img-src', blocked: 'https://img.example/a.png', document: 'https://americanflyers.vercel.app/hub', disposition: 'enforce', line: 5, column: 6 });
    expect(logs[0]).not.toMatch(/r\.example|q=1/);
  });

  it('tolerates application/json and a missing content type', async () => {
    expect((await run(post(legacy, 'application/json'))).logs).toHaveLength(1);
    expect((await run(post(modern, 'text/plain'))).logs).toHaveLength(1);
  });

  it('answers 204 and logs nothing for JSON that holds no report', async () => {
    const { res, logs } = await run(post({ hello: 'world' }));
    expect(res.status).toBe(204);
    expect(logs).toEqual([]);
  });

  it('turns a parsed object, a string or a Buffer body into JSON text', () => {
    expect(JSON.parse(bodyToText(legacy))).toEqual(legacy);
    expect(JSON.parse(bodyToText(JSON.stringify(legacy)))).toEqual(legacy);
    expect(JSON.parse(bodyToText(Buffer.from(JSON.stringify(legacy))))).toEqual(legacy);
  });
});

describe('POST /api/csp-report: limits', () => {
  it('405 for anything but POST', async () => {
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const { res, logs } = await run(new Request('https://x.example/api/csp-report', { method }));
      expect(res.status).toBe(405);
      expect(logs).toEqual([]);
    }
  });
  it('413 for a body over 16 kB, without logging', async () => {
    const big = { 'csp-report': { ...legacy['csp-report'], 'script-sample': 'a'.repeat(MAX_BODY_BYTES) } };
    const { res, logs } = await run(post(big));
    expect(res.status).toBe(413);
    expect(logs).toEqual([]);
  });
  it('413 when content-length already says too large', async () => {
    const req = new Request('https://x.example/api/csp-report', { method: 'POST', headers: { 'content-length': String(MAX_BODY_BYTES + 1) }, body: '{}' });
    expect((await run(req)).res.status).toBe(413);
  });
  it('keeps at most 20 reports from one request', async () => {
    const many = Array.from({ length: 50 }, () => ({ type: 'csp-violation', body: { effectiveDirective: 'img-src', blockedURL: 'https://i.example/a.png' } }));
    const { res, logs } = await run(post(many, 'application/reports+json'));
    expect(res.status).toBe(204);
    expect(logs).toHaveLength(MAX_REPORTS);
  });
  it('400 for invalid JSON', async () => {
    const { res, logs } = await run(post('{nope'));
    expect(res.status).toBe(400);
    expect(logs).toEqual([]);
  });
  it('truncates every string field', () => {
    const rec = normaliseReport({ 'effective-directive': 'x'.repeat(1000), 'blocked-uri': 'https://a.example/' + 'p'.repeat(1000), 'document-uri': 'd'.repeat(1000), 'source-file': 's'.repeat(1000), disposition: 'z'.repeat(1000) })!;
    for (const k of ['directive', 'blocked', 'document', 'source'] as const) expect(rec[k].length).toBe(MAX_FIELD);
    expect(rec.disposition.length).toBeLessThanOrEqual(20);
  });
});

describe('POST /api/csp-report: noise and privacy', () => {
  it.each(['chrome-extension://abc/content.js', 'moz-extension://abc/c.js', 'safari-extension://abc/c.js', 'safari-web-extension://abc/c.js', 'webkit-masked-url://hidden/', 'about:blank'])(
    'drops a report whose source file is %s', async (src) => {
      const { res, logs, calls } = await run(post({ 'csp-report': { ...legacy['csp-report'], 'source-file': src } }), 'https://k@o1.ingest.sentry.io/42');
      expect(res.status).toBe(204);
      expect(logs).toEqual([]);
      expect(calls).toEqual([]);
    });
  it('drops a report whose blocked URI is an extension', async () => {
    const { logs } = await run(post({ 'csp-report': { ...legacy['csp-report'], 'blocked-uri': 'chrome-extension://abc/x.js' } }));
    expect(logs).toEqual([]);
    expect((await run(post([{ type: 'csp-violation', body: { effectiveDirective: 'script-src', blockedURL: 'moz-extension://a/b.js' } }], 'application/reports+json'))).logs).toEqual([]);
  });
  it('keeps only the browser family of the User-Agent', () => {
    expect(browserFamily(CHROME)).toBe('Chrome');
    expect(browserFamily('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0')).toBe('Edge');
    expect(browserFamily('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15')).toBe('Safari');
    expect(browserFamily('Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0')).toBe('Firefox');
    expect(browserFamily('curl/8')).toBe('other');
    expect(browserFamily(null)).toBe('other');
  });
  it('strips query strings from URLs that are not http, and keeps keywords', () => {
    expect(normaliseReport({ 'effective-directive': 'script-src', 'blocked-uri': 'inline' })!.blocked).toBe('inline');
    expect(normaliseReport({ 'effective-directive': 'img-src', 'blocked-uri': 'blob:https://a.example/uuid?x=1' })!.blocked).toBe('blob:https://a.example/uuid');
  });
});

describe('POST /api/csp-report: Sentry', () => {
  const DSN = 'https://abc123publickey@o4510.ingest.de.sentry.io/4511223344';

  it('parses a DSN into the security endpoint, and rejects anything else', () => {
    expect(sentryEndpoint(DSN)).toEqual({ url: 'https://o4510.ingest.de.sentry.io/api/4511223344/security/?sentry_key=abc123publickey' });
    expect(sentryEndpoint('https://key:secret@sentry.example.com/7')?.url).toBe('https://sentry.example.com/api/7/security/?sentry_key=key');
    for (const bad of [undefined, null, '', 'not a url', 'http://k@host/1', 'https://host/1', 'https://k@host/', 'https://k@host/abc']) expect(sentryEndpoint(bad)).toBeNull();
  });

  it('forwards the sanitised report in the legacy shape, with a timeout signal, and still answers 204', async () => {
    const { res, calls } = await run(post(legacy), DSN);
    expect(res.status).toBe(204);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://o4510.ingest.de.sentry.io/api/4511223344/security/?sentry_key=abc123publickey');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['content-type']).toBe('application/csp-report');
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toEqual({ 'csp-report': {
      'document-uri': 'https://americanflyers.vercel.app/ride', 'violated-directive': 'script-src-elem', 'effective-directive': 'script-src-elem', 'blocked-uri': 'https://evil.example/x.js',
      'source-file': 'https://americanflyers.vercel.app/assets/app.js', 'line-number': 12, 'column-number': 34, disposition: 'report', 'script-sample': 'a'.repeat(MAX_SAMPLE),
    } });
    expect(String(calls[0].init.body)).not.toMatch(/secret|referrer|original-policy/);
  });

  it('a Sentry failure (a rejection or a 500) never changes the 204 or leaks the DSN', async () => {
    for (const impl of [
      (async () => { throw new Error(`boom ${DSN}`); }) as typeof fetch,
      (async () => new Response('no', { status: 500 })) as typeof fetch,
    ]) {
      const { res, logs } = await run(post(legacy), DSN, impl);
      expect(res.status).toBe(204);
      expect(logs.join('\n')).not.toContain('abc123publickey');
    }
  });

  it('with no DSN, or a bad one, it only logs and never calls fetch', async () => {
    for (const dsn of [undefined, '', 'garbage']) {
      const { res, logs, calls } = await run(post(legacy), dsn);
      expect(res.status).toBe(204);
      expect(logs).toHaveLength(1);
      expect(calls).toEqual([]);
    }
  });

  it('logs every report of a request but forwards at most MAX_FORWARDED of them', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ type: 'csp-violation', body: { effectiveDirective: 'img-src', blockedURL: `https://x.example/${i}.png` } }));
    const { res, logs, calls } = await run(post(many, 'application/reports+json'), DSN);
    expect(res.status).toBe(204);
    expect(logs).toHaveLength(12);
    expect(calls).toHaveLength(MAX_FORWARDED);
  });

  it('does not call Sentry when nothing is kept', async () => {
    const { calls } = await run(post({ hello: 1 }), DSN);
    expect(calls).toEqual([]);
  });
});
