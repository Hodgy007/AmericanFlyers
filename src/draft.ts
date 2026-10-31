// Drafting: riding close behind another rider cuts your air resistance.
// Measured savings (wind tunnel and CFD studies of two riders in line) are
// roughly a third of the drag half a wheel behind, falling to around a
// quarter at 2–3 m, and fading out by about 10–15 m.

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

export interface Draft {
  saving: number; // fraction of drag saved now (0 when not drafting)
  gap: number; // metres from your front wheel to their back wheel
  name: string; // the rider ahead
}

/**
 * The rider just ahead of you (live riders only: ghosts make no wind), within
 * `lookAhead` metres, and the draft they give you.
 */
export function draftFrom(myDistance: number, riders: OtherRider[], lookAhead = 60): Draft | null {
  let best: Draft | null = null;
  for (const r of riders) {
    if (r.ghost) continue;
    const gap = r.distance - myDistance - BIKE_LENGTH;
    if (gap < 0 || gap > lookAhead) continue; // alongside or behind you, or too far ahead
    const g = Math.max(0, gap);
    if (!best || g < best.gap) best = { saving: draftSaving(g), gap: g, name: r.name };
  }
  return best;
}
