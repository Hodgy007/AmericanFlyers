// Vercel function behind /api/auth/* (vercel.json rewrites it here with the sub-path in
// ?__path=…): passes sign-in requests to Neon Auth so its cookie is first-party.
// See _lib/authProxy.ts. NEON_AUTH_URL overrides the Neon Auth base URL.

import { DEFAULT_NEON_AUTH_URL, proxyAuth } from './_lib/authProxy.js';

export default {
  fetch(request: Request): Promise<Response> {
    return proxyAuth(request, process.env.NEON_AUTH_URL || DEFAULT_NEON_AUTH_URL);
  },
};
