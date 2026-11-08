// Canyons beside the road: the pure shape of the ground for `Scenery.roadside`. Given a point at
// course distance `d` and lateral offset from the centreline, it returns the ground height
// relative to the road. On the canyon side a flat ledge runs to a lip, then a stepped sheer
// cliff (Wingate sandstone), a talus slope and a flat canyon floor, which rises again in a few
// ledges to the stage's wild terrain far out. On the other side of a one-sided canyon the
// ground climbs in ledges. Everything keys off `d` and `lateral`, never world coordinates, so
// it follows whatever route the road takes.

import { fbm, smoothstep } from './noise';

/** A stretch of course with canyons on the left and/or right (left and right as seen riding forward). */
export interface CanyonSection { from: number; to: number; left: boolean; right: boolean }

/** Half-length of the fade at each end of a section, m: the cliff grows (or shrinks) over twice this. */
export const FADE = 260;
/** The canyon hook must reach this far from the road (the far wall ends before it). */
export const REACH = 900;

const ROAD_LEVEL = 0; // heights are relative to the terrain's road level (already 0.15 m under the surface)
const CLIFF_STEPS = [0.5, 0.2, 0.18, 0.12]; // share of the cliff height each step drops (the first is the big Wingate face)
const CLIFF_WIDTHS = [0.22, 0.26, 0.26, 0.26]; // share of the cliff's width each step takes (a face, then a bench)
const RISE_STEPS = [0.45, 0.3, 0.25];

/** Canyon profile numbers at a course distance on one side; they wander smoothly with `d`. */
export interface CanyonShape {
  cliff: number; // height of the cliff, m (120 to 220)
  lip: number; // distance of the cliff edge from the centreline, m
  cliffWidth: number;
  talus: number; // extra drop down the talus slope, m
  talusWidth: number;
  floorEnd: number; // where the floor starts to rise to the far wall, m from the centreline
  wallWidth: number;
  rise: number; // height of the rock on the other side, m
}

export function shapeAt(d: number, side: -1 | 1): CanyonShape {
  const k = side * 7.3;
  const cliff = Math.min(220, Math.max(120, 170 + 80 * fbm(d / 1900 + k, 0.5 + side, 2)));
  return {
    cliff,
    lip: 11.4 + 0.8 * fbm(d / 700 + k, 3.1, 2),
    cliffWidth: cliff * 0.36,
    talus: 45 + 15 * fbm(d / 1400 + k, 8.2, 2),
    talusWidth: 120,
    floorEnd: 440 + 70 * fbm(d / 2300 + k, 5.5, 2),
    wallWidth: 300,
    rise: 45 + 25 * fbm(d / 1600 + k, 1.7, 2),
  };
}

/** 0..1: how much canyon there is on one side at `d` (sections fade in and out over 2 x FADE). */
export function canyonWeight(sections: readonly CanyonSection[], d: number, side: -1 | 1): number {
  let c = 0;
  for (const s of sections) {
    if (!(side < 0 ? s.left : s.right)) continue;
    if (d < s.from - FADE || d > s.to + FADE) continue;
    const w = smoothstep(s.from - FADE, s.from + FADE, d) * (1 - smoothstep(s.to - FADE, s.to + FADE, d));
    if (w > c) c = w;
  }
  return c;
}

/** A staircase from 0 to 1 over t in [0, 1]: each step a sharp-lipped face (over 55% of its width) then a flat bench. */
function stairs(t: number, steps: readonly number[], widths?: readonly number[]): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  let drop = 0;
  let at = 0;
  for (let i = 0; i < steps.length; i++) {
    const w = widths ? widths[i] : 1 / steps.length;
    if (t < at + w) {
      const x = Math.min(1, (t - at) / (w * 0.55));
      return drop + steps[i] * (1 - (1 - x) * (1 - x));
    }
    at += w;
    drop += steps[i];
  }
  return 1;
}

/** Height relative to the road at `s` m from the centreline on the canyon side, with the cliff scaled to `c` of its full height. */
export function canyonRel(p: CanyonShape, c: number, s: number, d: number, plain: number): number {
  if (s <= p.lip) return ROAD_LEVEL;
  const cliff = p.cliff * c;
  const cEnd = p.lip + p.cliffWidth;
  if (s < cEnd) return ROAD_LEVEL - cliff * stairs((s - p.lip) / p.cliffWidth, CLIFF_STEPS, CLIFF_WIDTHS);
  const talus = p.talus * c;
  const tEnd = cEnd + p.talusWidth;
  if (s < tEnd) {
    const t = (s - cEnd) / p.talusWidth;
    return ROAD_LEVEL - cliff - talus * (1 - (1 - t) * (1 - t));
  }
  // The floor is gently rolling; beyond floorEnd it climbs in ledges to the wild terrain.
  const roll = fbm(d / 240, s / 240, 2) * 4 * smoothstep(tEnd, tEnd + 40, s);
  const floor = ROAD_LEVEL - cliff - talus + roll;
  if (s < p.floorEnd) return floor;
  const v = stairs(smoothstep(p.floorEnd, p.floorEnd + p.wallWidth, s), [0.4, 0.35, 0.25]);
  return floor + (plain - floor) * v;
}

/** Height relative to the road at `s` m from the centreline on the side that rises, scaled to `r` of its full height. */
export function riseRel(p: CanyonShape, r: number, s: number, plain: number): number {
  const top = p.rise * r;
  const start = 9;
  const width = p.rise;
  if (s <= start) return ROAD_LEVEL;
  const up = ROAD_LEVEL + top * stairs((s - start) / width, RISE_STEPS);
  if (s < start + width + 20) return up;
  return up + (plain - up) * smoothstep(start + width + 20, start + width + 170, s);
}

/**
 * The `Scenery.roadside` hook for a list of canyon sections. `plain` is the height relative to
 * the road the terrain would give without a hook; null (outside every section) means no opinion.
 * Continuous in `d`: the cliff grows out of the plain terrain as a section's fade begins.
 */
export function makeRoadside(sections: readonly CanyonSection[]): (d: number, lateral: number, plain: number) => number | null {
  const first = Math.min(...sections.map((s) => s.from)) - FADE;
  const last = Math.max(...sections.map((s) => s.to)) + FADE;
  return (d, lateral, plain) => {
    if (d < first || d > last) return null;
    const side = lateral < 0 ? -1 : 1;
    const s = Math.abs(lateral);
    const c = canyonWeight(sections, d, side);
    const r = canyonWeight(sections, d, side < 0 ? 1 : -1) * (1 - c);
    if (c <= 0 && r <= 0) return null;
    let rel = plain;
    const p = shapeAt(d, side);
    if (c > 0) rel += smoothstep(0, 0.35, c) * (canyonRel(p, c, s, d, plain) - rel);
    if (r > 0) rel += smoothstep(0, 0.35, r) * (riseRel(p, r, s, plain) - rel);
    return rel;
  };
}

/** Rim Rock Drive: the road runs along the rims of Monument Canyon and its neighbours (Tour of the Moon). */
// One entry per canyon (same-side stretches are one section: abutting ones would each fade to half).
export const RIM_ROCK_SECTIONS: CanyonSection[] = [
  { from: 7400, to: 11300, left: true, right: false },
  { from: 9900, to: 14300, left: false, right: true },
  { from: 16800, to: 19800, left: true, right: false },
  { from: 19800, to: 24000, left: false, right: true },
  { from: 22000, to: 24000, left: true, right: false },
  { from: 26500, to: 29500, left: true, right: false },
  { from: 29500, to: 31500, left: false, right: true },
];
