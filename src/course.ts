// The road being ridden, for the current stage: elevation, grade, heading,
// and a cached ground-plane centreline integrated from the heading in 2 m
// steps. For d ≤ 0 the road runs straight back from the start, so there is
// road behind the start line.

import { stageById, type Stage } from './stages';

let stage: Stage = stageById(null);

export function currentStage(): Stage {
  return stage;
}

/** Switches stage and clears the cached centreline. */
export function setStage(next: Stage) {
  stage = next;
  roadX.length = 1;
  roadZ.length = 1;
}

/** Elevation above the start, in metres, at distance `d` metres. */
export function elevationAt(d: number): number {
  return stage.elevationAt(d);
}

/** Road grade as a fraction (0.05 = 5 %) at distance `d`. */
export function gradeAt(d: number): number {
  const h = 2;
  return (elevationAt(d + h) - elevationAt(d - h)) / (2 * h);
}

/** Direction of travel in radians on the ground plane (0 = +x). */
export function headingAt(d: number): number {
  return d <= 0 ? stage.headingAt(0) : stage.headingAt(d);
}

// ---------------------------------------------------------- centreline ----

export const ROAD_STEP = 2;
export const ROAD_ORIGIN = -1000; // distance of sample 0

/** Cached centreline samples: sample i is at distance ROAD_ORIGIN + i * ROAD_STEP. */
export const roadX: number[] = [0];
export const roadZ: number[] = [0];

/** Makes sure centreline samples exist up to distance `d`. */
export function ensureRoad(d: number) {
  if (roadX.length === 1) {
    // Sample 0 sits so that the road passes through the origin at d = 0.
    const h = headingAt(0);
    roadX[0] = Math.cos(h) * ROAD_ORIGIN;
    roadZ[0] = Math.sin(h) * ROAD_ORIGIN;
  }
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
