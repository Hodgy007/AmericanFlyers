// Error reporting with Sentry. Off unless the build has a DSN (see
// vite.config.ts). Only crashes and slow-page samples are sent: no names,
// emails, IP-based details or session replays. Signed-in riders are tagged
// by their account id only.

import * as Sentry from '@sentry/browser';

declare const __SENTRY_DSN__: string;
declare const __RELEASE__: string;

let on = false;

export function initMonitoring() {
  if (!__SENTRY_DSN__ || import.meta.env.DEV) return;
  on = true;
  Sentry.init({
    dsn: __SENTRY_DSN__,
    release: __RELEASE__ || undefined,
    environment: location.hostname === 'americanflyers.vercel.app' ? 'production' : 'preview',
    // Collect as little as possible: no user details, cookies, headers,
    // request bodies or URL query strings (which could hold a reset token).
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.1,
    ignoreErrors: [
      // The rider closed the Bluetooth device chooser.
      /User cancelled the requestDevice/i,
      /NotFoundError/,
      'ResizeObserver loop',
      // Browsers that block autoplay or audio until a click.
      /play\(\) request was interrupted/i,
      /NotAllowedError/,
    ],
    beforeSend(event) {
      // Never send a password-reset token that might be in the address.
      const scrub = (url?: string) => url?.replace(/([?&]token=)[^&#]+/g, '$1[removed]');
      if (event.request?.url) event.request.url = scrub(event.request.url);
      for (const b of event.breadcrumbs ?? []) {
        if (typeof b.data?.url === 'string') b.data.url = scrub(b.data.url);
        if (typeof b.data?.to === 'string') b.data.to = scrub(b.data.to);
        if (typeof b.data?.from === 'string') b.data.from = scrub(b.data.from);
      }
      return event;
    },
  });
}

/** Tags reports with the signed-in rider's account id (never their name or email). */
export function setMonitoringUser(id: string | null) {
  if (on) Sentry.setUser(id ? { id } : null);
}

/** Context that helps reproduce a problem: stage, trainer, workout. */
export function setMonitoringContext(ctx: Record<string, string | null>) {
  if (on) Sentry.setTags(Object.fromEntries(Object.entries(ctx).map(([k, v]) => [k, v ?? 'none'])));
}
