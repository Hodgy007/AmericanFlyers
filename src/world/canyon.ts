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
export function canyonRel(p: CanyonShape, c: number, s0: number, d: number, plain: number): number {
  if (s0 <= p.lip) return ROAD_LEVEL;
  // Out of the ledge the cliff's lines wander in and out (up to ~30 m) so its faces and benches aren't ruled straight.
  const s = s0 + 30 * fbm(d / 420, s0 / 150 + 5, 2) * smoothstep(p.lip, p.lip + 25, s0);
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

/**
 * Rim Rock Drive (Tour of the Moon), surveyed against the baked road. For every 250 m of the stage the
 * ground height was sampled (USGS 3DEP 10 m, through opentopodata.org) at 60 to 800 m either side of the
 * road line (stage metres scaled back to real metres): a canyon is wherever one side falls away
 * 100 to 200 m within 150 to 300 m, and the other side stays level or rises. Named places are OpenStreetMap
 * nodes (Nominatim and the OSM map API, © OpenStreetMap contributors, ODbL) projected onto the same line.
 * The road runs from the Grand Junction entrance west and north, so "right" is the Grand Valley side
 * for most of the way and every Monument Canyon feature lies on the right:
 *  - 4,900 to 5,800: the first switchbacks above Monument Road, the slope falling away on the right; 5,900 to
 *    6,500 the hairpin above turns the drop to the left.
 *  - 6,850 to 7,650: Cold Shivers Point (km 7.0), right; 8,200 to 10,300: the head of Red Canyon, right.
 *  - 10,900 to 12,700: Red Canyon Overlook (km 11.2) and Ute Canyon View (km 12.2), right.
 *  - 13,200 to 17,000: the high point's rim above Ute Canyon (Fallen Rock Overlook km 15.5, Upper Ute Canyon
 *    Overlook km 15.9), right.
 *  - 17,000 to 21,150: the plateau at Black Ridge and Highland View (km 20.6), both sides level or rising: no cliff.
 *  - 21,150 to 29,100: Monument Canyon, right, all the way: Artists Point (km 22.5), Coke Ovens (km 22.6),
 *    Monument Canyon View (km 24.7), Grand View (km 26.5), Independence Monument View (km 27.3).
 *  - 29,100 to 29,700: the plateau at the Saddlehorn visitor center (km 29.2); 29,700 to 31,900: the
 *    rim of Fruita Canyon, right (Fruita Canyon View km 29.8, Distant View km 30.5).
 *  - 32,000 to 34,600: the road doubles back down Fruita Canyon's switchbacks and tunnels (Rim Rock Drive tunnels
 *    km 32.1 to 32.4, Balanced Rock View km 33.0) with the drop on the left; 34,700 to 35,400: a last drop on the right.
 *  - 35,400 to 37,000: the road is down on the valley floor towards Fruita.
 */
// One entry per canyon (same-side stretches are one section: abutting ones would each fade to half).
export const RIM_ROCK_SECTIONS: CanyonSection[] = [
  { from: 4900, to: 5800, left: false, right: true },
  { from: 5900, to: 6500, left: true, right: false },
  { from: 6850, to: 7650, left: false, right: true },
  { from: 8200, to: 10300, left: false, right: true },
  { from: 10900, to: 12700, left: false, right: true },
  { from: 13200, to: 17000, left: false, right: true },
  { from: 21150, to: 29100, left: false, right: true },
  { from: 29700, to: 31900, left: false, right: true },
  { from: 32000, to: 34600, left: true, right: false },
  { from: 34700, to: 35400, left: false, right: true },
];
