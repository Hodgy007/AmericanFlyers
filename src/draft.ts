// Drafting: riding close behind another rider cuts your air resistance.
// Measured savings (wind tunnel and CFD studies of two riders in line) are
// roughly a third of the drag half a wheel behind, falling to around a
// quarter at 2–3 m, and fading out by about 10–15 m. Behind a group it's
// more: each extra rider ahead shelters you a little further, to around
// 40–45% third wheel in a paceline and 50–55% at the back of a small group.
// The percentage hardly changes with speed; the watts it saves do (air drag
// grows with the cube of speed), so the draft matters most on the flat.

import type { OtherRider } from './world/others';

export const BIKE_LENGTH = 1.75; // metres, wheel to wheel along the bike
export const DRAFT_MAX_GAP = 12; // metres between wheels where the draft fades out
export const DRAFT_SWEET_SPOT = 2; // metres: aim to be this close (or closer)

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
}

/**
 * The rider just ahead of you (live riders and pro teams; ghosts make no
 * wind) within `lookAhead` metres, the group they're part of, and the draft
 * that gives you. The gap to the nearest wheel sets how much of the draft you
 * get; the size of the group sets how big it can be.
 */
export function draftFrom(myDistance: number, riders: OtherRider[], lookAhead = 60): Draft | null {
  let nearest: OtherRider | null = null;
  let nearestGap = Infinity;
  const ahead: number[] = [];
  for (const r of riders) {
    if (r.ghost) continue;
    const gap = r.distance - myDistance - BIKE_LENGTH;
    if (gap < 0 || gap > lookAhead + GROUP_SPAN) continue; // alongside or behind you, or too far ahead
    ahead.push(r.distance);
    if (gap < nearestGap && gap <= lookAhead) { nearest = r; nearestGap = gap; }
  }
  if (!nearest) return null;
  // The group: riders from the wheel you're on to GROUP_SPAN beyond it.
  const from = nearest.distance;
  const n = ahead.filter((d) => d >= from - 0.01 && d <= from + GROUP_SPAN).length;
  const saving = draftSaving(nearestGap) * (groupMax(n) / SOLO_MAX);
  return { saving, gap: nearestGap, name: nearest.name, riders: n, team: nearest.team };
}
