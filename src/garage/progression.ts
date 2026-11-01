// Levels, XP and credits. The server (public.wallet_of, db/schema.sql) is the
// source of truth and works these out from your saved rides; this is the same
// maths for showing progress, and for estimating what a ride just earned.

export const MAX_LEVEL = 50;

/** XP needed to reach level `n` (level 1 = 0): a gentle curve, 100 * (n - 1)^1.6. Matches public.level_xp(). */
export function levelXp(n: number): number {
  return Math.round(100 * Math.pow(Math.max(n, 1) - 1, 1.6));
}

/** The level an XP total reaches, 1 to 50. */
export function levelForXp(xp: number): number {
  let level = 1;
  for (let n = 2; n <= MAX_LEVEL; n++) if (levelXp(n) <= xp) level = n;
  return level;
}

/** XP and credits for riding, as the server counts them (before challenge rewards). */
export function rideRewards(km: number, climbedM: number) {
  const k = Math.max(0, km);
  const c = Math.max(0, climbedM);
  return { credits: Math.floor(k + c / 10), xp: Math.floor(k * 5 + c * 0.5) };
}

/** What my_wallet() returns. */
export interface Wallet {
  level: number;
  xp: number;
  xpThis: number; // XP at the start of this level
  xpNext: number | null; // XP needed for the next level (null at the top)
  creditsEarned: number;
  creditsSpent: number;
  balance: number;
  km: number;
  climbedM: number;
  rides: number;
  challengesDone: number;
  owned: string[];
}

const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : fallback);

/** A wallet from the server's JSON; null if it isn't one. */
export function parseWallet(raw: unknown): Wallet | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.level === undefined || o.balance === undefined) return null;
  return {
    level: Math.min(MAX_LEVEL, Math.max(1, Math.round(num(o.level, 1)))),
    xp: num(o.xp),
    xpThis: num(o.xp_this),
    xpNext: o.xp_next === null || o.xp_next === undefined ? null : num(o.xp_next),
    creditsEarned: num(o.credits_earned),
    creditsSpent: num(o.credits_spent),
    balance: num(o.balance),
    km: num(o.km),
    climbedM: num(o.climbed_m),
    rides: num(o.rides),
    challengesDone: num(o.challenges_done),
    owned: Array.isArray(o.owned) ? o.owned.filter((x): x is string => typeof x === 'string') : [],
  };
}

/** How far through the current level, 0 to 1 (1 at the top level). */
export function levelFraction(w: Pick<Wallet, 'xp' | 'xpThis' | 'xpNext'>): number {
  if (w.xpNext === null) return 1;
  const span = w.xpNext - w.xpThis;
  return span > 0 ? Math.min(1, Math.max(0, (w.xp - w.xpThis) / span)) : 0;
}

const TITLES = ['Rookie', 'Weekend Rider', 'Club Rider', 'Breakaway Artist', 'Domestique', 'Climber', 'Road Captain', 'Pro', 'Legend', 'Flyer'];
/** A friendly title for a level (a new one every five levels). */
export function levelTitle(level: number): string {
  return TITLES[Math.min(TITLES.length - 1, Math.floor((Math.max(1, level) - 1) / 5))];
}
