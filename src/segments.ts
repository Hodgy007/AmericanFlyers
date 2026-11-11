// KOM segments: a stage's big climbs, timed as you ride them. Pure logic, no DOM and no network:
//  - `segmentsFor(stage)` finds the segments (from the stage's own elevation, named from its race summits);
//  - `SegmentTracker` times a ride through them, recording a split every 50 m;
//  - `timeAt` / `gapSeconds` compare a live effort with a stored one, by interpolating its splits.
// The store is in segmentStore.ts, the shared leaderboard in cloud/segmentApi.ts, the HUD in segmentUi.ts.

import { findClimbs, type Climb } from './climb';
import type { Stage } from './stages';
import { isClimb } from './world/roadside';

export interface Segment {
  /** Stable across builds: `<stageId>:<slug of the summit's name>` or `<stageId>:climb-<n>` (a world's routes share `<world id>:...`). Pinned per built-in stage in tests/unit/segments.test.ts. */
  id: string;
  stageId: string;
  name: string;
  start: number; // metres along the stage (the first passage, on a circuit)
  end: number;
  length: number;
  gain: number;
  avg: number; // average grade, fraction
  max: number; // steepest 100 m, fraction
  /** Circuits: the length of one lap. The segment is ridden once per lap, and each passage is its own effort. */
  lap?: number;
  /** How many times the stage passes through it (laps on a circuit, else 1). */
  passes: number;
  /** A built-in stage's segment has a shared leaderboard; an uploaded route's only keeps your own bests. */
  shared: boolean;
}

/** Metres between recorded split times. */
export const SPLIT_M = 50;

// What counts as a big climb. Tuned against the built-in stages (see tests/unit/segments.test.ts): every mountain
// stage gets its main climb as one segment, rolling stages their real named climbs, the flat ones none.
export const SEGMENT_MIN_LENGTH = 900; // metres
export const SEGMENT_MIN_GAIN = 60; // metres
/** A named summit (hors catégorie to category 2) makes a shorter, lower climb count. */
const SUMMIT_MIN_LENGTH = 500;
const SUMMIT_MIN_GAIN = 40;
/** On a circuit, a climb to any named summit counts from this long and this high. */
const CIRCUIT_MIN_LENGTH = 300;
const CIRCUIT_MIN_GAIN = 12;
/** Climbs this close together, with at most BRIDGE_DIP metres of descent between, are one segment (a hairpin's flat is not a break). */
const BRIDGE_GAP = 250;
const BRIDGE_DIP = 12;
/** How far past the top of a climb a summit's name still belongs to it. */
const NAME_REACH = 300;

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** "Hell of the West · Stage 2: Tour of the Moon" → "Tour of the Moon". */
export function shortStageName(name: string): string {
  const colon = name.lastIndexOf(': ');
  const dot = name.lastIndexOf(' · ');
  const from = Math.max(colon >= 0 ? colon + 2 : 0, dot >= 0 ? dot + 3 : 0);
  return name.slice(from).trim() || name;
}

function steepest(elevationAt: (d: number) => number, s: number, e: number, fallback: number) {
  let max = 0;
  for (let d = s; d + 100 <= e; d += 25) max = Math.max(max, (elevationAt(d + 100) - elevationAt(d)) / 100);
  return Math.max(max, fallback);
}

/** The climb's own name where the stage's name says more ("Mount Washington Auto Road"). */
const MAIN_NAMES: Record<string, string> = { 'mt-washington': 'Mount Washington' };

const cache = new WeakMap<Stage, Segment[]>();

/** The segments of a stage, in order of distance. Cached per stage: call it freely. Endless stages have none. */
export function segmentsFor(stage: Stage): Segment[] {
  const hit = cache.get(stage);
  if (hit) return hit;
  const out = findSegments(stage);
  cache.set(stage, out);
  return out;
}

function findSegments(stage: Stage): Segment[] {
  const finish = stage.finish;
  if (finish === null) return [];
  // A route inside a world scopes its segment ids to the world, so a climb ridden on two routes is one leaderboard (and one segment_limits row).
  const scope = stage.world?.id ?? stage.id;
  const el = (d: number) => stage.elevationAt(d);
  const lap = stage.lapLength && stage.lapLength < finish ? stage.lapLength : undefined;
  const scanTo = lap ? lap + 400 : finish; // a circuit's climb can run over the lap line
  // Climbs, then the ones with only a short dip between them joined.
  const climbs: Climb[] = [];
  for (const c of findClimbs(el, 0, scanTo)) {
    const last = climbs[climbs.length - 1];
    if (last && c.start - last.end <= BRIDGE_GAP && el(last.end) - el(c.start) <= BRIDGE_DIP) {
      const length = c.end - last.start;
      const gain = el(c.end) - el(last.start);
      climbs[climbs.length - 1] = { start: last.start, end: c.end, length, gain, avg: gain / length, max: steepest(el, last.start, c.end, gain / length) };
    } else climbs.push(c);
  }
  const summits = (stage.race?.summits ?? []).filter((s) => s.cat <= 2);
  const named = stage.race?.summits ?? [];
  /** The race summit at (just past) the top of a climb, if any. On a circuit a summit may be on any lap. */
  const summitFor = (c: Climb, from = named) => {
    let best: (typeof named)[number] | null = null;
    for (const s of from) {
      for (const d of lap ? [s.d, s.d - lap] : [s.d]) {
        if (d >= c.start + c.length / 2 && d <= c.end + NAME_REACH && (!best || s.cat < best.cat)) best = s;
      }
    }
    return best;
  };
  // Single-climb stages (the mountain climbs): one main segment, from the first big climb to the summit.
  if (isClimb(stage) && !stage.uploaded && stage.tourStage === undefined) {
    const first = climbs.find((c) => c.length >= SEGMENT_MIN_LENGTH && c.gain >= SEGMENT_MIN_GAIN) ?? climbs[0];
    if (!first) return [];
    let end = finish;
    let top = el(finish);
    for (let d = first.start; d <= finish; d += 25) if (el(d) > top + 3) { top = el(d); end = d; } // the highest point when it isn't the finish
    const gain = el(end) - el(first.start);
    const length = end - first.start;
    if (length < SEGMENT_MIN_LENGTH || gain < SEGMENT_MIN_GAIN) return [];
    return [{
      id: `${scope}:main`, stageId: stage.id, name: MAIN_NAMES[stage.id] ?? shortStageName(stage.name),
      start: first.start, end, length, gain, avg: gain / length, max: steepest(el, first.start, end, gain / length),
      passes: 1, shared: true,
    }];
  }
  // A rolling stage that finishes on a named summit (Echo Lake): its last climb runs on to the line across the small dips.
  const atFinish = named.find((s) => s.d === finish && s.cat <= 1);
  const lastClimb = climbs[climbs.length - 1];
  if (atFinish && !lap && lastClimb && finish - lastClimb.end <= 2000 && lastClimb.end < finish) {
    const gain = el(finish) - el(lastClimb.start);
    climbs[climbs.length - 1] = { ...lastClimb, end: finish, length: finish - lastClimb.start, gain, avg: gain / (finish - lastClimb.start), max: steepest(el, lastClimb.start, finish, 0) };
  }
  if (atFinish && !lap && climbs.length > 1) {
    // ...and it joins the climb before it across a small dip (up to 400 m), so the whole climb to Echo Lake is one segment.
    const prev = climbs[climbs.length - 2];
    const last = climbs[climbs.length - 1];
    if (last.start - prev.end <= 400 && el(prev.end) - el(last.start) <= 15) {
      const length = last.end - prev.start;
      const gain = el(last.end) - el(prev.start);
      climbs.splice(climbs.length - 2, 2, { start: prev.start, end: last.end, length, gain, avg: gain / length, max: steepest(el, prev.start, last.end, gain / length) });
    }
  }
  const picked: { c: Climb; name: string | null }[] = [];
  for (const raw of climbs) {
    // The top of a circuit's climb is the lap line.
    const c = lap && raw.end > lap ? { ...raw, end: lap, length: lap - raw.start, gain: el(lap) - el(raw.start), avg: (el(lap) - el(raw.start)) / (lap - raw.start) } : raw;
    if (lap && c.start >= lap) continue; // a repeat of the first lap's climbs
    if (c.length <= 0) continue;
    const big = c.length >= SEGMENT_MIN_LENGTH && c.gain >= SEGMENT_MIN_GAIN;
    const summit = summitFor(c);
    // On a circuit any named summit's climb counts (Harlem Hill, Libby Hill): short, but ridden again every lap.
    const important = (summitFor(c, summits) !== null && c.length >= SUMMIT_MIN_LENGTH && c.gain >= SUMMIT_MIN_GAIN)
      || (lap !== undefined && summit !== null && c.length >= CIRCUIT_MIN_LENGTH && c.gain >= CIRCUIT_MIN_GAIN);
    // Unnamed climbs on a rolling stage are kept only if they are really big.
    const bigUnnamed = c.length >= 2000 && c.gain >= 100;
    if ((big || important) && (summit || important || bigUnnamed)) picked.push({ c, name: summit?.name ?? null });
  }
  // A circuit's short named climbs (Libby Hill, Harlem Hill) can be too short for findClimbs: walk back from the summit
  // while the road climbs (every 50 m) and keep it if it is long and high enough.
  if (lap) {
    for (const s of named) {
      if (s.d > lap) continue;
      if (picked.some((p) => s.d >= p.c.start && s.d <= p.c.end + NAME_REACH)) continue;
      let top = s.d;
      for (let d = Math.max(0, s.d - NAME_REACH); d <= s.d + NAME_REACH; d += 25) if (el(d) > el(top)) top = d;
      let start = top;
      while (start - 50 >= 0 && el(start - 50) < el(start) + (top - start < 300 ? 0.3 : 0)) start -= 50; // across a level top too
      const length = top - start;
      const gain = el(top) - el(start);
      if (length < CIRCUIT_MIN_LENGTH || gain < CIRCUIT_MIN_GAIN) continue;
      picked.push({ c: { start, end: top, length, gain, avg: gain / length, max: steepest(el, start, top, gain / length) }, name: s.name });
    }
    picked.sort((a, b) => a.c.start - b.c.start);
  }
  // Names: the summit's, else "<Stage> climb" for the biggest, "Climb N" for the rest. Ids follow the name.
  const short = shortStageName(stage.name);
  const unnamedBiggest = picked.filter((p) => !p.name).sort((a, b) => b.c.gain - a.c.gain)[0];
  const passes = lap ? Math.max(1, Math.round(finish / lap)) : 1;
  const used = new Set<string>();
  return picked.map((p, i) => {
    const n = i + 1;
    let name = p.name;
    let key = name ? slug(name) : `climb-${n}`;
    if (!name) name = picked.length === 1 ? short : p === unnamedBiggest ? `${short} climb` : `Climb ${n}`;
    while (used.has(key)) key += `-${n}`;
    used.add(key);
    const { c } = p;
    return {
      id: `${scope}:${key}`, stageId: stage.id, name,
      start: c.start, end: c.end, length: c.end - c.start, gain: c.gain, avg: c.gain / (c.end - c.start),
      max: steepest(el, c.start, c.end, c.avg), lap, passes, shared: !stage.uploaded,
    };
  });
}

// ------------------------------------------------------------------ efforts ----

/** One ride through a segment. Compact: it is stored locally and in the database. */
export interface Effort {
  t: number; // elapsed moving seconds (to 0.01 s)
  p: number; // average power, W (0 when unknown)
  /** Elapsed time at every 50 m into the segment, in tenths of a second (int): splits[i] is at (i + 1) * 50 m. The top is `t`. */
  s: number[];
  at: number; // when it ended, ms since the epoch
}

/** A stored effort as the database returns it (segment_efforts). */
export interface EffortRow { elapsed_s: number; avg_power: number | null; splits: number[] | null; created_at: string }

/** The compact effort for a database row; tolerates a missing power or splits column. */
export function effortFromRow(r: EffortRow): Effort {
  const s = Array.isArray(r.splits) ? r.splits.filter((n) => typeof n === 'number' && Number.isFinite(n)) : [];
  return { t: r.elapsed_s, p: r.avg_power ?? 0, s, at: new Date(r.created_at).getTime() };
}

/** Elapsed seconds at `x` metres into a segment `length` long, from an effort's splits (linear between them). */
export function timeAt(e: Pick<Effort, 't' | 's'>, length: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= length) return e.t;
  const i = Math.min(e.s.length, Math.floor(x / SPLIT_M)); // the split at or before x is i (0 = the start)
  const d0 = i * SPLIT_M;
  const t0 = i === 0 ? 0 : e.s[i - 1] / 10;
  const hasNext = i < e.s.length;
  const d1 = hasNext ? d0 + SPLIT_M : length;
  const t1 = hasNext ? e.s[i] / 10 : e.t;
  return d1 > d0 ? t0 + ((t1 - t0) * (x - d0)) / (d1 - d0) : t1;
}

/** The parts of a leaderboard row the views need (cloud/segmentApi.ts `SegmentRow` has them all). */
export interface BoardRowLike { rank: number; short_name: string; elapsed_s: number; is_me: boolean; riders?: number }

/** The king of the climb (rank 1), your own row if you are on the board, and how many riders there are. */
export function boardSummary<T extends BoardRowLike>(rows: T[]): { king: T | null; me: T | null; riders: number } {
  const king = rows.find((r) => r.rank === 1) ?? null;
  const me = rows.find((r) => r.is_me) ?? null;
  return { king, me, riders: rows.reduce((n, r) => Math.max(n, r.riders ?? 0, r.rank), 0) };
}

/** Metres from the segment's start where an effort was after `t` elapsed seconds (the inverse of `timeAt`): for the ghost. */
export function distanceAt(e: Pick<Effort, 't' | 's'>, length: number, t: number): number {
  if (t <= 0) return 0;
  if (t >= e.t) return length;
  // The first split not yet taken by t (binary search over the splits, in tenths of a second).
  const tenths = t * 10;
  let lo = 0;
  let hi = e.s.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (e.s[mid] <= tenths) lo = mid + 1;
    else hi = mid;
  }
  const d0 = lo * SPLIT_M;
  const t0 = lo === 0 ? 0 : e.s[lo - 1] / 10;
  const hasNext = lo < e.s.length;
  const d1 = hasNext ? d0 + SPLIT_M : length;
  const t1 = hasNext ? e.s[lo] / 10 : e.t;
  return t1 > t0 ? d0 + ((d1 - d0) * (t - t0)) / (t1 - t0) : d1;
}

export type SegmentStatus =
  | { state: 'ahead'; segment: Segment; pass: number; toStart: number }
  | { state: 'on'; segment: Segment; pass: number; x: number };

/** Where you stand relative to a stage's segments: on one, or the next one starting within `range` metres. */
export function segmentStatus(segments: Segment[], d: number, range: number): SegmentStatus | null {
  let ahead: (SegmentStatus & { state: 'ahead' }) | null = null;
  for (const s of segments) {
    for (let k = 0; k < s.passes; k++) {
      const start = s.start + k * (s.lap ?? 0);
      const end = s.end + k * (s.lap ?? 0);
      if (d >= start && d < end) return { state: 'on', segment: s, pass: k, x: d - start };
      if (d < start && start - d <= range && (!ahead || start - d < ahead.toStart)) ahead = { state: 'ahead', segment: s, pass: k, toStart: start - d };
    }
  }
  return ahead;
}

/**
 * How far ahead (negative) or behind (positive) an effort in progress is against a stored one, in seconds:
 * your elapsed time minus the time the stored effort had taken at the same point on the road.
 */
export function gapSeconds(ref: Pick<Effort, 't' | 's'>, length: number, x: number, elapsed: number): number {
  return elapsed - timeAt(ref, length, x);
}

/** The gap as the HUD writes it: "-0:07" (ahead) or "+0:12" (behind); "±0:00" when level. */
export function gapText(gap: number): string {
  const s = Math.round(Math.abs(gap));
  const m = Math.floor(s / 60);
  const text = `${m}:${String(s % 60).padStart(2, '0')}`;
  return s === 0 ? `±${text}` : `${gap < 0 ? '−' : '+'}${text}`;
}

/** "52:14" or "1:02:03" for a segment time (whole seconds, as the leaderboards show them). */
export function segmentTime(s: number): string {
  const total = Math.round(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

// ------------------------------------------------------------------ tracker ----

/** A jump along the road bigger than this in one frame (demo profile jumps) is not riding: it voids an effort and can't start one. */
const JUMP_M = 150;

export interface Live {
  segment: Segment;
  /** Which passage (0-based: the lap, on a circuit). */
  pass: number;
  /** Metres from the segment's start line. */
  x: number;
  /** Moving seconds since crossing the start line. */
  elapsed: number;
}

export interface TrackerEvents {
  start?(segment: Segment, pass: number): void;
  /** The top: the effort, its segment and passage. */
  finish?(segment: Segment, pass: number, effort: Effort): void;
  /** Stopped, jumped or restarted mid-segment. */
  voided?(segment: Segment, pass: number, why: 'stopped' | 'jumped' | 'reset'): void;
}

/**
 * Times a ride through a stage's segments. Call `update` every frame with the distance, the moving-time clock the
 * stage finish uses, the work done so far (joules) and whether the rider is riding (moving, not on the start line
 * waiting, not finished). O(segments) numbers per frame and no allocation, except when a split or an effort is stored.
 */
export class SegmentTracker {
  private segments: Segment[] = [];
  private events: TrackerEvents;
  // The segment being timed (null: none).
  private seg: Segment | null = null;
  private pass = 0;
  private startD = 0;
  private endD = 0;
  private t0 = 0;
  private w0 = 0;
  private splits: number[] = [];
  /** The live state, reused every frame (null when not on a segment). */
  live: Live | null = null;
  private readonly liveState: Live = { segment: null as unknown as Segment, pass: 0, x: 0, elapsed: 0 };
  // The previous frame.
  private lastD = NaN;
  private lastT = 0;
  private lastW = 0;

  constructor(events: TrackerEvents = {}) {
    this.events = events;
  }

  setSegments(segments: Segment[]) {
    this.reset();
    this.segments = segments;
  }

  /** Forgets any effort in progress (a new ride, a new stage, the hub opening). */
  reset() {
    if (this.seg) this.events.voided?.(this.seg, this.pass, 'reset');
    this.seg = null;
    this.live = null;
    this.lastD = NaN;
  }

  update(d: number, movingTime: number, work: number, riding: boolean) {
    const prevD = this.lastD;
    const prevT = this.lastT;
    const prevW = this.lastW;
    this.lastD = d;
    this.lastT = movingTime;
    this.lastW = work;
    if (!(prevD === prevD)) return; // the first frame has nothing to compare with
    const jumped = Math.abs(d - prevD) > JUMP_M || d < prevD - 1;
    const seg = this.seg;
    if (seg) {
      if (jumped || !riding) {
        this.seg = null;
        this.live = null;
        this.events.voided?.(seg, this.pass, jumped ? 'jumped' : 'stopped');
        return;
      }
      // Splits crossed in this frame, interpolated between the two frames.
      let n = this.splits.length;
      const length = seg.length;
      while ((n + 1) * SPLIT_M < length && this.startD + (n + 1) * SPLIT_M <= d) {
        const at = this.startD + (n + 1) * SPLIT_M;
        const f = d > prevD ? (at - prevD) / (d - prevD) : 1;
        this.splits.push(Math.round((prevT + (movingTime - prevT) * f - this.t0) * 10));
        n++;
      }
      if (d >= this.endD) {
        const f = d > prevD ? (this.endD - prevD) / (d - prevD) : 1;
        const elapsed = prevT + (movingTime - prevT) * f - this.t0;
        const workAt = prevW + (work - prevW) * f - this.w0;
        const effort: Effort = { t: Math.round(elapsed * 100) / 100, p: elapsed > 0 ? Math.round(workAt / elapsed) : 0, s: this.splits, at: Date.now() };
        const done = this.seg!;
        const pass = this.pass;
        this.seg = null;
        this.live = null;
        this.splits = [];
        this.events.finish?.(done, pass, effort);
        return;
      }
      const l = this.liveState;
      l.x = d - this.startD;
      l.elapsed = movingTime - this.t0;
      return;
    }
    if (!riding || jumped) return;
    // Crossing a start line this frame?
    for (let i = 0; i < this.segments.length; i++) {
      const s = this.segments[i];
      for (let k = 0; k < s.passes; k++) {
        const at = s.start + k * (s.lap ?? 0);
        if (prevD < at && d >= at) {
          const f = (at - prevD) / (d - prevD);
          this.seg = s;
          this.pass = k;
          this.startD = at;
          this.endD = s.end + k * (s.lap ?? 0);
          this.t0 = prevT + (movingTime - prevT) * f;
          this.w0 = prevW + (work - prevW) * f;
          this.splits = [];
          const l = this.liveState;
          l.segment = s;
          l.pass = k;
          l.x = d - at;
          l.elapsed = movingTime - this.t0;
          this.live = l;
          this.events.start?.(s, k);
          return;
        }
      }
    }
  }
}

// -------------------------------------------------------------- the result ----

export interface EffortResult {
  /** The time in `Effort.t` beat the stored best (or there was none). */
  pb: boolean;
  firstAttempt: boolean;
  /** Seconds faster (negative) or slower (positive) than your previous best; null for a first attempt. */
  vsBest: number | null;
}

/** What an effort means against the stored best. */
export function judgeEffort(effort: Pick<Effort, 't'>, best: Pick<Effort, 't'> | null | undefined): EffortResult {
  if (!best) return { pb: true, firstAttempt: true, vsBest: null };
  return { pb: effort.t < best.t, firstAttempt: false, vsBest: effort.t - best.t };
}

/** The line shown at the top: "Alpe d'Huez — 52:14 · New PB by 0:41 · #3 of 27". `rank` and `riders` are null when unknown. */
export function resultText(name: string, effort: Pick<Effort, 't'>, r: EffortResult, rank: number | null, riders: number | null): string {
  const parts = [`${name} — ${segmentTime(effort.t)}`];
  if (r.firstAttempt) parts.push('First attempt, a time to beat');
  else if (r.pb) parts.push(`New PB by ${segmentTime(Math.abs(r.vsBest!))}`);
  else parts.push(`${segmentTime(r.vsBest!)} off your best`);
  if (rank) parts.push(riders && riders >= rank ? `#${rank} of ${riders}` : `#${rank}`);
  return parts.join(' · ');
}
