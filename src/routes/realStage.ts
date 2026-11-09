// Turns a baked real road (realRoute.ts) into what a stage needs: heading and elevation by course
// distance, and where its hairpins are. The real road's length is mapped proportionally onto the
// stage's length, because the stage's length is fixed by leaderboards, ghosts and race schedules:
// a few per cent of stretch is invisible, a different finish line is not.

import { decodeRoute, ELE_STEP, HEAD_STEP, type RealRoute, type RealRouteData } from './realRoute';

const MAX_GRADE = 0.25;
const PROFILE_STEP = 1; // metres between elevation samples once rescaled
const CAP_STEP = 10; // metres between the points the gradient cap works on, and the road's final elevation points
const RUN_OUT = 60; // metres of near-level road after the finish line (the top of a climb)
const RUN_OUT_GRADE = 0.01;

/** A hairpin found in the road's heading: a turn of more than ~140 degrees within a short stretch. */
export interface Hairpin {
  start: number; // course distance where the turn starts, m
  end: number;
  /** The middle of the turn. */
  apex: number;
  /** +1: the road turns right (heading rising), so the outside of the turn is on the left; -1 turns left. */
  turn: 1 | -1;
  /** Total heading change, rad (always positive). */
  angle: number;
}

const CURVED = 0.02; // rad/m: tighter than a 50 m radius counts as part of a turn
const GAP = 15; // m of straighter road that does not end a turn
/** Smallest turn that counts, rad: 140 degrees, then (only when a stage knows it should have more) 125 and 110. */
const MIN_ANGLES = [2.44, 2.18, 1.92];

/**
 * The hairpins of a heading function over `length` metres, in order of distance. When `want` is
 * given (the official count) the threshold relaxes until that many are found, and if more are found
 * the sharpest `want` are kept.
 */
export function detectHairpins(headingAt: (d: number) => number, length: number, want?: number): Hairpin[] {
  let found: Hairpin[] = [];
  for (const min of want === undefined ? MIN_ANGLES.slice(0, 1) : MIN_ANGLES) {
    found = scanHairpins(headingAt, length, min);
    if (want === undefined || found.length >= want) break;
  }
  return want === undefined ? found : sharpest(found, want);
}

function scanHairpins(headingAt: (d: number) => number, length: number, minAngle: number): Hairpin[] {
  const out: Hairpin[] = [];
  let start = -1;
  let end = -1;
  let sign = 0;
  const close = () => {
    if (start < 0) return;
    const dh = headingAt(end) - headingAt(start);
    if (Math.abs(dh) >= minAngle) out.push({ start, end, apex: (start + end) / 2, turn: dh > 0 ? 1 : -1, angle: Math.abs(dh) });
    start = -1;
  };
  for (let d = 0; d < length; d += 1) {
    const k = (headingAt(d + 2.5) - headingAt(d - 2.5)) / 5;
    const s = Math.abs(k) > CURVED ? Math.sign(k) : 0;
    if (s !== 0 && (start < 0 || s === sign)) {
      if (start < 0) { start = d; sign = s; }
      end = d;
    } else if (start >= 0 && (s !== 0 || d - end > GAP)) {
      close();
      if (s !== 0) { start = d; end = d; sign = s; }
    }
  }
  close();
  return out;
}

/** Keeps the `count` hairpins that turn the most (ties: the earlier), still in order. */
export function sharpest(hairpins: Hairpin[], count: number): Hairpin[] {
  if (hairpins.length <= count) return hairpins;
  const keep = new Set([...hairpins].sort((a, b) => b.angle - a.angle || a.apex - b.apex).slice(0, count));
  return hairpins.filter((h) => keep.has(h));
}

export interface RealGeometry {
  route: RealRoute;
  /** Real metres per stage metre. */
  scale: number;
  headingAt(d: number): number;
  /** Elevation above the start along the real road, unscaled, at every PROFILE_STEP of the stage. */
  rise: Float64Array;
}

/** Linear interpolation of `a` (samples `step` metres apart) at real distance `m`. */
function lerpAt(a: Float64Array, step: number, m: number): number {
  const f = Math.max(0, Math.min(a.length - 1, m / step));
  const i = Math.min(a.length - 2, Math.floor(f));
  return a[i] + (a[i + 1] - a[i]) * (f - i);
}

export function mapRoute(data: RealRouteData, stageLength: number): RealGeometry {
  const route = decodeRoute(data);
  const scale = route.length / stageLength;
  const headingAt = (d: number) => lerpAt(route.heading, HEAD_STEP, Math.max(0, Math.min(stageLength, d)) * scale);
  const n = Math.round(stageLength / PROFILE_STEP);
  const rise = new Float64Array(n + 1);
  if (route.elevation.length > 1) {
    const e0 = lerpAt(route.elevation, ELE_STEP, 0);
    for (let i = 1; i <= n; i++) rise[i] = lerpAt(route.elevation, ELE_STEP, i * PROFILE_STEP * scale) - e0;
  }
  return { route, scale, headingAt, rise };
}

/**
 * Caps each step of `steps` at +-`cap`, handing the excess to the neighbours within `reach` samples so
 * the total is kept. Used to keep a road under a maximum gradient (or turn rate) without moving its end.
 */
export function limitSteps(steps: Float64Array, cap: number, reach = 8): void {
  for (let pass = 0; pass < 2000; pass++) {
    const excess: [number, number][] = [];
    for (let i = 0; i < steps.length; i++) {
      const over = Math.abs(steps[i]) - cap;
      if (over > 1e-9) { excess.push([i, Math.sign(steps[i]) * over]); steps[i] -= Math.sign(steps[i]) * over; }
    }
    if (!excess.length) return;
    for (const [i, ex] of excess) {
      // Spread over the window, reflecting at the ends so nothing is lost.
      for (let o = -reach; o <= reach; o++) {
        let j = i + o;
        if (j < 0) j = -j - 1;
        if (j >= steps.length) j = 2 * steps.length - j - 1;
        steps[Math.max(0, Math.min(steps.length - 1, j))] += ex / (2 * reach + 1);
      }
    }
  }
}

export interface ScaleTo {
  gain?: number;
  peak?: number;
  /** Steepest gradient, as a fraction (default 0.25). */
  maxGrade?: number;
  /** A climb never descends: SRTM's dips (a hairpin cutting a corner of its cell) are levelled before scaling. */
  climbOnly?: boolean;
  /** Average the profile over this many metres first: SRTM's 30 m cells read trees and buildings as bumps, which in a park or a town turn a gentle road into a run of short ramps. */
  smooth?: number;
}

/**
 * Elevation along a stage from a real profile, rescaled to the published figures:
 * - `kmGrades` (% per kilometre): each kilometre's rise is scaled to its published average first;
 * - then the whole profile is scaled so the finish is `gain` above the start, or, for a road that also
 *   descends, so the highest point is `peak` above the start;
 * - then the gradient is capped.
 * Past the finish the road runs on nearly level.
 */
export function elevationFrom(geo: RealGeometry, stageLength: number, scaleTo: ScaleTo, kmGrades?: number[]): (d: number) => number {
  const prof = Float64Array.from(geo.rise);
  if (scaleTo.climbOnly) {
    let top = 0;
    for (let i = 1; i < prof.length; i++) {
      const step = Math.max(0, geo.rise[i] - geo.rise[i - 1]);
      prof[i] = top += step;
    }
  }
  if (scaleTo.smooth && scaleTo.smooth > PROFILE_STEP) {
    const half = Math.round(scaleTo.smooth / PROFILE_STEP / 2);
    const sum = new Float64Array(prof.length + 1);
    for (let i = 0; i < prof.length; i++) sum[i + 1] = sum[i] + prof[i];
    const out = new Float64Array(prof.length);
    for (let i = 0; i < prof.length; i++) {
      const a = Math.max(0, i - half), b = Math.min(prof.length, i + half + 1);
      out[i] = (sum[b] - sum[a]) / (b - a);
    }
    const start = out[0];
    for (let i = 0; i < prof.length; i++) prof[i] = out[i] - start; // the road still starts at 0
  }
  if (kmGrades) {
    const step = PROFILE_STEP;
    let acc = 0;
    const out = new Float64Array(prof.length);
    for (let k = 0; k < kmGrades.length; k++) {
      const a = Math.floor((k * 1000) / step);
      const b = Math.min(prof.length - 1, Math.floor(((k + 1) * 1000) / step));
      if (b <= a) continue;
      const real = prof[b] - prof[a];
      const f = real > 1 ? ((kmGrades[k] / 100) * (b - a) * step) / real : 1;
      for (let i = a + 1; i <= b; i++) out[i] = acc + (prof[i] - prof[a]) * f;
      acc = out[b];
    }
    prof.set(out);
  }
  let high = 0;
  for (let i = 0; i < prof.length; i++) if (prof[i] > high) high = prof[i];
  const base = scaleTo.peak !== undefined ? high : prof[prof.length - 1];
  const f = base > 0 ? (scaleTo.peak ?? scaleTo.gain ?? base) / base : 1;
  // SRTM's ramps are steeper than any road: flatten what exceeds the cap into the road around it.
  // That is done on the profile every CAP_STEP metres (a hundredth of the work), and the road is
  // straight lines between those points.
  const n = Math.ceil(stageLength / CAP_STEP);
  const steps = new Float64Array(n);
  let prev = 0;
  for (let k = 1; k <= n; k++) {
    const at = prof[Math.min(prof.length - 1, Math.round((k * CAP_STEP) / PROFILE_STEP))] * f;
    steps[k - 1] = at - prev;
    prev = at;
  }
  limitSteps(steps, (scaleTo.maxGrade ?? MAX_GRADE) * CAP_STEP, 3);
  const points = new Float64Array(n + 1);
  for (let k = 0; k < n; k++) points[k + 1] = points[k] + steps[k];
  const top = points[n];
  return (d) => {
    if (d <= 0) return 0;
    if (d >= stageLength) return top + Math.min(d - stageLength, RUN_OUT) * RUN_OUT_GRADE;
    const x = d / CAP_STEP;
    const i = Math.floor(x);
    return points[i] + (points[i + 1] - points[i]) * (x - i);
  };
}
