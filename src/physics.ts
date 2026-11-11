// Turns rider power into road speed on the virtual course.

const G = 9.81;
export const SEA_LEVEL_AIR_DENSITY = 1.225; // kg/m³, ISA at sea level, 15 °C
const AIR_DENSITY = SEA_LEVEL_AIR_DENSITY;
const DRIVETRAIN_EFFICIENCY = 0.976;

export interface RiderParams {
  massKg: number; // rider + bike
  cda: number; // drag area, m² (~0.32 on the hoods)
  crr: number; // rolling resistance coefficient
  /** Air density, kg/m³ (see `airDensity`). Left out: sea level, so callers that don't know the altitude are unchanged. */
  airDensity?: number;
}

/**
 * Air density in kg/m³ at an altitude in metres above sea level, from the ISA standard atmosphere
 * (troposphere: 15 °C at sea level, cooling 6.5 K per km). About 1.225 at sea level, 1.007 at 2,000 m,
 * 0.819 at 4,000 m. Clamped to -400 m … 6,000 m so a stray elevation can't give silly drag.
 */
export function airDensity(altitudeM: number): number {
  const h = Math.min(6000, Math.max(-400, Number.isFinite(altitudeM) ? altitudeM : 0));
  return SEA_LEVEL_AIR_DENSITY * Math.pow(1 - 2.25577e-5 * h, 4.25588);
}

export const DEFAULT_PARAMS: RiderParams = { massKg: 83, cda: 0.32, crr: 0.004 };

/** Air density on a stage at distance `d`: its altitude above sea level (start altitude plus the climb so far) run through `airDensity`. */
export function airDensityAt(stage: { baseAltitude?: number; elevationAt(d: number): number }, d: number): number {
  return airDensity((stage.baseAltitude ?? 0) + stage.elevationAt(d));
}

/**
 * Advances speed by one time step. Integrating forces (rather than solving the
 * steady-state equation) gives natural momentum: you coast over crests and
 * pick up speed on descents even when you stop pedalling.
 */
export function stepSpeed(
  speedMs: number,
  powerW: number,
  gradeFraction: number,
  dt: number,
  p: RiderParams = DEFAULT_PARAMS,
  /** Wind into your face, m/s (negative: a tailwind). Drag works on air speed = road speed + headwind. Left out: still air. */
  headwindMs = 0,
): number {
  const theta = Math.atan(gradeFraction);
  const gravity = p.massKg * G * Math.sin(theta);
  const rolling = speedMs > 0.01 ? p.crr * p.massKg * G * Math.cos(theta) : 0;
  const airSpeed = speedMs + headwindMs;
  const drag = 0.5 * (p.airDensity ?? AIR_DENSITY) * p.cda * airSpeed * Math.abs(airSpeed); // signed: a strong tailwind pushes you along
  // Cap propulsive force at very low speed (P / v blows up as v → 0).
  const propulsion = (Math.max(0, powerW) * DRIVETRAIN_EFFICIENCY) / Math.max(speedMs, 1.5);
  const accel = (propulsion - gravity - rolling - drag) / (p.massKg + 1.5); // + wheel inertia
  return Math.max(0, speedMs + accel * dt);
}
