// The signed-in rider's Neon token: the same JWT the Data API client sends with
// every query. api/ai.ts receives it and passes it on to the database, which
// decides who the rider is. Neon's auth adapter swaps the session token for the
// JWT (the `set-auth-jwt` header), so getSession() hands it back as session.token.

import { neon } from './client';

/** The rider's Data API token, or null when signed out or the session can't be read. */
export async function dataApiToken(): Promise<string | null> {
  try {
    const { data } = await neon.auth.getSession();
    const t = data?.session?.token;
    return typeof t === 'string' && t.split('.').length === 3 ? t : null;
  } catch {
    return null;
  }
}
