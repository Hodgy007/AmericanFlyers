// The Hell of the West tour: the three stages of American Flyers raced in order
// against the same field of pro teams, with a general classification (yellow),
// a points classification (green) and a mountains classification (polka dots).
// Progress is kept in settings.tour (synced with the account). No DOM here:
// tourUi.ts draws the dialog.

import { TEAMS, makeRoster } from './peloton';
import { ME, type ResultRow, type Totals } from './race';
import { RaceSim, makeCourse, stageResults, type RosterEntry } from './raceSim';
import { stageById } from './stages';

/** The stages in the order they are raced; the third keeps its original id (leaderboards use it). */
export const TOUR_STAGE_IDS = ['hotw-morgul-bismark', 'hotw-tour-of-the-moon', 'hell-of-the-west'];

/** One stage's result: [rider id, stage time in seconds, sprint points, mountain points]. */
export interface TourStageResult {
  stage: string;
  rows: [string, number, number, number][];
}

export interface TourProgress {
  id: string; // 'hotw-' plus the field's seed in base 36
  seed: number; // the same riders race every stage
  stage: number; // index of the next stage to race (3 = finished)
  results: TourStageResult[];
}

export interface TourRow {
  id: string;
  name: string;
  team: number; // -1 for you
  time: number;
  sprint: number;
  kom: number;
  you: boolean;
}

export type Jersey = 'yellow' | 'green' | 'polka';

/** Kit colours [main, second] for the player's jersey, in the kit system's order. */
export const JERSEY_COLOURS: Record<Jersey, [string, string]> = {
  yellow: ['#ffd51e', '#ffffff'],
  green: ['#1fa24a', '#ffffff'],
  polka: ['#ffffff', '#e0263c'],
};
export const JERSEY_NAMES: Record<Jersey, string> = { yellow: 'Yellow jersey', green: 'Green jersey', polka: 'Polka-dot jersey' };

// ------------------------------------------------------------ state ----

let current: TourProgress | null = null;
let onChange: (p: TourProgress | null) => void = () => {};

/** Loads saved progress (from settings). */
export function loadTour(p: TourProgress | null | undefined) {
  current = p && Array.isArray(p.results) && typeof p.seed === 'number' ? p : null;
}

export function getTour(): TourProgress | null {
  return current;
}

/** Called whenever the tour changes, so the app can save and sync it. */
export function onTourChange(fn: (p: TourProgress | null) => void) {
  onChange = fn;
}

function set(p: TourProgress | null) {
  current = p;
  onChange(p);
}

export function startTour(): TourProgress {
  const seed = Math.floor(Math.random() * 1e9);
  const p: TourProgress = { id: `hotw-${seed.toString(36)}`, seed, stage: 0, results: [] };
  set(p);
  return p;
}

export function quitTour() {
  set(null);
}

export function tourComplete(p: TourProgress | null = current) {
  return !!p && p.stage >= TOUR_STAGE_IDS.length;
}

/** Which tour stage (1–3) a stage id is, or null. */
export function tourStageNumber(id: string): number | null {
  const i = TOUR_STAGE_IDS.indexOf(id);
  return i < 0 ? null : i + 1;
}

// ------------------------------------------------- classifications ----

export function nameFor(id: string, seed: number): { name: string; team: number } {
  if (id === ME) return { name: 'You', team: -1 };
  const e = makeRoster(seed).find((r) => r.id === id);
  return e ? { name: `${e.name} (${TEAMS[e.team].short})`, team: e.team } : { name: id, team: -1 };
}

/** Totals so far, by rider. */
export function totals(p: TourProgress): Map<string, Totals> {
  const out = new Map<string, Totals>();
  for (const r of p.results) {
    for (const [id, time, sprint, kom] of r.rows) {
      const t = out.get(id) ?? { time: 0, sprint: 0, kom: 0 };
      t.time += time;
      t.sprint += sprint;
      t.kom += kom;
      out.set(id, t);
    }
  }
  return out;
}

/** The three classifications after the stages raced so far. */
export function standings(p: TourProgress): { gc: TourRow[]; points: TourRow[]; mountains: TourRow[] } {
  const tot = totals(p);
  const roster = makeRoster(p.seed);
  const rows: TourRow[] = [];
  for (const [id, t] of tot) {
    const e = roster.find((r) => r.id === id);
    rows.push({ id, name: id === ME ? 'You' : e ? `${e.name} (${TEAMS[e.team].short})` : id, team: e ? e.team : -1, time: t.time, sprint: t.sprint, kom: t.kom, you: id === ME });
  }
  const byTime = (a: TourRow, b: TourRow) => a.time - b.time;
  return {
    gc: [...rows].sort(byTime),
    points: [...rows].sort((a, b) => b.sprint - a.sprint || byTime(a, b)),
    mountains: [...rows].sort((a, b) => b.kom - a.kom || byTime(a, b)),
  };
}

/** The jerseys and who wears them. Green and polka dots need at least one point. */
export function jerseyHolders(p: TourProgress | null): Record<Jersey, TourRow | null> {
  if (!p || !p.results.length) return { yellow: null, green: null, polka: null };
  const s = standings(p);
  return {
    yellow: s.gc[0] ?? null,
    green: s.points[0] && s.points[0].sprint > 0 ? s.points[0] : null,
    polka: s.mountains[0] && s.mountains[0].kom > 0 ? s.mountains[0] : null,
  };
}

/**
 * The colours [main, second] of the jersey you wear in the tour right now:
 * yellow if you lead the general classification, else green, else polka dots,
 * else null. For the rider's kit to pick up.
 */
export function tourJersey(): [string, string] | null {
  const h = jerseyHolders(current);
  for (const j of ['yellow', 'green', 'polka'] as Jersey[]) if (h[j]?.you) return JERSEY_COLOURS[j];
  return null;
}

/** The jerseys you currently wear, for display. */
export function myJerseys(p: TourProgress | null = current): Jersey[] {
  const h = jerseyHolders(p);
  return (['yellow', 'green', 'polka'] as Jersey[]).filter((j) => h[j]?.you);
}

// ---------------------------------------------------------- stages ----

/** Saves a stage result (from a live race or a simulation) and moves the tour on. */
export function recordStage(stageId: string, rows: ResultRow[]): TourProgress | null {
  if (!current) return null;
  const idx = TOUR_STAGE_IDS.indexOf(stageId);
  if (idx < 0) return current;
  const entry: TourStageResult = { stage: stageId, rows: rows.map((r) => [r.id, Math.round(r.time * 10) / 10, r.sprint, r.kom]) };
  const results = [...current.results.filter((r) => r.stage !== stageId), entry].sort((a, b) => TOUR_STAGE_IDS.indexOf(a.stage) - TOUR_STAGE_IDS.indexOf(b.stage));
  set({ ...current, results, stage: Math.max(current.stage, idx + 1) });
  return current;
}

/** Totals from the stages before `stageId`, for the live race's jerseys. */
export function priorTotals(p: TourProgress | null, stageId: string): Map<string, Totals> {
  if (!p) return new Map();
  const idx = TOUR_STAGE_IDS.indexOf(stageId);
  return totals({ ...p, results: p.results.filter((r) => TOUR_STAGE_IDS.indexOf(r.stage) < idx) });
}

/** The player's watts per kilo, which the field is scaled to. */
export function refWkg(ftp: number, riderKg: number) {
  return Math.min(5.5, Math.max(1.8, ftp / Math.max(40, riderKg)));
}

/**
 * Skipping a stage: the whole field, with you riding at about 95% of your FTP,
 * simulated start to finish in a moment. The same engine as the live race.
 */
export function simulateStage(p: TourProgress, stageId: string, me: { ftp: number; riderKg: number; bikeKg: number }): ResultRow[] {
  const stage = stageById(stageId);
  const course = makeCourse({ finish: stage.finish!, elevationAt: stage.elevationAt, race: stage.race });
  const you: RosterEntry = {
    id: ME, name: 'You', team: 0, ability: 0.5, climb: 1, sprint: 2.0, leader: false,
    capW: me.ftp * 0.95, massKg: me.riderKg + me.bikeKg,
  };
  const idx = TOUR_STAGE_IDS.indexOf(stageId);
  const sim = new RaceSim(course, [...makeRoster(p.seed), you], { refWkg: refWkg(me.ftp, me.riderKg), seed: p.seed + idx * 101, startFront: 0 });
  sim.runToEnd();
  const rows: ResultRow[] = [];
  for (const r of stageResults(course.lines)) {
    if (r.time === null) continue;
    const info = nameFor(r.id, p.seed);
    rows.push({ id: r.id, name: info.name, team: info.team, time: r.time, sprint: r.sprint, kom: r.kom, you: r.id === ME });
  }
  return rows;
}
