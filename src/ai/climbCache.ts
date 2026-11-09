// Climb guide answers kept in the browser for 24 hours, per stage and topic, so opening a guide again doesn't
// spend the day's quota. Every read and write is wrapped: private windows and blocked storage just mean no cache.
// Whatever is read back goes through the sanitizer again, so a tampered entry can't put anything odd on screen.

import { sanitizeClimbGuide } from './sanitize';
import type { ClimbResult } from './types';

export const CLIMB_CACHE_MS = 24 * 60 * 60 * 1000;
const PREFIX = 'americanflyers.climbGuide.v1.';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const defaultStore = (): Store | null => {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
};

export const climbCacheKey = (stageId: string, topic: string) => `${PREFIX}${stageId}.${topic}`;

/** The saved answer for this stage and topic if it is under 24 hours old, else null. */
export function readClimbCache(stageId: string, topic: ClimbResult['topic'], now = Date.now(), store: Store | null = defaultStore()): ClimbResult | null {
  try {
    const raw = store?.getItem(climbCacheKey(stageId, topic));
    if (!raw) return null;
    const entry = JSON.parse(raw) as { at?: unknown; data?: unknown };
    if (typeof entry.at !== 'number' || now - entry.at >= CLIMB_CACHE_MS || entry.at > now + 60_000) {
      store?.removeItem(climbCacheKey(stageId, topic));
      return null;
    }
    const d = entry.data as Partial<ClimbResult> | null;
    return sanitizeClimbGuide(d, stageId, topic, typeof d?.asOf === 'string' ? d.asOf.slice(0, 10) : '');
  } catch {
    return null;
  }
}

export function writeClimbCache(data: ClimbResult, now = Date.now(), store: Store | null = defaultStore()): void {
  try {
    store?.setItem(climbCacheKey(data.stageId, data.topic), JSON.stringify({ at: now, data }));
  } catch { /* storage full or blocked: the answer just isn't kept */ }
}
