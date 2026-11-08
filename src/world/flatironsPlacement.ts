// Where the Flatirons model (flatirons.ts) goes so that it stands where the real ones do relative to a
// road: from the real coordinates of two of the slabs and the road's start, in the stage's world frame
// (x east, z south, metres, the start at the origin: the frame the baked roads are in; the same flat
// projection as scripts/bake-routes.mjs). Pure and free of three.js, so stages.ts can use it.

const EARTH_R = 6371000;
const DEG = Math.PI / 180;

export type LonLat = [lon: number, lat: number];

/** Metres east (x) and south (z) of `origin` to `point`, in the flat projection the baked roads use. */
export function eastSouth(origin: LonLat, point: LonLat): { x: number; z: number } {
  const kx = DEG * EARTH_R * Math.cos(origin[1] * DEG);
  const kz = DEG * EARTH_R;
  return { x: (point[0] - origin[0]) * kx, z: -(point[1] - origin[1]) * kz };
}

/** The model's own axes (flatirons.ts): x along the ridge, z towards the road, and the middle of the slabs' feet. */
export const FLATIRONS_MODEL = { footX: 70, footZ: 570, height: 499.3 };

export interface WorldPlacement {
  /** World position of the model's origin, metres east and south of the start. */
  x: number;
  z: number;
  /** Rotation about the vertical axis (three.js rotation.y) that turns the model's +z (the slabs' faces) to face `facing`. */
  yaw: number;
  /** The scale that makes the model `size` metres tall. */
  scale: number;
}

/**
 * Puts the model's slab line through the middle of the real slabs `a` and `b` (any two, one at each end of
 * the group), its ridge along the line between them, and its faces to the side of that line given by
 * `facing` (a point the slabs face: the town, east of them). `size` is the model's height in metres.
 */
export function flatironsPlacement(start: LonLat, a: LonLat, b: LonLat, facing: LonLat, size: number): WorldPlacement {
  const pa = eastSouth(start, a);
  const pb = eastSouth(start, b);
  const centre = { x: (pa.x + pb.x) / 2, z: (pa.z + pb.z) / 2 };
  // The ridge direction (unit), and its normal pointing at the side `facing` lies on.
  const len = Math.hypot(pb.x - pa.x, pb.z - pa.z);
  const ux = (pb.x - pa.x) / len;
  const uz = (pb.z - pa.z) / len;
  const pf = eastSouth(start, facing);
  let nx = uz;
  let nz = -ux;
  if ((pf.x - centre.x) * nx + (pf.z - centre.z) * nz < 0) { nx = -nx; nz = -nz; }
  // three.js rotation.y = yaw maps local +z to (sin yaw, cos yaw) in (x, z): that is the normal.
  const yaw = Math.atan2(nx, nz);
  const scale = size / FLATIRONS_MODEL.height;
  // The origin sits behind the slab line: local (footX, footZ) must land on `centre`.
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const lx = FLATIRONS_MODEL.footX * scale;
  const lz = FLATIRONS_MODEL.footZ * scale;
  return { x: centre.x - (lx * c + lz * s), z: centre.z - (-lx * s + lz * c), yaw, scale };
}
