// Climbs found from an elevation profile, for the climb preview card: a
// sustained rise (over 3% for more than 500 m), and where you are relative to
// the next one. Pure: it only needs a function giving elevation at a distance.

export interface Climb {
  start: number; // metres along the course
  end: number;
  length: number; // metres
  gain: number; // metres climbed from start to end
  avg: number; // average grade, fraction (0.071 = 7.1%)
  max: number; // steepest 100 m, fraction
}

export const CLIMB_MIN_GRADE = 0.03;
export const CLIMB_MIN_LENGTH = 500;
const STEP = 25; // metres between samples
const SMOOTH = 50; // metres either side for the local grade (a 100 m grade, so bumps don't split a climb)
const MERGE_GAP = 120; // a dip shorter than this doesn't end a climb

/** Climbs between `from` and `to` metres: stretches over 3% for more than 500 m, near neighbours joined. */
export function findClimbs(elevationAt: (d: number) => number, from: number, to: number): Climb[] {
  const a = Math.max(0, Math.floor(from / STEP) * STEP);
  const grade = (d: number) => (elevationAt(d + SMOOTH) - elevationAt(d - SMOOTH)) / (2 * SMOOTH);
  // Runs of samples at or above the minimum grade.
  const runs: { s: number; e: number }[] = [];
  let open: number | null = null;
  for (let d = a; d <= to; d += STEP) {
    const up = grade(d) >= CLIMB_MIN_GRADE;
    if (up && open === null) open = d;
    else if (!up && open !== null) { runs.push({ s: open, e: d }); open = null; }
  }
  if (open !== null) runs.push({ s: open, e: to });
  // Join runs with only a short dip between them.
  const merged: { s: number; e: number }[] = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && r.s - last.e <= MERGE_GAP) last.e = r.e;
    else merged.push({ ...r });
  }
  const out: Climb[] = [];
  for (const r of merged) {
    const length = r.e - r.s;
    if (length <= CLIMB_MIN_LENGTH) continue;
    const gain = elevationAt(r.e) - elevationAt(r.s);
    const avg = gain / length;
    if (avg < CLIMB_MIN_GRADE) continue;
    let max = 0;
    for (let d = r.s; d + 100 <= r.e; d += STEP) max = Math.max(max, (elevationAt(d + 100) - elevationAt(d)) / 100);
    out.push({ start: r.s, end: r.e, length, gain, avg, max: Math.max(max, avg) });
  }
  return out;
}

export type ClimbStatus =
  | { state: 'ahead'; climb: Climb; toStart: number }
  | { state: 'on'; climb: Climb; toTop: number; avgLeft: number };

/** How far ahead the preview card appears. */
export const PREVIEW_RANGE = 2000;

/** Where you stand relative to a stage's climbs: on one (km to the top, average grade still to come), or one starts within 2 km. */
export function climbStatus(climbs: Climb[], d: number, elevationAt: (d: number) => number, range = PREVIEW_RANGE): ClimbStatus | null {
  for (const c of climbs) {
    if (d >= c.start && d < c.end - 20) {
      const toTop = c.end - d;
      return { state: 'on', climb: c, toTop, avgLeft: (elevationAt(c.end) - elevationAt(d)) / toTop };
    }
    if (d < c.start && c.start - d <= range) return { state: 'ahead', climb: c, toStart: c.start - d };
    if (d < c.start) break; // later climbs are further away still
  }
  return null;
}
