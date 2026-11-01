// "Download my data" and "Delete my account". Both only ever touch the signed-in
// rider's own rows: reads go through row-level security, and the database
// function delete_my_account() checks who is calling (see db/schema.sql).

import { account, signOut } from './account';
import { neon } from './client';

/** What the rider types to confirm deleting their account. */
export const DELETE_PHRASE = 'DELETE';

export const confirmsDeletion = (typed: string) => typed.trim().toUpperCase() === DELETE_PHRASE;

export const dataFileName = (d = new Date()) => `american-flyers-my-data-${d.toISOString().slice(0, 10)}.json`;

/** Removes our internal `user_id` column from rows (the rider's own id is in `account`). */
function stripUserIds<T>(v: T): T {
  if (Array.isArray(v)) return v.map(stripUserIds) as T;
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => k !== 'user_id').map(([k, x]) => [k, stripUserIds(x)])) as T;
  }
  return v;
}

export interface DataParts {
  account?: unknown;
  profile?: unknown;
  workouts?: unknown[];
  routes?: unknown[];
  activities?: unknown[];
  ftp_history?: unknown[];
  feedback?: unknown[];
  /** The result of the my_data_extras() database function. */
  extras?: Record<string, unknown> | null;
  now?: Date;
}

/** Puts the pieces into the single JSON document the rider downloads. */
export function tidyDataExport(p: DataParts): Record<string, unknown> {
  const { extras, now, ...rest } = p;
  return stripUserIds({
    exported_at: (now ?? new Date()).toISOString(),
    about: 'Everything American Flyers stores about you. Ride samples are one reading per second. Ride-ons are listed without the other rider’s name.',
    ...rest,
    ...(extras ?? {}),
  }) as Record<string, unknown>;
}

async function check<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>) {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

/** Reads everything the signed-in rider has stored. Rides come in pages so the big sample arrays don't time out. */
export async function collectMyData(): Promise<Record<string, unknown>> {
  const me = account();
  if (!me) throw new Error('Sign in first');
  const activities: unknown[] = [];
  for (let from = 0; ; from += 25) {
    const page = (await check(neon.from('activities').select('*').eq('user_id', me.id).order('started_at').range(from, from + 24))) as unknown[] | null;
    activities.push(...(page ?? []));
    if (!page || page.length < 25) break;
  }
  const [profile, workouts, routes, ftp, feedback, extras] = await Promise.all([
    check(neon.from('profiles').select('*').eq('user_id', me.id).maybeSingle()),
    check(neon.from('workouts').select('*').eq('user_id', me.id)),
    check(neon.from('routes').select('*').eq('user_id', me.id)),
    check(neon.from('ftp_history').select('*').eq('user_id', me.id).order('recorded_at')),
    check(neon.from('feedback').select('*').eq('user_id', me.id)),
    check(neon.rpc('my_data_extras')),
  ]);
  return tidyDataExport({
    profile, workouts: workouts ?? [], routes: routes ?? [], activities, ftp_history: ftp ?? [], feedback: feedback ?? [],
    extras: (extras ?? {}) as Record<string, unknown>,
  });
}

/** Builds the export and saves it as a .json file. Returns the file name. */
export async function downloadMyData(): Promise<string> {
  const data = await collectMyData();
  const name = dataFileName();
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
  return name;
}

/**
 * Deletes the account and everything in it, then signs out and forgets this
 * browser's copies. The database refuses admin accounts with a plain message.
 */
export async function deleteMyAccount() {
  if (!account()) throw new Error('Sign in first');
  const { error } = await neon.rpc('delete_my_account');
  if (error) throw new Error(error.message);
  try { await signOut(); } catch { /* the session is already gone with the account */ }
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('americanflyers.')) localStorage.removeItem(k);
  } catch { /* storage blocked: nothing to clear */ }
}
