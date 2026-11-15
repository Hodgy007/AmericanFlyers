// Collects Content-Security-Policy violation reports (POST /api/csp-report; see api/csp-report.ts).
// The browser sends one of two shapes: the legacy `report-uri` body ({"csp-report": {...}}, kebab-case keys,
// Content-Type application/csp-report) or the Reporting API's `report-to` body (an array of
// {type: "csp-violation", body: {...}}, camelCase keys, application/reports+json). Both are reduced to the same small record.
// Privacy: query strings and fragments are stripped from every URL, the referrer is dropped, nothing identifying the
// rider (cookies, IP address, the full User-Agent) is kept; only a coarse browser family.

export const MAX_BODY_BYTES = 16 * 1024;
export const MAX_REPORTS = 20;
export const MAX_FIELD = 300;
export const MAX_SAMPLE = 80;
export const SENTRY_TIMEOUT_MS = 2000;
/** At most this many reports of one request go on to Sentry (all are logged): anyone can POST here, and it must not be a way to spend the Sentry quota. */
export const MAX_FORWARDED = 5;

export interface CspRecord {
  directive: string;
  violated: string;
  blocked: string;
  document: string;
  source: string;
  line: number | null;
  column: number | null;
  disposition: string;
  sample: string;
  browser: string;
}

export interface SentryTarget { url: string }

/** Reports from browser extensions are noise: skip any whose source file or blocked URI starts with one of these. */
const NOISE_PREFIXES = ['chrome-extension:', 'moz-extension:', 'safari-extension:', 'safari-web-extension:', 'webkit-masked-url:', 'about:'];

const clip = (s: string, n = MAX_FIELD): string => s.slice(0, n);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);

/** A URL without its query string and fragment, truncated. Keywords such as "inline" or "eval" pass through. */
export function stripUrl(v: unknown): string {
  return clip(str(v).trim().split(/[?#]/)[0]);
}

/** Chrome, Safari, Firefox, Edge or other: never the full User-Agent string. */
export function browserFamily(ua: string | null | undefined): string {
  const s = ua ?? '';
  if (/Edg(e|A|iOS)?\//.test(s)) return 'Edge';
  if (/Firefox\/|FxiOS\//.test(s)) return 'Firefox';
  if (/Chrome\/|CriOS\//.test(s)) return 'Chrome';
  if (/Safari\//.test(s) && /Version\//.test(s)) return 'Safari';
  return 'other';
}

export function isNoise(source: string, blocked: string): boolean {
  const s = source.toLowerCase();
  const b = blocked.toLowerCase();
  return NOISE_PREFIXES.some((p) => s.startsWith(p) || b.startsWith(p));
}

/** One report body (either key style) to a record, or null when it is not an object or is extension noise. */
export function normaliseReport(raw: unknown, browser = 'other'): CspRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const pick = (camel: string, kebab: string): unknown => r[camel] ?? r[kebab];
  const violated = clip(str(pick('violatedDirective', 'violated-directive')));
  const directive = clip(str(pick('effectiveDirective', 'effective-directive'))) || violated;
  const blocked = stripUrl(pick('blockedURL', 'blocked-uri') ?? r.blockedURI);
  const source = stripUrl(pick('sourceFile', 'source-file'));
  if (isNoise(source, blocked)) return null;
  return {
    directive,
    violated: violated || directive,
    blocked,
    document: stripUrl(pick('documentURL', 'document-uri') ?? r.documentURI),
    source,
    line: num(pick('lineNumber', 'line-number')),
    column: num(pick('columnNumber', 'column-number')),
    disposition: clip(str(r.disposition), 20),
    sample: clip(str(r.sample ?? r['script-sample']), MAX_SAMPLE),
    browser,
  };
}

/** The report bodies in a parsed request body, in either format, at most MAX_REPORTS of them. */
export function extractReports(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) {
    return parsed
      .filter((e) => e && typeof e === 'object' && (e as Record<string, unknown>).type === 'csp-violation')
      .map((e) => (e as Record<string, unknown>).body)
      .slice(0, MAX_REPORTS);
  }
  if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>;
    if ('csp-report' in o) return [o['csp-report']];
    if (o.type === 'csp-violation' && 'body' in o) return [o.body];
  }
  return [];
}

/** The sanitised records for a parsed body: extracted, normalised, extension noise dropped. */
export function recordsFrom(parsed: unknown, browser = 'other'): CspRecord[] {
  return extractReports(parsed).map((r) => normaliseReport(r, browser)).filter((r): r is CspRecord => r !== null);
}

/** `https://<publicKey>@<host>/<projectId>` to Sentry's CSP endpoint; null for anything else. */
export function sentryEndpoint(dsn: string | undefined | null): SentryTarget | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn.trim());
    const projectId = u.pathname.split('/').filter(Boolean).pop();
    if (u.protocol !== 'https:' || !u.username || !projectId || !/^\d+$/.test(projectId)) return null;
    return { url: `https://${u.host}/api/${projectId}/security/?sentry_key=${encodeURIComponent(decodeURIComponent(u.username))}` };
  } catch {
    return null;
  }
}

/** The record as the legacy {"csp-report": {...}} body Sentry's security endpoint takes. No original-policy: it is long and known. */
export function sentryBody(rec: CspRecord): string {
  const report: Record<string, unknown> = {
    'document-uri': rec.document,
    'violated-directive': rec.violated,
    'effective-directive': rec.directive,
    'blocked-uri': rec.blocked,
    'source-file': rec.source,
    'line-number': rec.line ?? undefined,
    'column-number': rec.column ?? undefined,
    disposition: rec.disposition || undefined,
    'script-sample': rec.sample || undefined,
  };
  return JSON.stringify({ 'csp-report': report });
}

/** A request or parsed body (string, Buffer, Uint8Array or already-parsed object) as JSON text. */
export function bodyToText(body: unknown): string {
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  return JSON.stringify(body ?? null);
}

/** Reads the request body as text, giving up (null) once it passes MAX_BODY_BYTES. */
export async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) { await reader.cancel().catch(() => undefined); return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return bodyToText(all);
}

export interface CspReportDeps {
  dsn?: string | undefined;
  fetch?: typeof fetch;
  log?: (line: string) => void;
}

const empty = (status: number): Response => new Response(null, { status, headers: { 'cache-control': 'no-store' } });

export async function handleCspReport(request: Request, deps: CspReportDeps = {}): Promise<Response> {
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  const text = await readBody(request);
  if (text === null) return empty(413);
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return empty(400); }
  const records = recordsFrom(parsed, browserFamily(request.headers.get('user-agent')));
  const log = deps.log ?? ((line: string) => console.warn(line));
  for (const rec of records) log(`csp-report ${JSON.stringify(rec)}`);
  const target = sentryEndpoint(deps.dsn);
  const doFetch = deps.fetch ?? fetch;
  if (target && records.length) {
    await Promise.allSettled(records.slice(0, MAX_FORWARDED).map(async (rec) => {
      await doFetch(target.url, {
        method: 'POST',
        headers: { 'content-type': 'application/csp-report' },
        body: sentryBody(rec),
        signal: AbortSignal.timeout(SENTRY_TIMEOUT_MS),
      });
    }));
  }
  return empty(204);
}
