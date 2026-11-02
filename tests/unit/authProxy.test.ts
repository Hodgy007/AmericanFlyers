import { describe, expect, it } from 'vitest';
import { PATH_PARAM, forwardHeaders, proxyAuth, targetUrl } from '../../api/_lib/authProxy';

const BASE = 'https://neon.example/neondb/auth';

describe('auth proxy', () => {
  it('maps /api/auth/<path> (via the rewrite parameter) to Neon Auth, keeping the query', () => {
    expect(targetUrl(`https://af.example/api/auth-proxy?${PATH_PARAM}=get-session&neon_auth_session_verifier=abc`, BASE)!.href)
      .toBe('https://neon.example/neondb/auth/get-session?neon_auth_session_verifier=abc');
    expect(targetUrl(`https://af.example/api/auth-proxy?${PATH_PARAM}=sign-in/social`, BASE)!.href).toBe('https://neon.example/neondb/auth/sign-in/social');
    expect(targetUrl('https://af.example/api/auth/token', BASE)!.href).toBe('https://neon.example/neondb/auth/token'); // without the rewrite (local)
  });

  it('refuses paths that try to climb out', () => {
    expect(targetUrl(`https://af.example/api/auth-proxy?${PATH_PARAM}=../../admin`, BASE)).toBeNull();
    expect(targetUrl(`https://af.example/api/auth-proxy?${PATH_PARAM}=a%20b`, BASE)).toBeNull();
  });

  it('drops X-Forwarded-Host (Neon rejects it) and hop-by-hop headers, keeps cookies and Origin', () => {
    const h = forwardHeaders(new Headers({
      host: 'af.example', 'x-forwarded-host': 'af.example', 'x-vercel-id': '1', 'accept-encoding': 'gzip', connection: 'keep-alive',
      cookie: '__Secure-neon-auth.session_token=x', origin: 'https://af.example', 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4',
    }));
    expect(h.get('x-forwarded-host')).toBeNull();
    expect(h.get('host')).toBeNull();
    expect(h.get('x-vercel-id')).toBeNull();
    expect(h.get('accept-encoding')).toBeNull();
    expect(h.get('cookie')).toBe('__Secure-neon-auth.session_token=x');
    expect(h.get('origin')).toBe('https://af.example');
    expect(h.get('x-forwarded-for')).toBe('1.2.3.4');
  });

  it('passes every Set-Cookie, set-auth-jwt, the status and the body back; never cached', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fake = (async (url: URL | RequestInfo, init?: RequestInit) => {
      seen = { url: String(url), init: init! };
      const headers = new Headers({ 'content-type': 'application/json', 'set-auth-jwt': 'jwt123', 'content-encoding': 'gzip' });
      headers.append('set-cookie', 'a=1; Path=/; HttpOnly; Secure');
      headers.append('set-cookie', 'b=2; Path=/; HttpOnly; Secure');
      return new Response('{"user":{"id":"u1"}}', { status: 200, headers });
    }) as typeof fetch;
    const res = await proxyAuth(new Request(`https://af.example/api/auth-proxy?${PATH_PARAM}=sign-in/email`, {
      method: 'POST', body: '{"email":"a@b.c"}', headers: { 'content-type': 'application/json', 'x-forwarded-host': 'af.example' },
    }), BASE, fake);
    expect(seen!.url).toBe('https://neon.example/neondb/auth/sign-in/email');
    expect(seen!.init.method).toBe('POST');
    expect(new TextDecoder().decode(seen!.init.body as ArrayBuffer)).toBe('{"email":"a@b.c"}');
    expect((seen!.init.headers as Headers).get('x-forwarded-host')).toBeNull();
    expect(seen!.init.redirect).toBe('manual');
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toEqual(['a=1; Path=/; HttpOnly; Secure', 'b=2; Path=/; HttpOnly; Secure']);
    expect(res.headers.get('set-auth-jwt')).toBe('jwt123');
    expect(res.headers.get('content-encoding')).toBeNull();
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ user: { id: 'u1' } });
  });

  it('answers 502 when Neon cannot be reached', async () => {
    const res = await proxyAuth(new Request(`https://af.example/api/auth-proxy?${PATH_PARAM}=get-session`), BASE, (async () => { throw new Error('down'); }) as typeof fetch);
    expect(res.status).toBe(502);
  });
});
