// The browser's side of the AI features: asking /api/ai (the Vercel function),
// and the database calls for opting in, rival memory and saved debriefs. Every
// call is allowed to fail: the ride never waits on the AI and always has canned
// text to fall back on. Nothing here throws.

import { account } from './account';
import { neon } from './client';
import { dataApiToken } from './token';
import type { AiError, AiKind, AiPayloads, AiReply, AiResults, DebriefResult } from '../ai/types';

export const AI_ENDPOINT = '/api/ai';
export const AI_TIMEOUT_MS = 15_000;

export type AiOutcome<K extends AiKind> = AiReply<K> | AiError;

/** Sends one request to /api/ai with the rider's token. A signed-out rider, a network error or a timeout comes back as an AiError. */
export async function askAi<K extends AiKind>(kind: K, payload: AiPayloads[K], fetcher: typeof fetch = fetch): Promise<AiOutcome<K>> {
  if (!account()) return { ok: false, error: 'sign_in', message: 'Sign in to use the AI coach and rivals.' };
  const token = await dataApiToken();
  if (!token) return { ok: false, error: 'sign_in', message: 'Please sign in again to use the AI.' };
  try {
    const res = await fetcher(AI_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ kind, payload }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as AiOutcome<K> | null;
    if (body && typeof body === 'object' && 'ok' in body) return body;
    return { ok: false, error: 'unavailable', message: 'The AI is taking a break.' };
  } catch {
    return { ok: false, error: 'unavailable', message: 'The AI couldn’t be reached.' };
  }
}

export type { AiResults };

// ------------------------------------------------------------- consent ----

export interface AiConsent { coach: boolean; rivals: boolean }

export async function loadConsent(): Promise<AiConsent | null> {
  if (!account()) return null;
  try {
    const { data, error } = await neon.rpc('my_ai_consent');
    if (error || !data) return null;
    const c = data as Partial<AiConsent>;
    return { coach: c.coach === true, rivals: c.rivals === true };
  } catch {
    return null;
  }
}

/** Saves the rider's opt-in choices in the database (the server enforces them). Returns what was saved, or null on failure. */
export async function saveConsent(c: AiConsent): Promise<AiConsent | null> {
  try {
    const { data, error } = await neon.rpc('set_ai_consent', { p_coach: c.coach, p_rivals: c.rivals });
    if (error || !data) return null;
    const d = data as Partial<AiConsent>;
    return { coach: d.coach === true, rivals: d.rivals === true };
  } catch {
    return null;
  }
}

// ------------------------------------------------------- rival memory ----

export interface RivalRecord { rival: string; wins: number; losses: number; rides: number; last_ride: string | null; notes: string[] }

export async function myRivals(): Promise<RivalRecord[]> {
  if (!account()) return [];
  try {
    const { data, error } = await neon.rpc('my_rivals');
    if (error || !Array.isArray(data)) return [];
    return (data as RivalRecord[]).map((r) => ({ ...r, notes: Array.isArray(r.notes) ? r.notes.filter((n) => typeof n === 'string') : [] }));
  } catch {
    return [];
  }
}

/** Forgets one rival's memory of you, or all of them when no id is given. */
export async function forgetRival(id?: string): Promise<boolean> {
  try {
    const { error } = await neon.rpc('forget_rival', { p_rival: id ?? null });
    return !error;
  } catch {
    return false;
  }
}

// -------------------------------------------------------- saved debriefs ----

export async function saveDebrief(activityId: string, d: DebriefResult): Promise<boolean> {
  try {
    const { error } = await neon.rpc('save_coach_debrief', { p_activity: activityId, p_debrief: d });
    return !error;
  } catch {
    return false;
  }
}

export async function loadDebrief(activityId: string): Promise<DebriefResult | null> {
  if (!account()) return null;
  try {
    const { data, error } = await neon.rpc('my_coach_debrief', { p_activity: activityId });
    if (error || !data) return null;
    return data as DebriefResult;
  } catch {
    return null;
  }
}
