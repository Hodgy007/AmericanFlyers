// The Neon Data API, called with the rider's own token. `ai_claim` is the gate:
// it checks sign-in, opt-in, ban and the day's quota in the database and hands
// back what the prompt may say about the rider.

import { z } from 'zod';

export const DEFAULT_DATA_API_URL = 'https://ep-winter-voice-za03vb20.apirest.c-2.eu-west-2.aws.neon.tech/neondb/rest/v1';

const ClaimOk = z.object({
  ok: z.literal(true),
  name: z.string().max(40),
  ftp: z.number().nullable().optional(),
  weight_kg: z.number().nullable().optional(),
  last4w: z.object({ rides: z.number(), hours: z.number(), km: z.number(), climbed_m: z.number(), tss: z.number() }),
  rivals: z.array(z.object({
    rival: z.string(), wins: z.number(), losses: z.number(), rides: z.number(),
    last_ride: z.string().nullable(), notes: z.array(z.string()),
  })),
  used: z.number(),
  limit: z.number(),
});
const ClaimNo = z.object({ ok: z.literal(false), reason: z.enum(['no_consent', 'banned', 'quota']), limit: z.number().optional() });

export interface Claim {
  name: string;
  ftp: number | null;
  weight_kg: number | null;
  last4w: { rides: number; hours: number; km: number; climbed_m: number; tss: number };
  rivals: { rival: string; wins: number; losses: number; rides: number; last_ride: string | null; notes: string[] }[];
  used: number;
  limit: number;
}

export type ClaimResult =
  | { kind: 'ok'; claim: Claim }
  | { kind: 'denied'; reason: 'no_consent' | 'banned' | 'quota'; limit?: number }
  | { kind: 'sign_in' }
  | { kind: 'unavailable' };

export interface DataApi {
  url: string;
  fetch: typeof fetch;
}

async function rpc(api: DataApi, name: string, args: Record<string, unknown>, token: string) {
  return api.fetch(`${api.url.replace(/\/$/, '')}/rpc/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(8000),
  });
}

/** Calls ai_claim with the rider's JWT. A token the database rejects is "sign in again"; anything odd is "unavailable". */
export async function claim(api: DataApi, token: string, kind: string, rival: string | null): Promise<ClaimResult> {
  let res: Response;
  try {
    res = await rpc(api, 'ai_claim', { p_kind: kind, p_rival: rival }, token);
  } catch {
    return { kind: 'unavailable' };
  }
  if (res.status === 401 || res.status === 403) return { kind: 'sign_in' };
  if (!res.ok) return { kind: 'unavailable' };
  const body: unknown = await res.json().catch(() => null);
  const ok = ClaimOk.safeParse(body);
  if (ok.success) {
    const c = ok.data;
    return { kind: 'ok', claim: { ...c, ftp: c.ftp ?? null, weight_kg: c.weight_kg ?? null } };
  }
  const no = ClaimNo.safeParse(body);
  if (no.success) return { kind: 'denied', reason: no.data.reason, limit: no.data.limit };
  return { kind: 'unavailable' };
}

/** After a rival ride that counts: adds the result and the note to the rider's memory of that rival. Failures are only logged. */
export async function recordRival(api: DataApi, token: string, rival: string, won: boolean, note: string): Promise<boolean> {
  try {
    const res = await rpc(api, 'rival_record', { p_rival: rival, p_won: won, p_note: note }, token);
    return res.ok;
  } catch {
    return false;
  }
}
