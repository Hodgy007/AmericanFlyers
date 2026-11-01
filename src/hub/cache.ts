// What the hub remembers between visits so it can paint at once: who you were, your garage
// wallet and the summary of your rides. It is only a head start; the account is asked again and
// the numbers on screen are replaced when it answers. Kept in localStorage; every read and write
// is allowed to fail (private windows, blocked storage).

import type { Wallet } from '../garage/progression';
import type { Summary } from './data';

const KEY = 'americanflyers.hub';
const STAGE_KEY = 'americanflyers.hubStage';

export interface HubCache {
  v: 1;
  userId: string;
  name: string;
  wallet: Wallet | null;
  summary: Summary | null;
}

export function loadCache(): HubCache | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as HubCache;
    return c && c.v === 1 && typeof c.userId === 'string' ? c : null;
  } catch {
    return null;
  }
}

export function saveCache(c: HubCache) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    // not remembered: the next visit just paints with placeholders for a moment
  }
}

export function clearCache() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}

/** The stage you last started a ride on from the hub. */
export function loadStageChoice(): string | null {
  try {
    return localStorage.getItem(STAGE_KEY);
  } catch {
    return null;
  }
}

export function saveStageChoice(id: string) {
  try {
    localStorage.setItem(STAGE_KEY, id);
  } catch {
    // fine
  }
}
