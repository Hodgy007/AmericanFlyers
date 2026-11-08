// A bare summit cone for the stages that end on a peak (Mount Washington): the wild ground near the
// summit is replaced by a cone that falls away on every side, so the road runs out along a spine
// and the buildings at the top stand against the sky instead of being hidden behind rising ground
// (the generic wild height climbs hundreds of metres within a kilometre of the road). Pure: it
// needs only the stage's heading and elevation, and follows the course.ts convention for where the
// road is in the world (2 m steps from the origin, heading read at the middle of each step).

import { smoothstep } from './noise';

/** Where the cone stands and how it falls away. Heights share the road's datum (metres above the start). */
export interface SummitCone {
  /** Course distance and side (-1 left, +1 right, as for a landmark) and offset of the cone's top from the road. */
  d: number;
  side: -1 | 1;
  offset: number;
  /** Metres the top stands above the road at `d`. */
  rise: number;
  /** Radius of the level top, m. */
  flat: number;
  /** Gradient of the flanks (rise over run, 0.45 is about 24 degrees). */
  slope: number;
  /** The cone gives way to the stage's ordinary wild ground between these distances from its top. */
  fadeFrom: number;
  fadeTo: number;
}

const STEP = 2;

/** World position and heading of the road at course distance `d`, integrated as course.ts does. */
export function roadXZ(headingAt: (d: number) => number, d: number): { x: number; z: number; heading: number } {
  let x = 0;
  let z = 0;
  const h0 = headingAt(0);
  // course.ts starts the centreline 1,000 m behind the origin on a straight, so it passes through the origin at d = 0.
  for (let s = 0; s + STEP <= d; s += STEP) {
    const h = headingAt(s + STEP / 2);
    x += Math.cos(h) * STEP;
    z += Math.sin(h) * STEP;
  }
  const rest = d - Math.floor(d / STEP) * STEP;
  if (rest > 0) {
    const h = headingAt(d - rest / 2);
    x += Math.cos(h) * rest;
    z += Math.sin(h) * rest;
  }
  return { x, z, heading: d <= 0 ? h0 : headingAt(d) };
}

/** The cone's height at `dist` metres from its top: level to `flat`, then the flank. */
export const coneHeight = (top: number, dist: number, flat: number, slope: number) => top - slope * Math.max(0, dist - flat);

/**
 * Builds the replacement for a stage's wild height: `(x, z, wild)` gives the ground height at a world
 * point, which is `wild` far from the summit and the cone near it.
 */
export function summitCone(cone: SummitCone, headingAt: (d: number) => number, elevationAt: (d: number) => number) {
  const p = roadXZ(headingAt, cone.d);
  // The same place a landmark with this side and offset stands (landmarks.ts siteAt()).
  const cx = p.x - Math.sin(p.heading) * cone.offset * cone.side;
  const cz = p.z + Math.cos(p.heading) * cone.offset * cone.side;
  const top = elevationAt(cone.d) + cone.rise;
  return (x: number, z: number, wild: number) => {
    const dist = Math.hypot(x - cx, z - cz);
    const w = 1 - smoothstep(cone.fadeFrom, cone.fadeTo, dist);
    if (w <= 0) return wild;
    return wild + (coneHeight(top, dist, cone.flat, cone.slope) - wild) * w;
  };
}
