// Turns rider power into road speed on the virtual course.

const G = 9.81;
const AIR_DENSITY = 1.225; // kg/m³ at sea level
const DRIVETRAIN_EFFICIENCY = 0.976;

export interface RiderParams {
  massKg: number; // rider + bike
  cda: number; // drag area, m² (~0.32 on the hoods)
  crr: number; // rolling resistance coefficient
}

export const DEFAULT_PARAMS: RiderParams = { massKg: 83, cda: 0.32, crr: 0.004 };

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
  const drag = 0.5 * AIR_DENSITY * p.cda * airSpeed * Math.abs(airSpeed); // signed: a strong tailwind pushes you along
  // Cap propulsive force at very low speed (P / v blows up as v → 0).
  const propulsion = (Math.max(0, powerW) * DRIVETRAIN_EFFICIENCY) / Math.max(speedMs, 1.5);
  const accel = (propulsion - gravity - rolling - drag) / (p.massKg + 1.5); // + wheel inertia
  return Math.max(0, speedMs + accel * dt);
}
