// Keeps a signed-in rider's settings, workouts and routes in their Neon
// account, and saves/loads their activities. Local storage stays the working
// copy, so the app keeps running if the network drops.

import type { StoredRoute } from '../routes/gpx';
import { ownRoutes, routeSync, setLocalRoutes } from '../routes/library';
import type { Settings } from '../settings';
import type { Workout } from '../workouts/model';
import { ownWorkouts, setLocalWorkouts, workoutSync } from '../workouts/library';
import { account } from './account';
import { neon } from './client';

type Report = (msg: string) => void;
let report: Report = () => {};

export function onSyncError(fn: Report) {
  report = fn;
}

const fail = (what: string) => (err: unknown) => {
  const message = (err as { message?: string })?.message ?? String(err);
  report(`Couldn't sync ${what}: ${message}`);
};

async function check<T>(p: PromiseLike<{ data: T; error: { message: string } | null }>) {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return data;
}

// ------------------------------------------------------------ sign-in ----

/**
 * Brings the account and this browser together after sign-in: the account's
 * settings win if it has any; local workouts and routes that the account
 * doesn't have yet are uploaded; then local copies mirror the account.
 */
export async function syncOnSignIn(local: Settings): Promise<Settings | null> {
  const userId = account()?.id;
  if (!userId) return null;

  const profile = await check(neon.from('profiles').select('settings').eq('user_id', userId).maybeSingle());
  let remoteSettings: Settings | null = null;
  if (profile && Object.keys(profile.settings ?? {}).length) {
    remoteSettings = profile.settings as Settings;
  } else {
    await check(neon.from('profiles').upsert({ user_id: userId, settings: local, updated_at: new Date().toISOString() }));
    await recordFtp(local.ftp, 'signup').catch(() => {});
  }

  const workouts = await check(neon.from('workouts').select('id, data').eq('user_id', userId));
  const remoteW = new Map((workouts ?? []).map((r: { id: string; data: Workout }) => [r.id, r.data]));
  const newW = ownWorkouts().filter((w) => !remoteW.has(w.id));
  if (newW.length) await check(neon.from('workouts').insert(newW.map((w) => ({ id: w.id, user_id: userId, data: w }))));
  setLocalWorkouts([...remoteW.values(), ...newW]);

  const routes = await check(neon.from('routes').select('id, data').eq('user_id', userId));
  const remoteR = new Map((routes ?? []).map((r: { id: string; data: StoredRoute }) => [r.id, r.data]));
  const newR = ownRoutes().filter((r) => !remoteR.has(r.id));
  if (newR.length) await check(neon.from('routes').insert(newR.map((r) => ({ id: r.id, user_id: userId, name: r.name, data: r }))));
  setLocalRoutes([...remoteR.values(), ...newR]);

  return remoteSettings;
}

/** After sign-out, this browser forgets the account's workouts and routes. */
export function forgetLocalCopies() {
  setLocalWorkouts([]);
  setLocalRoutes([]);
}

// ------------------------------------------------------- write-through ----

let settingsTimer = 0;
export function pushSettings(s: Settings) {
  const userId = account()?.id;
  if (!userId) return;
  clearTimeout(settingsTimer);
  settingsTimer = window.setTimeout(() => {
    check(neon.from('profiles').upsert({ user_id: userId, settings: s, updated_at: new Date().toISOString() })).catch(fail('settings'));
  }, 800);
}

workoutSync.saved = (w) => {
  const userId = account()?.id;
  if (userId) check(neon.from('workouts').upsert({ id: w.id, user_id: userId, data: w, updated_at: new Date().toISOString() })).catch(fail('workout'));
};
workoutSync.deleted = (id) => {
  if (account()) check(neon.from('workouts').delete().eq('id', id)).catch(fail('workout'));
};
routeSync.saved = (r) => {
  const userId = account()?.id;
  if (userId) check(neon.from('routes').upsert({ id: r.id, user_id: userId, name: r.name, data: r, updated_at: new Date().toISOString() })).catch(fail('route'));
};
routeSync.deleted = (id) => {
  if (account()) check(neon.from('routes').delete().eq('id', id)).catch(fail('route'));
};

// ---------------------------------------------------------- activities ----

export interface Samples {
  power: number[];
  cadence: number[];
  hr: number[];
  speed: number[]; // m/s ×10
  distance: number[]; // metres
  elevation: number[]; // metres above sea level ×10
}

export interface Activity {
  id: string;
  started_at: string;
  title: string;
  stage_id: string | null;
  stage_name: string | null;
  finished: boolean; // reached the finish line of a stage with one
  workout_name: string | null;
  duration_s: number;
  distance_m: number;
  climbed_m: number;
  avg_power: number | null;
  np: number | null;
  max_power: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_cadence: number | null;
  kj: number | null;
  tss: number | null;
  ftp: number | null;
  best_power: Record<string, number> | null; // seconds → best average watts
  hr_zones: number[] | null; // seconds in each heart-rate zone
  power_zones: number[] | null; // seconds in each power zone
  max_hr_setting: number | null; // the max HR the zones were worked out from
  samples?: Samples | null;
}

const SUMMARY_COLUMNS = 'id, started_at, title, stage_id, stage_name, finished, workout_name, duration_s, distance_m, climbed_m, avg_power, np, max_power, avg_hr, max_hr, avg_cadence, kj, tss, ftp, best_power, hr_zones, power_zones, max_hr_setting';

/** Saves (or updates, using the same id) an activity for the signed-in rider. */
export async function saveActivity(a: Activity) {
  const userId = account()?.id;
  if (!userId) throw new Error('Not signed in');
  await check(neon.from('activities').upsert({ ...a, user_id: userId }));
}

export async function listActivities(): Promise<Activity[]> {
  const userId = account()?.id;
  if (!userId) return [];
  return ((await check(neon.from('activities').select(SUMMARY_COLUMNS).eq('user_id', userId).order('started_at', { ascending: false }).limit(1000))) ?? []) as Activity[];
}

export async function activitySamples(id: string): Promise<Samples | null> {
  const row = await check(neon.from('activities').select('samples').eq('id', id).maybeSingle());
  return (row?.samples as Samples) ?? null;
}

export async function deleteActivity(id: string) {
  await check(neon.from('activities').delete().eq('id', id));
}

// --------------------------------------------------------- FTP history ----

export type FtpSource = 'manual' | 'ramp_test' | 'signup';
export interface FtpEntry { ftp: number; source: FtpSource; recorded_at: string }

/** Records an FTP change (no-op when signed out). */
export async function recordFtp(ftp: number, source: FtpSource) {
  if (!account()) return;
  await check(neon.from('ftp_history').insert({ ftp: Math.round(ftp), source }));
}

export async function ftpHistory(): Promise<FtpEntry[]> {
  const userId = account()?.id;
  if (!userId) return [];
  return ((await check(neon.from('ftp_history').select('ftp, source, recorded_at').eq('user_id', userId).order('recorded_at', { ascending: true }))) ?? []) as FtpEntry[];
}

// ------------------------------------------------------------ feedback ----

export type FeedbackCategory = 'idea' | 'bug' | 'other';
export type FeedbackStatus = 'new' | 'planned' | 'in_progress' | 'done' | 'declined';

export interface Feedback {
  id: string;
  category: FeedbackCategory;
  message: string;
  context: Record<string, unknown> | null;
  status: FeedbackStatus;
  admin_reply: string | null;
  created_at: string;
  user_name?: string | null; // admin view only
  user_email?: string | null;
}

export async function submitFeedback(category: FeedbackCategory, message: string, context: Record<string, unknown>) {
  if (!account()) throw new Error('Sign in to send feedback');
  await check(neon.from('feedback').insert({ category, message, context }));
}

export async function myFeedback(): Promise<Feedback[]> {
  const userId = account()?.id;
  if (!userId) return [];
  return ((await check(neon.from('feedback').select('id, category, message, context, status, admin_reply, created_at').eq('user_id', userId).order('created_at', { ascending: false }))) ?? []) as Feedback[];
}

// --------------------------------------------------------------- admin ----
// Every admin call is checked in the database (public.is_admin()), so these
// fail for anyone who isn't on the admin list.

export async function isAdmin(): Promise<boolean> {
  if (!account()) return false;
  try {
    return Boolean(await check(neon.rpc('is_admin')));
  } catch {
    return false;
  }
}

export interface AdminOverview {
  users_total: number;
  users_7d: number;
  users_30d: number;
  banned: number;
  active_7d: number;
  active_30d: number;
  activities_total: number;
  activities_7d: number;
  hours_total: number;
  km_total: number;
  climbed_total: number;
  kj_total: number;
  workouts_saved: number;
  routes_saved: number;
  feedback_new: number;
  feedback_total: number;
  signups_by_day: { day: string; n: number }[];
  rides_by_day: { day: string; n: number }[];
  top_stages: { name: string; rides: number; riders: number; finishes: number }[];
  top_workouts: { name: string; rides: number; riders: number }[];
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  joined: string;
  banned: boolean;
  admin: boolean;
  rides: number;
  hours: number;
  km: number;
  last_ride: string | null;
  feedback: number;
}

export async function adminOverview() {
  return (await check(neon.rpc('admin_overview'))) as AdminOverview;
}

export async function adminUsers() {
  return ((await check(neon.rpc('admin_users'))) ?? []) as AdminUser[];
}

export async function adminFeedback() {
  return ((await check(neon.rpc('admin_feedback'))) ?? []) as Feedback[];
}

export async function adminSetBan(userId: string, ban: boolean, reason?: string) {
  await check(neon.rpc('admin_set_ban', { target: userId, ban, reason: reason ?? null }));
}

export async function adminUpdateFeedback(id: string, patch: { status?: FeedbackStatus; admin_reply?: string | null }) {
  await check(neon.from('feedback').update(patch).eq('id', id));
}

export async function adminDeleteFeedback(id: string) {
  await check(neon.from('feedback').delete().eq('id', id));
}
