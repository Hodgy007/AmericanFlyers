// A virtual drivetrain that keeps the rider's legs in step with the bike.
//
// On a real bike the cranks and the rear wheel are locked together through
// the gears whenever you pedal, so leg speed follows road speed: a standing
// start begins with slow, heavy pedal strokes that quicken as the bike picks
// up speed. The trainer reports your real cadence; here we shift through a
// normal set of gears so the legs turn at that cadence whenever the gearing
// allows, but always at a rate the wheel speed could actually produce. When
// you stop pedalling the bike freewheels and the legs ease to a stop.

const WHEEL_CIRCUMFERENCE = 2.105; // metres, 700×25c
const CHAINRINGS = [50, 34];
const COGS = [11, 12, 13, 14, 15, 17, 19, 21, 24, 27, 30, 34]; // 11–34 cassette, for steep climbs
/** All gear ratios (chainring ÷ cog), lowest first. */
export const GEARS = [...new Set(CHAINRINGS.flatMap((c) => COGS.map((g) => Math.round((c / g) * 1000) / 1000)))].sort((a, b) => a - b);

const SHIFT_INTERVAL = 0.45; // seconds between single-gear shifts
const DEFAULT_CADENCE = 85; // rpm, when a power meter doesn't report cadence

export class Drivetrain {
  /** Crank angle in radians; decreases as the rider pedals forward. */
  crankAngle = 0;
  /** Crank speed in revolutions per second. */
  crankRate = 0;
  /** Index into GEARS. Starts in the easiest gear, as you would from a standstill. */
  gear = 0;
  /** Side-to-side rock of the bike, radians (bigger when pushing hard at low speed). */
  rock = 0;
  private shiftTimer = 0;
  private rockAmount = 0;

  get ratio() {
    return GEARS[this.gear];
  }

  /**
   * @param speedMs  road speed
   * @param cadence  real cadence from the trainer (0 if not pedalling / unknown)
   * @param power    watts; with power but no cadence we assume a normal cadence
   */
  update(dt: number, speedMs: number, cadence: number, power: number) {
    const pedalling = cadence > 0 || power > 5;
    const wanted = cadence > 0 ? cadence : DEFAULT_CADENCE;

    // Shift one gear at a time toward the gear that matches the wanted cadence.
    this.shiftTimer -= dt;
    if (pedalling && speedMs > 1 && this.shiftTimer <= 0) {
      const ideal = speedMs / ((wanted / 60) * WHEEL_CIRCUMFERENCE);
      const now = this.ratio;
      // A little hysteresis so it doesn't hunt between two gears.
      if (ideal > now * 1.08 && this.gear < GEARS.length - 1) { this.gear++; this.shiftTimer = SHIFT_INTERVAL; }
      else if (ideal < now / 1.08 && this.gear > 0) { this.gear--; this.shiftTimer = SHIFT_INTERVAL; }
    } else if (!pedalling && speedMs < 0.5) {
      // Rolled to a stop: drop back to an easy gear for the next start.
      this.gear = 0;
    }

    // Pedalling: the cranks turn exactly as fast as the wheel allows in this gear.
    // Freewheeling: the legs slow to a stop (they can't go faster than the wheel).
    const geared = speedMs / (this.ratio * WHEEL_CIRCUMFERENCE);
    const target = pedalling ? geared : 0;
    const ease = pedalling ? 1 - Math.exp(-dt / 0.12) : 1 - Math.exp(-dt / 0.35);
    this.crankRate += (target - this.crankRate) * ease;
    if (!pedalling) this.crankRate = Math.min(this.crankRate, geared);
    this.crankAngle -= this.crankRate * 2 * Math.PI * dt;

    // Pedal force ≈ power ÷ crank speed: large on a standing start or a steep
    // climb, small when spinning fast. The bike rocks once per pedal stroke.
    const force = pedalling ? power / Math.max(0.6, this.crankRate) : 0;
    const amount = Math.min(1, force / 650);
    this.rockAmount += (amount - this.rockAmount) * (1 - Math.exp(-dt / 0.4));
    this.rock = this.rockAmount * 0.06 * Math.sin(this.crankAngle);
  }

  reset() {
    this.crankRate = 0;
    this.gear = 0;
    this.rock = 0;
    this.rockAmount = 0;
  }
}
