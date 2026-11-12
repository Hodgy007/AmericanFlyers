// Uploaded GPX routes, kept in this browser's local storage, and the full
// stage list (built-in stages followed by the rider's routes).

import { STAGES, type Stage } from '../stages';
import { routeToStage, validateRoute, type StoredRoute } from './gpx';

const KEY = 'americanflyers.routes';

/** Ignore corrupt or oversized entries instead of letting one take the whole app down at startup. */
function validRoutes(list: unknown): StoredRoute[] {
  if (!Array.isArray(list)) return [];
  return list.filter((r): r is StoredRoute => {
    try {
      validateRoute(r);
      return true;
    } catch {
      return false;
    }
  });
}

function load(): StoredRoute[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? validRoutes(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

let routes = load();
const built = new Map<string, Stage>();

/** Called after local changes so a signed-in rider's account stays in sync. */
export const routeSync = {
  saved: (_r: StoredRoute) => {},
  deleted: (_id: string) => {},
};

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(routes));
    return true;
  } catch {
    return false; // too big or storage blocked: still rideable this session
  }
}

export function ownRoutes() {
  return routes;
}

/** Replaces the local copies with the account's routes (after sign-in). */
export function setLocalRoutes(list: StoredRoute[]) {
  routes = validRoutes(list);
  for (const id of built.keys()) if (!routes.some((r) => r.id === id)) built.delete(id);
  persist();
}

function stageFor(r: StoredRoute) {
  let s = built.get(r.id);
  if (!s) {
    s = routeToStage(r);
    built.set(r.id, s);
  }
  return s;
}

export function allStages(): Stage[] {
  return [...STAGES, ...routes.map(stageFor)];
}

export function stageById(id: string | null): Stage {
  return allStages().find((s) => s.id === id) ?? STAGES[0];
}

/** Saves an uploaded route. Returns its stage, and whether it was persisted. */
export function addRoute(r: StoredRoute): { stage: Stage; saved: boolean } {
  // Build it first: a bad route throws here, before it can be written to storage and break a later visit.
  const stage = routeToStage(r);
  routes = [...routes.filter((x) => x.id !== r.id), r];
  built.set(r.id, stage);
  const saved = persist();
  routeSync.saved(r);
  return { stage, saved };
}

export function deleteRoute(id: string) {
  routes = routes.filter((r) => r.id !== id);
  built.delete(id);
  persist();
  routeSync.deleted(id);
}
