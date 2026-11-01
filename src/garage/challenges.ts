// Weekly challenges. The pool and the pick (one challenge from each family per
// ISO week, chosen by md5(week + id)) mirror public.challenge_pool() and
// public.my_challenges() in db/schema.sql, so a signed-out rider can see what
// they'd earn. The server works out progress from saved rides and pays rewards.

import { md5 } from './md5';

export type Metric = 'climbed_m' | 'km' | 'stages' | 'race_wins' | 'race_podiums' | 'pro_km' | 'days';

export interface ChallengeDef {
  id: string;
  family: string;
  title: string;
  metric: Metric;
  target: number;
  reward: number; // credits
}

export const POOL: ChallengeDef[] = [
  { id: 'climb-1000', family: 'climb', title: 'Climb 1,000 m', metric: 'climbed_m', target: 1000, reward: 80 },
  { id: 'climb-2000', family: 'climb', title: 'Climb 2,000 m', metric: 'climbed_m', target: 2000, reward: 150 },
  { id: 'ride-50', family: 'distance', title: 'Ride 50 km', metric: 'km', target: 50, reward: 80 },
  { id: 'ride-100', family: 'distance', title: 'Ride 100 km', metric: 'km', target: 100, reward: 150 },
  { id: 'stages-1', family: 'stages', title: 'Finish a stage', metric: 'stages', target: 1, reward: 50 },
  { id: 'stages-3', family: 'stages', title: 'Finish 3 stages', metric: 'stages', target: 3, reward: 120 },
  { id: 'race-win', family: 'special', title: 'Win a race', metric: 'race_wins', target: 1, reward: 200 },
  { id: 'race-podium', family: 'special', title: 'Finish on a race podium', metric: 'race_podiums', target: 1, reward: 120 },
  { id: 'pro-20', family: 'special', title: 'Ride with a pro team for 20 km', metric: 'pro_km', target: 20, reward: 120 },
  { id: 'days-4', family: 'special', title: 'Ride on 4 different days', metric: 'days', target: 4, reward: 100 },
];

/** "2026-W44": the ISO week (Monday to Sunday, UTC) a date falls in. */
export function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7; // Monday = 1
  d.setUTCDate(d.getUTCDate() + 4 - day); // the Thursday of this week decides the year
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** The week's challenges: from each family, the one with the lowest md5(week + id). Same order as the server (by family). */
export function challengesForWeek(week: string): ChallengeDef[] {
  const best = new Map<string, { c: ChallengeDef; h: string }>();
  for (const c of POOL) {
    const h = md5(week + c.id);
    const cur = best.get(c.family);
    if (!cur || h < cur.h) best.set(c.family, { c, h });
  }
  return [...best.keys()].sort().map((f) => best.get(f)!.c);
}

/** A challenge with the rider's progress this week, as my_challenges() returns it. */
export interface ChallengeState extends ChallengeDef {
  progress: number;
  claimed: boolean;
}

export interface WeekState {
  week: string;
  endsAt: Date;
  challenges: ChallengeState[];
}

/** my_challenges() JSON to something typed; null if it isn't one. */
export function parseWeek(raw: unknown): WeekState | null {
  const o = raw as { week?: unknown; ends_at?: unknown; challenges?: unknown } | null;
  if (!o || typeof o.week !== 'string' || !Array.isArray(o.challenges)) return null;
  const challenges: ChallengeState[] = [];
  for (const c of o.challenges as Record<string, unknown>[]) {
    if (typeof c.id !== 'string' || typeof c.title !== 'string') continue;
    challenges.push({
      id: c.id, family: POOL.find((p) => p.id === c.id)?.family ?? 'special', title: c.title,
      metric: c.metric as Metric, target: Number(c.target) || 1, reward: Number(c.reward) || 0,
      progress: Number(c.progress) || 0, claimed: c.claimed === true,
    });
  }
  const ends = new Date(String(o.ends_at));
  return { week: o.week, endsAt: Number.isNaN(ends.getTime()) ? new Date(Date.now() + 7 * 86400000) : ends, challenges };
}

/** The week with no progress, for a signed-out rider's preview. */
export function previewWeek(now = new Date()): WeekState {
  const week = isoWeek(now);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() + 8 - (d.getUTCDay() || 7)); // next Monday
  return { week, endsAt: d, challenges: challengesForWeek(week).map((c) => ({ ...c, progress: 0, claimed: false })) };
}

/** "1,240 / 2,000 m" style progress text. */
export function progressText(c: Pick<ChallengeState, 'metric' | 'progress' | 'target'>, imperial = false): string {
  const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
  const p = Math.min(c.progress, c.target);
  switch (c.metric) {
    case 'climbed_m': return imperial ? `${fmt(p * 3.28084)} / ${fmt(c.target * 3.28084)} ft` : `${fmt(p)} / ${fmt(c.target)} m`;
    case 'km':
    case 'pro_km': return imperial ? `${fmt(p / 1.609344)} / ${fmt(c.target / 1.609344)} mi` : `${fmt(p)} / ${fmt(c.target)} km`;
    default: return `${fmt(p)} / ${fmt(c.target)}`;
  }
}

export const isComplete = (c: Pick<ChallengeState, 'progress' | 'target'>) => c.progress >= c.target;
