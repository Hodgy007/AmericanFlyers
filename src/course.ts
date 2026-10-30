// An endless rolling, winding road.
//
// Elevation and heading are deterministic sums of sine waves at different
// wavelengths (long climbs, medium rollers, short kickers; sweeping bends and
// tighter curves). The road's ground-plane centreline is integrated from the
// heading and cached in 2 m steps. For d ≤ 0 the road runs straight along -x,
// so there is road behind the start line.

const ELEVATION_WAVES = [
  { amp: 34, length: 5200, phase: 0.0 },
  { amp: 9, length: 1300, phase: 1.7 },
  { amp: 2.2, length: 340, phase: 4.1 },
  { amp: 0.25, length: 90, phase: 2.3 },
];

const HEADING_WAVES = [
  { amp: 0.55, length: 2800, phase: 0.5 },
  { amp: 0.3, length: 1100, phase: 2.0 },
  { amp: 0.1, length: 430, phase: 1.0 },
];

const FLAT_START_M = 400; // ease in so the ride starts flat and straight

function waves(list: typeof ELEVATION_WAVES, d: number) {
  let v = 0;
  for (const w of list) v += w.amp * Math.sin((2 * Math.PI * d) / w.length + w.phase);
  return v;
}

function startRamp(d: number) {
  const t = Math.min(1, Math.max(0, d / FLAT_START_M));
  return t * t * (3 - 2 * t);
}

/** Elevation above the start, in metres, at distance `d` metres. */
export function elevationAt(d: number): number {
  return (waves(ELEVATION_WAVES, d) - waves(ELEVATION_WAVES, 0)) * startRamp(d);
}

/** Road grade as a fraction (0.05 = 5 %) at distance `d`. */
export function gradeAt(d: number): number {
  const h = 2;
  return (elevationAt(d + h) - elevationAt(d - h)) / (2 * h);
}

/** Direction of travel in radians on the ground plane (0 = +x). */
export function headingAt(d: number): number {
  return (waves(HEADING_WAVES, d) - waves(HEADING_WAVES, 0)) * startRamp(d);
}

// ---------------------------------------------------------- centreline ----

export const ROAD_STEP = 2;
export const ROAD_ORIGIN = -1000; // distance of sample 0

/** Cached centreline samples: sample i is at distance ROAD_ORIGIN + i * ROAD_STEP. */
export const roadX: number[] = [ROAD_ORIGIN];
export const roadZ: number[] = [0];

/** Makes sure centreline samples exist up to distance `d`. */
export function ensureRoad(d: number) {
  while (ROAD_ORIGIN + (roadX.length - 1) * ROAD_STEP < d + ROAD_STEP) {
    const i = roadX.length - 1;
    const h = headingAt(ROAD_ORIGIN + (i + 0.5) * ROAD_STEP);
    roadX.push(roadX[i] + Math.cos(h) * ROAD_STEP);
    roadZ.push(roadZ[i] + Math.sin(h) * ROAD_STEP);
  }
}

export interface RoadPoint {
  x: number;
  z: number;
  y: number; // elevation
  heading: number;
}

/** Position, elevation and heading of the road centre at distance `d`. */
export function roadPoint(d: number): RoadPoint {
  ensureRoad(d);
  const f = (Math.max(d, ROAD_ORIGIN) - ROAD_ORIGIN) / ROAD_STEP;
  const i = Math.floor(f);
  const t = f - i;
  return {
    x: roadX[i] + (roadX[i + 1] - roadX[i]) * t,
    z: roadZ[i] + (roadZ[i + 1] - roadZ[i]) * t,
    y: elevationAt(d),
    heading: headingAt(d),
  };
}
