// Water on a stage: the data (this file, no three.js, so stages.ts can use it) and the meshes (water.ts).
// A body is flat at a height `level`, in the same datum as the road (metres above the start's elevation), and
// is drawn as an opaque blue sheet that the ground simply sinks below: a stage's `wildHeight` (and its
// `roadside` hook) must take the land under it down past `level`, see `sinkInto` below.

/** The open sea: a plane as far as the eye can see, which follows the rider. */
export interface SeaBody { kind: 'sea'; level: number }
/** A lake or reservoir: an ellipse centred on (x, z) (metres east and south of the course start), turned `rot` radians (the three.js rotation about the vertical). */
export interface PondBody { kind: 'pond'; x: number; z: number; rx: number; rz: number; rot: number; level: number }
/** A river: a ribbon of `width` metres along a polyline of (x, z) points. */
export interface RiverBody { kind: 'river'; pts: [number, number][]; width: number; level: number }
export type WaterBody = SeaBody | PondBody | RiverBody;

/**
 * 1 inside the water, falling to 0 at `bank` metres beyond its edge, for a pond or a river (a sea has no
 * edge: the stage shapes its own coast). A stage multiplies this into how far its ground sinks.
 */
export function bankWeight(body: PondBody | RiverBody, x: number, z: number, bank: number): number {
  const d = body.kind === 'pond' ? pondDistance(body, x, z) : riverDistance(body, x, z);
  if (d <= 0) return 1;
  if (d >= bank) return 0;
  const t = d / bank;
  return 1 - t * t * (3 - 2 * t);
}

/** Metres outside the pond's edge (negative inside), measured along the ray from its centre. */
export function pondDistance(p: PondBody, x: number, z: number): number {
  const dx = x - p.x;
  const dz = z - p.z;
  // Undo the turn (three.js rotation.y = rot turns +x towards -z), then scale to a unit circle.
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  const u = dx * c - dz * s;
  const v = dx * s + dz * c;
  const r = Math.hypot(u / p.rx, v / p.rz);
  if (r < 1e-6) return -Math.min(p.rx, p.rz);
  // Distance to the edge along the ray, approximated by (r - 1) times the local radius.
  const local = Math.hypot(u, v) / r;
  return (r - 1) * local;
}

/** Metres outside the river's edge (negative inside): the distance to its centreline, less half the width. */
export function riverDistance(r: RiverBody, x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < r.pts.length; i++) {
    const [ax, az] = r.pts[i];
    const [bx, bz] = r.pts[i + 1];
    const vx = bx - ax;
    const vz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz || 1)));
    best = Math.min(best, Math.hypot(x - (ax + vx * t), z - (az + vz * t)));
  }
  return best - r.width / 2;
}

/**
 * The height the land should have at (x, z): `ground` where there is no pond or river, and the river bed or lake bed
 * (`depth` metres under its level) where there is, blending out over `bank` metres. Seas are left to the stage.
 */
export function sinkInto(bodies: readonly WaterBody[] | undefined, x: number, z: number, ground: number, depth = 4, bank = 60): number {
  if (!bodies) return ground;
  let h = ground;
  for (const b of bodies) {
    if (b.kind === 'sea') continue;
    const w = bankWeight(b, x, z, bank);
    if (w > 0) h = h + (Math.min(h, b.level - depth) - h) * w;
  }
  return h;
}
