// Error reporting with Sentry. Off unless the build has a DSN (see
// vite.config.ts). Only crashes and slow-page samples are sent: no names,
// emails, IP-based details or session replays. Signed-in riders are tagged
// by their account id only.

// The Sentry SDK is big and nothing on the first frame needs it, so it is loaded
// after the first frame (startMonitoring). Until then, crashes are noted by two
// tiny listeners and handed to Sentry once it is up, so none are lost.

declare const __SENTRY_DSN__: string;
declare const __RELEASE__: string;

type SentryModule = typeof import('@sentry/browser');

let sentry: SentryModule | null = null;
let starting = false;
const early: unknown[] = []; // errors from before Sentry arrived (capped)
let pendingUser: string | null | undefined;
let pendingTags: Record<string, string> = {};

const noteError = (e: ErrorEvent) => { if (early.length < 20) early.push(e.error ?? e.message); };
const noteRejection = (e: PromiseRejectionEvent) => { if (early.length < 20) early.push(e.reason); };

/** Call first, so a crash while the app starts is noticed. Does nothing without a DSN. */
export function initMonitoring() {
  if (!__SENTRY_DSN__ || import.meta.env.DEV) return;
  window.addEventListener('error', noteError);
  window.addEventListener('unhandledrejection', noteRejection);
  // Normally main.ts starts it after the first frame; this is the safety net.
  window.setTimeout(startMonitoring, 8000);
}

/** Loads Sentry and switches it on (once). Call after the first frame is on screen. */
export function startMonitoring() {
  if (!__SENTRY_DSN__ || import.meta.env.DEV || starting) return;
  starting = true;
  import('@sentry/browser').then((Sentry) => {
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
    sentry = Sentry;
    window.removeEventListener('error', noteError);
    window.removeEventListener('unhandledrejection', noteRejection);
    if (pendingUser !== undefined) setMonitoringUser(pendingUser);
    if (Object.keys(pendingTags).length) Sentry.setTags(pendingTags);
    for (const e of early.splice(0)) Sentry.captureException(e);
  }).catch(() => { starting = false; /* offline: the safety net doesn't repeat; reports are skipped */ });
}

/** Tags reports with the signed-in rider's account id (never their name or email). */
export function setMonitoringUser(id: string | null) {
  if (sentry) sentry.setUser(id ? { id } : null);
  else pendingUser = id;
}

/** Context that helps reproduce a problem: stage, trainer, workout. */
export function setMonitoringContext(ctx: Record<string, string | null>) {
  const tags = Object.fromEntries(Object.entries(ctx).map(([k, v]) => [k, v ?? 'none']));
  if (sentry) sentry.setTags(tags);
  else pendingTags = { ...pendingTags, ...tags };
}
