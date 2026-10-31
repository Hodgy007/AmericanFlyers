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

export function allWorkouts(): Workout[] {
  return [...cache.filter((w) => w.source !== 'builtin').reverse(), ...BUILTIN_WORKOUTS];
}

export function workoutById(id: string) {
  return allWorkouts().find((w) => w.id === id);
}

/** Adds or replaces a saved workout. Returns false if it couldn't be persisted. */
export function saveWorkout(w: Workout) {
  cache = [...cache.filter((x) => x.id !== w.id), w];
  return write(cache);
}

export function deleteWorkout(id: string) {
  cache = cache.filter((x) => x.id !== id);
  write(cache);
}
