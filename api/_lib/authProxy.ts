// Passes sign-in requests from our own origin (/api/auth/*) to Neon Auth, so the
// session cookie Neon sets is first-party: Safari blocks it as a third-party cookie
// when the browser talks to Neon's domain directly. A plain Vercel rewrite can't be
// used: it adds X-Forwarded-Host, and Neon Auth rejects that ("Invalid hostname
// header"). This forwards a clean request and returns Neon's response unchanged,
// including every Set-Cookie and the set-auth-jwt header.

export const DEFAULT_NEON_AUTH_URL = 'https://ep-winter-voice-za03vb20.neonauth.c-2.eu-west-2.aws.neon.tech/neondb/auth';

/** The query parameter vercel.json uses to pass the path after /api/auth/. */
export const PATH_PARAM = '__path';

// Request headers not passed on: hop-by-hop, ones that describe our hop rather than the
// browser's request (Neon rejects X-Forwarded-Host), and compression (fetch decodes it).
const DROP_REQUEST = new Set([
  'host', 'connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer',
  'content-length', 'accept-encoding', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port', 'forwarded', 'x-real-ip',
]);
// Response headers not passed back: hop-by-hop, and the encoding/length of a body fetch already decoded.
const DROP_RESPONSE = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'content-length', 'set-cookie']);

const QUERY_NAME = /^[a-zA-Z0-9_]{1,32}$/;
const MAX_QUERY_VALUE = 512;

/** The query parameters we pass on: plain names with short values. */
export function filterQuery(params: URLSearchParams): URLSearchParams {
  // Sign-in flows never need a redirect parameter: the callback lives in our own origin, so any
  // redirect/callback parameter is an open-redirect attempt and is dropped.
  const out = new URLSearchParams();
  params.forEach((value, name) => {
    if (!QUERY_NAME.test(name) || value.length > MAX_QUERY_VALUE) return;
    if (/redirect|callback/i.test(name)) return;
    out.append(name, value);
  });
  return out;
}

/** Where a proxied request goes: Neon Auth plus the sub-path and the original query (minus our path parameter). */
export function targetUrl(requestUrl: string, base = DEFAULT_NEON_AUTH_URL): URL | null {
  const url = new URL(requestUrl);
  const sub = url.searchParams.get(PATH_PARAM) ?? url.pathname.replace(/^\/api\/auth\/?/, '');
  url.searchParams.delete(PATH_PARAM);
  if (!/^[A-Za-z0-9._~\-/]*$/.test(sub) || sub.split('/').some((p) => p === '..' || p === '.')) return null;
  const target = new URL(`${base.replace(/\/+$/, '')}/${sub.replace(/^\/+/, '')}`);
  target.search = filterQuery(url.searchParams).toString();
  return target;
}

export function forwardHeaders(incoming: Headers): Headers {
  const out = new Headers();
  incoming.forEach((value, key) => {
    const k = key.toLowerCase();
    if (DROP_REQUEST.has(k) || k.startsWith('x-vercel-')) return;
    out.set(k, value);
  });
  return out;
}

export async function proxyAuth(request: Request, base = DEFAULT_NEON_AUTH_URL, doFetch: typeof fetch = fetch): Promise<Response> {
  const target = targetUrl(request.url, base);
  if (!target) return Response.json({ error: 'bad path' }, { status: 400 });
  const init: RequestInit = { method: request.method, headers: forwardHeaders(request.headers), redirect: 'manual' };
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = await request.arrayBuffer();
  let res: Response;
  try {
    res = await doFetch(target, init);
  } catch {
    return Response.json({ error: 'auth unreachable' }, { status: 502 });
  }
  const headers = new Headers();
  res.headers.forEach((value, key) => { if (!DROP_RESPONSE.has(key.toLowerCase())) headers.set(key, value); });
  for (const cookie of res.headers.getSetCookie()) headers.append('set-cookie', cookie);
  headers.set('cache-control', 'no-store'); // sign-in state is never cached
  return new Response(request.method === 'HEAD' ? null : res.body, { status: res.status, statusText: res.statusText, headers });
}
