// Braking into bends. Descents used to take every hairpin at whatever speed drag allowed; this gives the
// road a safe speed (v = √(a_lat · R), from the curvature of its heading) and a braking profile, so a rider
// slows before the bend at a comfortable deceleration and accelerates out through the normal physics.
//
// The profile is built once per road (lazily, in 1 km blocks, cached on the heading function) by a backward
// pass: the limit at a point is the lower of its own corner speed and what you could brake down from to meet
// the corner speed of the next point. Looking it up is then two array reads, cheap enough for every step.
// Curvature is measured over a 20 m baseline so GPS wiggles on real-road stages don't read as bends.

const G = 9.81;
/** Lateral grip a road bike on dry tarmac can use, in g (a 10 m hairpin comes out at about 32 km/h). */
export const LATERAL_G_DRY = 0.8;
/** A wet road gives up about a third of it. */
export const WET_GRIP = 0.65;
/** Comfortable braking, m/s² (a bike on the brakes manages 4+, but riders don't push it on a descent). */
export const BRAKE_DECEL = 3.5;
/** The hardest the helper will slow a rider in one step, m/s² (a little above the profile's own, so a rider who starts above it catches up). */
export const MAX_DECEL = 4.5;

const CELL = 5; // m between profile samples
const BASELINE = 20; // m over which the heading change is measured
const BLOCK = 1000; // m of profile built at a time
const OVERHANG = 300; // m built beyond a block so braking for a bend just past it is still in the table
const FLOOR_MS = 5; // never ask for less than this (18 km/h): a tight bend is ridden, not stopped for
const NO_LIMIT = 1e3;
/** Above this a limit means nothing (the fastest descent in the app is far below it). */
const FREE_MS = 45;

let roadWet = false;
/** Tells every live rider (you, the pro teams, the AI rival) whether the road is wet. The ride calls this each frame from the weather. */
export function setRoadWet(wet: boolean) {
  roadWet = wet;
}
export const isRoadWet = () => roadWet;

export interface CornerOptions {
  /** The road's heading in radians at a distance (course.ts `headingAt`, or a stage's own). Its identity keys the cache. */
  headingAt: (d: number) => number;
  /** A wet road: less grip, softer braking. Left out: whatever `setRoadWet` last said (dry to begin with). */
  wet?: boolean;
}

/** Corner speed in m/s for a radius in metres on a road with `grip` of lateral g. */
export function cornerSpeedForRadius(radiusM: number, wet = false): number {
  return Math.max(wetFloor(wet), Math.sqrt(LATERAL_G_DRY * (wet ? WET_GRIP : 1) * G * radiusM));
}
const wetFloor = (wet: boolean) => (wet ? FLOOR_MS * 0.85 : FLOOR_MS);

class Profile {
  private blocks: Float32Array[] = [];
  constructor(private readonly headingAt: (d: number) => number, private readonly wet: boolean) {}

  /** The limit at distance `d`, m/s. */
  at(d: number): number {
    if (!(d > 0)) d = 0;
    const f = d / CELL;
    const i = Math.floor(f);
    const t = f - i;
    const per = BLOCK / CELL;
    const a = this.value(i, per);
    const b = this.value(i + 1, per);
    return a + (b - a) * t;
  }

  private value(i: number, per: number): number {
    const bi = Math.floor(i / per);
    return this.block(bi)[i - bi * per];
  }

  private block(bi: number): Float32Array {
    let b = this.blocks[bi];
    if (b) return b;
    const per = BLOCK / CELL;
    const n = per + OVERHANG / CELL;
    const start = bi * BLOCK;
    const wet = this.wet;
    const decel = BRAKE_DECEL * (wet ? WET_GRIP : 1);
    const lat = LATERAL_G_DRY * (wet ? WET_GRIP : 1) * G;
    const floor = wetFloor(wet);
    const prof = new Float32Array(n + 1);
    for (let k = 0; k <= n; k++) {
      const d = start + k * CELL;
      const kappa = Math.abs(this.headingAt(d + BASELINE / 2) - this.headingAt(Math.max(0, d - BASELINE / 2))) / BASELINE;
      prof[k] = kappa > 1e-9 ? Math.min(NO_LIMIT, Math.max(floor, Math.sqrt(lat / kappa))) : NO_LIMIT;
    }
    // Backward pass: you must be able to brake down to the next sample's limit within one cell.
    for (let k = n - 1; k >= 0; k--) prof[k] = Math.min(prof[k], Math.sqrt(prof[k + 1] * prof[k + 1] + 2 * decel * CELL));
    b = prof.subarray(0, per + 1) as Float32Array; // the overhang only fed the pass
    this.blocks[bi] = b;
    return b;
  }
}

const cache = new WeakMap<object, { dry?: Profile; wet?: Profile }>();

function profileFor(o: CornerOptions): Profile {
  let c = cache.get(o.headingAt);
  if (!c) cache.set(o.headingAt, (c = {}));
  if (o.wet ?? roadWet) return (c.wet ??= new Profile(o.headingAt, true));
  return (c.dry ??= new Profile(o.headingAt, false));
}

/**
 * The fastest a rider may be going at `distance` (m/s) so that every bend ahead can be braked for at a comfortable
 * deceleration. Infinity when nothing within braking reach asks for less than 45 m/s (a straight, or a gentle sweeper).
 * The block that holds `distance` is built on first use.
 */
export function cornerSpeedLimit(distance: number, opts: CornerOptions): number {
  const v = profileFor(opts).at(distance);
  return v >= FREE_MS ? Infinity : v;
}

/**
 * Brings a speed down to the corner limit, never by more than `MAX_DECEL` (wet: less) over the step `dt`.
 * A speed already under the limit comes back unchanged, so this is safe to call after every `stepSpeed`.
 */
export function limitCornerSpeed(speedMs: number, distance: number, dt: number, opts: CornerOptions): number {
  if (speedMs <= 3) return speedMs; // nothing under 11 km/h is ever too fast for a bend (floor is 5 m/s)
  const limit = cornerSpeedLimit(distance, opts);
  if (speedMs <= limit) return speedMs;
  const maxDrop = MAX_DECEL * ((opts.wet ?? roadWet) ? WET_GRIP : 1) * dt;
  return Math.max(limit, speedMs - maxDrop);
}
