// The workout library: built-ins plus the rider's uploaded and created
// workouts, which are kept in this browser's local storage.

import { BUILTIN_WORKOUTS, type Workout } from './model';

const KEY = 'americanflyers.workouts';

function stored(): Workout[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Workout[]) : [];
  } catch {
    return [];
  }
}

function write(list: Workout[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false; // private mode / storage full: still usable this session
  }
}

let cache = stored();

/** Called after local changes so a signed-in rider's account stays in sync. */
export const workoutSync = {
  saved: (_w: Workout) => {},
  deleted: (_id: string) => {},
};

/** Replaces the local copies with the account's workouts (after sign-in). */
export function setLocalWorkouts(list: Workout[]) {
  cache = list;
  write(cache);
}

/** The rider's own (non built-in) workouts. */
export function ownWorkouts() {
  return cache.filter((w) => w.source !== 'builtin');
}

export function allWorkouts(): Workout[] {
  return [...cache.filter((w) => w.source !== 'builtin').reverse(), ...BUILTIN_WORKOUTS];
}

export function workoutById(id: string) {
  return allWorkouts().find((w) => w.id === id);
}

/** Adds or replaces a saved workout. Returns false if it couldn't be persisted. */
export function saveWorkout(w: Workout) {
  cache = [...cache.filter((x) => x.id !== w.id), w];
  workoutSync.saved(w);
  return write(cache);
}

export function deleteWorkout(id: string) {
  cache = cache.filter((x) => x.id !== id);
  workoutSync.deleted(id);
  write(cache);
}
