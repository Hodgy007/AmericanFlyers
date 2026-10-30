// An endless rolling road. Elevation is a deterministic sum of sine waves at
// different wavelengths: long climbs, medium rollers and short kickers.

const WAVES: { amp: number; length: number; phase: number }[] = [
  { amp: 34, length: 5200, phase: 0.0 },
  { amp: 9, length: 1300, phase: 1.7 },
  { amp: 2.2, length: 340, phase: 4.1 },
  { amp: 0.25, length: 90, phase: 2.3 },
];

const FLAT_START_M = 400; // ease in so the ride starts on the flat

function rawElevation(d: number): number {
  let e = 0;
  for (const w of WAVES) e += w.amp * Math.sin((2 * Math.PI * d) / w.length + w.phase);
  return e;
}

/** Elevation above the start, in metres, at distance `d` metres. */
export function elevationAt(d: number): number {
  const ramp = smoothstep(Math.min(1, Math.max(0, d / FLAT_START_M)));
  return (rawElevation(d) - rawElevation(0)) * ramp;
}

/** Road grade as a fraction (0.05 = 5 %) at distance `d`. */
export function gradeAt(d: number): number {
  const h = 2;
  return (elevationAt(d + h) - elevationAt(d - h)) / (2 * h);
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}
