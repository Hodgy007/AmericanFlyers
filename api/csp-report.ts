// Vercel function: POST /api/csp-report. The Content-Security-Policy's report-uri / report-to endpoint (csp.mjs).
// Logs each violation as one `csp-report {...}` line (search the Vercel logs for it) and, when a Sentry DSN is set,
// forwards it to Sentry's security endpoint. See _lib/cspReport.ts for what is kept and what is stripped.
// Environment: VITE_SENTRY_DSN, NEXT_PUBLIC_SENTRY_DSN or SENTRY_DSN (optional, the first one set is used, as in vite.config.ts).

import { handleCspReport } from './_lib/cspReport.js';

export default {
  async fetch(request: Request): Promise<Response> {
    return handleCspReport(request, {
      dsn: process.env.VITE_SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN,
      fetch,
      log: (line) => console.warn(line),
    });
  },
};
