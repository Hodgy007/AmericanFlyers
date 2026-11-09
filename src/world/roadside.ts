import type { Stage } from '../stages';

export const ROAD_HALF_WIDTH = 4.6; // metres either side of the centreline (road.ts re-exports it)

// Where the sharp bends are, read from the stage's own hairpin signs. Guardrails
// go on the outside of these, road paint keeps off them, and spectators crowd them.

export interface Bend {
  start: number; // course distance where the road starts turning hard
  end: number;
  /** +1: the road turns right (so the outside of the bend is on the left); -1 turns left. */
  turn: 1 | -1;
}

const SHARP = 0.04; // rad per metre: a 12 m hairpin turns at 0.083, an ordinary bend well under 0.01

const cache = new WeakMap<Stage, Bend[]>();

/** The hairpins of a stage: for each hairpin sign, the stretch just after it where the heading turns fast. */
export function bendsOf(stage: Stage): Bend[] {
  const hit = cache.get(stage);
  if (hit) return hit;
  const out: Bend[] = [];
  for (const sign of stage.signs) {
    let start = -1;
    let end = -1;
    let dir = 0;
    for (let d = sign.d - 10; d < sign.d + 80; d++) {
      const dh = stage.headingAt(d + 1) - stage.headingAt(d);
      if (Math.abs(dh) > SHARP) {
        if (start < 0) { start = d; dir = Math.sign(dh); }
        end = d + 1;
      } else if (start >= 0) break;
    }
    if (start >= 0) out.push({ start, end, turn: dir > 0 ? 1 : -1 });
  }
  cache.set(stage, out);
  return out;
}

/** Stages with numbered hairpins and a finish: the mountain climbs (and uploaded routes that have them). */
export const isClimb = (stage: Stage) => stage.climb !== false && stage.signs.length > 0 && stage.finish !== null;

/** Deterministic hash of (a, b) to [0, 1). */
export function hash01(a: number, b = 0, c = 0): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A small stable number from a stage id. */
export function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h | 0;
}
