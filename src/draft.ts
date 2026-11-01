// Drafting: riding close behind another rider cuts your air resistance.
// Measured savings (wind tunnel and CFD studies of two riders in line) are
// roughly a third of the drag half a wheel behind, falling to around a
// quarter at 2–3 m, and fading out by about 10–15 m. Behind a group it's
// more: each extra rider ahead shelters you a little further, to around
// 40–45% third wheel in a paceline and 50–55% at the back of a small group.
// The percentage hardly changes with speed; the watts it saves do (air drag
// grows with the cube of speed), so the draft matters most on the flat.
// Sideways counts too: the saving is full when you're on their line (within
// about 0.3 m) and fades to nothing by about 1.1 m across.

import type { OtherRider } from './world/others';

export const BIKE_LENGTH = 1.75; // metres, wheel to wheel along the bike
export const DRAFT_MAX_GAP = 12; // metres between wheels where the draft fades out
export const DRAFT_SWEET_SPOT = 2; // metres: aim to be this close (or closer)
export const LATERAL_FULL = 0.3; // metres across: still in their slipstream, full saving
export const LATERAL_NONE = 1.1; // metres across: out of it

/** Share of the draft you keep when you're `offset` metres to one side of their line (1 on it, 0 clear of it). */
export function lateralOverlap(offset: number) {
  const a = Math.abs(offset);
  if (a <= LATERAL_FULL) return 1;
  if (a >= LATERAL_NONE) return 0;
  const t = (a - LATERAL_FULL) / (LATERAL_NONE - LATERAL_FULL);
  return 1 - t * t * (3 - 2 * t);
}

/** Where you and the riders are across the road, for the sideways part of the draft. */
export interface Lateral {
  lane: number; // your lane, metres right of the centre line
  lateralOf(id: string): number | undefined; // a rider's lane as drawn, if known
  /**
   * Crosswind echelon: metres to the right of a rider's line where their shelter is
   * (negative: to the left), from `draftShift(crosswind)` in world/wind.ts. Left out: 0, straight behind.
   */
  shift?: number;
}

/** Fraction of air drag saved at a wheel-to-wheel gap of `gap` metres. */
export function draftSaving(gap: number) {
  if (gap < 0 || gap > DRAFT_MAX_GAP) return 0;
  const fade = 1 - Math.max(0, gap - 8) / (DRAFT_MAX_GAP - 8); // ease out over the last few metres
  return 0.36 * Math.exp(-Math.max(0, gap - 0.3) / 4.2) * fade;
}

export const GROUP_SPAN = 15; // metres: riders this far beyond the wheel you're on count as the group
const SOLO_MAX = 0.36; // best saving on one wheel
const GROUP_EXTRA = 0.19; // extra saving a big group can add on top

/** The best saving behind a group of `n` riders (1 → 36%, 3 → 48%, 6 → 54%). */
export function groupMax(n: number) {
  return SOLO_MAX + GROUP_EXTRA * (1 - Math.exp(-(Math.max(1, n) - 1) / 1.6));
}

export interface Draft {
  saving: number; // fraction of drag saved now (0 when not drafting)
  gap: number; // metres from your front wheel to their back wheel
  name: string; // the rider ahead
  riders: number; // riders in the group ahead of you (1 = a single wheel)
  team?: string; // the pro team, when it's one of theirs
  /** Their sheltered spot (their lane, plus the crosswind shift) minus your lane, metres (negative: it's to your left). 0 when sideways isn't being tracked. */
  offset: number;
  /** Share of the draft kept for being on their line, 0..1. */
  overlap: number;
}

/**
 * The rider just ahead of you (live riders and pro teams; ghosts make no
 * wind) within `lookAhead` metres, the group they're part of, and the draft
 * that gives you. The gap to the nearest wheel sets how much of the draft you
 * get; the size of the group sets how big it can be. With `lateral`, the
 * wheel that shelters you best (close and on your line) is the one you follow,
 * and riders off to the side don't count towards the group; if nobody ahead is
 * on your line you still get the nearest rider, with no saving, so the gauge
 * can tell you which way to move.
 */
export function draftFrom(myDistance: number, riders: OtherRider[], lookAhead = 60, lateral?: Lateral): Draft | null {
  interface Cand { r: OtherRider; gap: number; offset: number; overlap: number }
  const ahead: Cand[] = [];
  for (const r of riders) {
    if (r.ghost) continue;
    const gap = r.distance - myDistance - BIKE_LENGTH;
    if (gap < 0 || gap > lookAhead + GROUP_SPAN) continue; // alongside or behind you, or too far ahead
    const lane = lateral ? lateral.lateralOf(r.id) ?? r.lane : undefined;
    const offset = lateral && lane !== undefined ? lane + (lateral.shift ?? 0) - lateral.lane : 0;
    ahead.push({ r, gap, offset, overlap: lateral ? lateralOverlap(offset) : 1 });
  }
  let best: Cand | null = null;
  let bestScore = -1;
  for (const c of ahead) {
    if (c.gap > lookAhead) continue;
    // Best shelter first; with none on your line, the nearest wheel.
    const score = c.overlap > 0 ? 1 + draftSaving(c.gap) * c.overlap : 1 / (1 + c.gap);
    if (score > bestScore) { best = c; bestScore = score; }
  }
  if (!best) return null;
  // The group: riders (on your line) from the wheel you're on to GROUP_SPAN beyond it.
  const from = best.r.distance;
  const n = Math.max(1, ahead.filter((c) => c.r.distance >= from - 0.01 && c.r.distance <= from + GROUP_SPAN && (c === best || c.overlap > 0)).length);
  const saving = draftSaving(best.gap) * (groupMax(n) / SOLO_MAX) * best.overlap;
  return { saving, gap: best.gap, name: best.r.name, riders: n, team: best.r.team, offset: best.offset, overlap: best.overlap };
}
