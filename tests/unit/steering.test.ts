import { describe, expect, it } from 'vitest';
import { BIKE_LENGTH } from '../../src/draft';
import { DEFAULT_LANE, LANE_MAX, LANE_MIN, STEER_STEP, Steering, clampLane, bendAt, racingLane } from '../../src/steering';
import type { OtherRider } from '../../src/world/others';

/** No steering held, auto-steer on. */
function idle() {
  return { autoSteer: true, distance: 0, riders: [] as OtherRider[], lateralOf: () => undefined };
}

/** A rival `gap` metres ahead (wheel to wheel), wanting lane `lane`. */
function other(gap: number, lane: number): OtherRider {
  return { id: 'r', name: 'Rival', distance: gap + BIKE_LENGTH, speedMs: 8, power: 200, cadence: 90, lane };
}

describe('clampLane', () => {
  it('clamps to the road edges', () => {
    expect(clampLane(LANE_MIN - 5)).toBe(LANE_MIN);
    expect(clampLane(LANE_MAX + 5)).toBe(LANE_MAX);
    expect(clampLane(2.5)).toBe(2.5);
  });

  it('leaves the edge values themselves alone', () => {
    expect(clampLane(LANE_MIN)).toBe(LANE_MIN);
    expect(clampLane(LANE_MAX)).toBe(LANE_MAX);
  });
});

describe('Steering.nudge', () => {
  it('moves by one step in the requested direction', () => {
    const s = new Steering();
    s.nudge(1);
    expect(s.target).toBeCloseTo(DEFAULT_LANE + STEER_STEP, 9);
    s.nudge(-1);
    expect(s.target).toBeCloseTo(DEFAULT_LANE, 9);
  });

  it('does not overshoot past either edge', () => {
    const s = new Steering();
    for (let i = 0; i < 20; i++) s.nudge(1);
    expect(s.target).toBe(LANE_MAX);
    for (let i = 0; i < 40; i++) s.nudge(-1);
    expect(s.target).toBe(LANE_MIN);
  });

  it('holds at the edge it is already on', () => {
    const s = new Steering();
    s.target = LANE_MAX;
    s.nudge(1);
    expect(s.target).toBe(LANE_MAX);
    s.target = LANE_MIN;
    s.nudge(-1);
    expect(s.target).toBe(LANE_MIN);
  });
});

describe('Steering.press', () => {
  it('steps once on press, then repeats while held, and stops on release', () => {
    const s = new Steering();
    s.press(1);
    expect(s.target).toBeCloseTo(DEFAULT_LANE + STEER_STEP, 9);
    // Held: no repeat before the 0.35 s delay...
    s.update(0.2, idle());
    expect(s.target).toBeCloseTo(DEFAULT_LANE + STEER_STEP, 9);
    // ...then one step every 0.22 s.
    s.update(0.2, idle());
    expect(s.target).toBeCloseTo(DEFAULT_LANE + 2 * STEER_STEP, 9);
    s.update(0.22, idle());
    expect(s.target).toBeCloseTo(DEFAULT_LANE + 3 * STEER_STEP, 9);
    s.release(1);
    s.update(1, idle());
    expect(s.target).toBeCloseTo(DEFAULT_LANE + 3 * STEER_STEP, 9);
  });
});

/** A straight road. */
const straight = () => 0;
/** A road that turns right at a steady ~6 % grade of curve (0.05 rad/m) from `from` m. */
const rightBend = (from: number) => (d: number) => (d > from ? (d - from) * 0.05 : 0);
const leftBend = (from: number) => (d: number) => (d > from ? -(d - from) * 0.05 : 0);

describe('bendAt', () => {
  it('is zero on a straight road', () => {
    expect(bendAt(straight, 100)).toBe(0);
  });

  it('is signed: positive to the right, negative to the left, and capped at ±1', () => {
    expect(bendAt(rightBend(0), 100)).toBeGreaterThan(0.9);
    expect(bendAt(leftBend(0), 100)).toBeLessThan(-0.9);
  });
});

describe('racingLane', () => {
  it('rides the middle of the lane on a straight road', () => {
    expect(racingLane(straight, 0)).toBe(DEFAULT_LANE);
  });

  it('is inside the right-hand bend at its apex, and outside of it coming in', () => {
    const road = rightBend(0);
    // Coming up to the bend (16 m of look-ahead): wide, swinging to the edge of the road outside the turn.
    const entering = racingLane(road, -10);
    // In the bend: the inside of the turn is towards the centre line.
    const inside = racingLane(road, 12);
    expect(entering).toBeGreaterThan(DEFAULT_LANE);
    expect(inside).toBeLessThan(DEFAULT_LANE);
  });

  it('mirrors for a left-hand bend', () => {
    // A right-hander's inside takes the lane left; a left-hander's takes it right (and further, as the right
    // edge is further from the middle than the centre line is).
    expect(racingLane(rightBend(0), 12)).toBeLessThan(DEFAULT_LANE);
    const left = racingLane(leftBend(0), 12);
    expect(left).toBeGreaterThan(DEFAULT_LANE);
    expect(left).toBeLessThanOrEqual(LANE_MAX);
  });

  it('never leaves the right-hand half of the road', () => {
    for (const road of [straight, rightBend(0), leftBend(0)]) {
      for (let d = -50; d < 200; d += 3) {
        const lane = racingLane(road, d);
        expect(lane).toBeGreaterThanOrEqual(LANE_MIN);
        expect(lane).toBeLessThanOrEqual(LANE_MAX);
      }
    }
  });
});

describe('Steering racing line', () => {
  const line = { ...idle(), headingAt: straight };

  it('is on by default and moves the target onto the racing line', () => {
    const s = new Steering();
    s.target = LANE_MIN;
    expect(s.racingLine).toBe(true);
    for (let i = 0; i < 200; i++) s.update(0.05, line);
    expect(s.target).toBeCloseTo(DEFAULT_LANE, 6);
  });

  it('yields to the arrow keys until ↑ takes it back', () => {
    const s = new Steering();
    s.nudge(1);
    expect(s.racingLine).toBe(false);
    const afterNudge = s.target;
    for (let i = 0; i < 100; i++) s.update(0.05, line);
    expect(s.target).toBe(afterNudge); // manual: the racing line leaves it alone
    expect(s.backToRacingLine()).toBe(true);
    expect(s.backToRacingLine()).toBe(false); // already back on it
    for (let i = 0; i < 200; i++) s.update(0.05, line);
    expect(s.target).toBeCloseTo(DEFAULT_LANE, 6);
  });

  it('follows a wheel just ahead even while on the racing line', () => {
    const s = new Steering();
    const rider = other(7.5, 3.5);
    for (let i = 0; i < 100; i++) s.update(0.05, { ...line, riders: [rider], lateralOf: () => 3.5 });
    expect(s.target).toBeGreaterThan(3);
  });
});

describe('Steering.update', () => {
  it('does nothing to the lane while auto-steer is off', () => {
    const s = new Steering();
    s.manual(); // by hand, with no racing line
    const rider = other(20, 3);
    for (let i = 0; i < 20; i++) s.update(0.5, { ...idle(), autoSteer: false, riders: [rider], lateralOf: () => 3 });
    expect(s.target).toBe(DEFAULT_LANE);
  });

  it('leaves the lane alone when no rider is within the look-ahead', () => {
    const s = new Steering();
    s.manual();
    const far = other(40, 3);
    const ghost = { ...other(8, 3), ghost: true };
    for (let i = 0; i < 20; i++) s.update(0.5, { ...idle(), riders: [far, ghost], lateralOf: () => 3 });
    expect(s.target).toBe(DEFAULT_LANE);
  });

  it('eases towards the line of a rider just ahead once steering has gone quiet', () => {
    const s = new Steering();
    s.manual();
    const rider = other(7.5, 3); // well inside the 12 m look-ahead
    const dt = 0.1;
    // A steering input now: auto-steer must wait out the idle time.
    s.nudge(-1);
    const start = s.target;
    let sinceInput = 0;
    for (let i = 0; i < 10; i++) {
      s.update(dt, { ...idle(), riders: [rider], lateralOf: () => 3 });
      sinceInput += dt;
    }
    // Still within the 3 s idle time: no auto-steer yet.
    expect(sinceInput).toBeLessThan(3);
    expect(s.target).toBe(start);
    expect(s.target).toBeLessThan(DEFAULT_LANE);

    // Once past it, each frame slides towards their line by at most 1.1 m/s.
    for (let i = 0; i < 60; i++) s.update(dt, { ...idle(), riders: [rider], lateralOf: () => 3 });
    expect(s.target).toBeGreaterThan(start);
    expect(s.target).toBeCloseTo(3, 1); // eased to their line, and no further
  });
});
