// The ride simulation step (src/rideSim.ts), driven directly with a fake course and fake collaborators: speed from physics,
// stale power, integration of distance / time / work / climbing, the finish, the start-line hold, the order the hooks run in,
// and a real RideClock feeding it sparse frames.
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, stepSpeed } from '../../src/physics';
import { RideClock } from '../../src/rideClock';
import {
  createRideSim, freshRide, PowerRing, resetRideState, stepRide, STALE_MS, type RideCourse, type RideDeps, type RideSim,
} from '../../src/rideSim';

const straight = (): number => 0; // a dead-straight road: corner braking never bites

function course(o: { grade?: number; finish?: number | null } = {}): RideCourse {
  const grade = o.grade ?? 0;
  return {
    finish: () => (o.finish === undefined ? null : o.finish),
    gradeAt: () => grade,
    elevationAt: (d) => d * grade,
    airDensityAt: () => 1.225,
    headwindAt: () => 0,
    headingAt: () => straight,
  };
}

interface Rig { sim: RideSim; deps: RideDeps; log: string[]; finished: number; setHolding(h: boolean): void; setSaving(s: number): void }

/** A sim and deps whose hooks only record that they were called. */
function rig(o: { grade?: number; finish?: number | null; power?: number; speed?: number } = {}): Rig {
  const sim = createRideSim();
  sim.live.power = o.power ?? 200;
  sim.live.cadence = 85;
  sim.ride.speed = o.speed ?? 0;
  let holding = false;
  let saving = 0;
  const r: Rig = {
    sim, log: [], finished: 0,
    setHolding: (h) => { holding = h; },
    setSaving: (s) => { saving = s; },
    deps: undefined as unknown as RideDeps,
  };
  r.deps = {
    course: course(o),
    demoInput: () => { r.log.push('demo'); return false; },
    surroundings: () => { r.log.push('surroundings'); },
    draftSaving: () => saving,
    rider: () => { r.log.push('rider'); return { massKg: DEFAULT_PARAMS.massKg, cdaFactor: 1, crrDelta: 0 }; },
    proNearby: () => { r.log.push('proNearby'); return false; },
    holding: () => { r.log.push('holding'); return holding; },
    segmentFrame: () => { r.log.push('segment'); },
    onFinish: () => { r.log.push('finish'); r.finished++; },
    drivetrain: { update: () => { r.log.push('drivetrain'); } },
  };
  return r;
}

/** Keeps the trainer "fresh" so the stale check never fires, and steps `seconds` of ride in steps of `dt`. */
function ride(r: Rig, seconds: number, dt = 0.1, start = 0) {
  const n = Math.round(seconds / dt);
  for (let i = 1; i <= n; i++) {
    const now = start + i * dt * 1000;
    r.sim.live.lastReadingAt = now;
    stepRide(r.sim, r.deps, dt, now);
  }
}

/** What physics.ts alone predicts for the same steps. */
function physicsSpeed(power: number, grade: number, seconds: number, dt: number) {
  let v = 0;
  for (let i = 0; i < Math.round(seconds / dt); i++) v = stepSpeed(v, power, grade, dt, { ...DEFAULT_PARAMS, airDensity: 1.225 }, 0);
  return v;
}

describe('speed', () => {
  it('steady power on the flat reaches the speed physics.ts predicts', () => {
    const r = rig({ power: 200 });
    ride(r, 300);
    expect(r.sim.ride.speed).toBeCloseTo(physicsSpeed(200, 0, 300, 0.1), 9);
    expect(r.sim.ride.speed).toBeGreaterThan(8); // about 33 km/h on 200 W
    expect(r.sim.ride.speed).toBeLessThan(12);
  });

  it('a climb slows it, and matches physics on that grade', () => {
    const flat = rig({ power: 200 });
    const hill = rig({ power: 200, grade: 0.08 });
    ride(flat, 120);
    ride(hill, 120);
    expect(hill.sim.ride.speed).toBeLessThan(flat.sim.ride.speed / 2);
    expect(hill.sim.ride.speed).toBeCloseTo(physicsSpeed(200, 0.08, 120, 0.1), 9);
  });

  it('coasts to a stop when power is zero, and never goes negative', () => {
    const r = rig({ power: 0, speed: 10 });
    ride(r, 200);
    expect(r.sim.ride.speed).toBeGreaterThanOrEqual(0);
    expect(r.sim.ride.speed).toBeLessThan(0.5);
  });

  it('is slower in the draft (less air drag)', () => {
    const open = rig({ power: 250 });
    const drafting = rig({ power: 250 });
    drafting.setSaving(0.3);
    ride(open, 120);
    ride(drafting, 120);
    expect(drafting.sim.ride.speed).toBeGreaterThan(open.sim.ride.speed);
  });
});

describe('power and cadence going stale', () => {
  it('zeroes both once the trainer has been silent for more than STALE_MS', () => {
    const r = rig();
    r.sim.live.lastReadingAt = 1000;
    stepRide(r.sim, r.deps, 0.1, 1000 + STALE_MS); // exactly STALE_MS: still fresh
    expect(r.sim.live.power).toBe(200);
    expect(r.sim.live.cadence).toBe(85);
    stepRide(r.sim, r.deps, 0.1, 1000 + STALE_MS + 1);
    expect(r.sim.live.power).toBe(0);
    expect(r.sim.live.cadence).toBe(0);
  });

  it('a new reading makes it fresh again', () => {
    const r = rig();
    r.sim.live.lastReadingAt = 0;
    stepRide(r.sim, r.deps, 0.1, 10_000);
    expect(r.sim.live.power).toBe(0);
    r.sim.live.power = 180;
    r.sim.live.lastReadingAt = 10_050;
    stepRide(r.sim, r.deps, 0.1, 10_100);
    expect(r.sim.live.power).toBe(180);
  });

  it('a demo ride supplies its own power and skips the stale check', () => {
    const r = rig();
    r.deps.demoInput = (now) => { r.sim.live.power = 150; r.sim.live.lastReadingAt = now; return true; };
    r.sim.live.lastReadingAt = 0;
    stepRide(r.sim, r.deps, 0.1, 60_000);
    expect(r.sim.live.power).toBe(150);
  });
});

describe('integration', () => {
  it('distance is the sum of speed × dt, moving time and work follow, and climbing totals the elevation gained', () => {
    const r = rig({ power: 250, grade: 0.03 });
    let expected = 0;
    for (let i = 1; i <= 600; i++) {
      r.sim.live.lastReadingAt = i * 100;
      stepRide(r.sim, r.deps, 0.1, i * 100);
      expected += r.sim.ride.speed * 0.1;
    }
    const { ride: s } = r.sim;
    expect(s.distance).toBeCloseTo(expected, 6);
    expect(s.movingTime).toBeGreaterThan(55); // 60 s, less the first moments before the speed passes 0.3 m/s
    expect(s.movingTime).toBeLessThanOrEqual(60 + 1e-9);
    expect(s.work).toBeCloseTo(250 * s.movingTime, 6);
    expect(s.climbed).toBeCloseTo(s.distance * 0.03, 6);
    expect(s.lastElev).toBeCloseTo(s.distance * 0.03, 6);
  });

  it('descending adds no climbing', () => {
    const r = rig({ power: 100, grade: -0.04 });
    ride(r, 60);
    expect(r.sim.ride.climbed).toBe(0);
    expect(r.sim.ride.lastElev).toBeLessThan(0);
  });

  it('is nearly independent of the step size within the clock\'s 0.1 s substep limit', () => {
    const run = (dt: number) => {
      const r = rig({ power: 220, grade: 0.02 });
      ride(r, 120, dt);
      return r.sim.ride;
    };
    const coarse = run(0.1);
    for (const dt of [0.05, 0.02, 0.01]) {
      const fine = run(dt);
      expect(fine.distance / coarse.distance, `distance at dt ${dt}`).toBeCloseTo(1, 2);
      expect(fine.movingTime, `moving time at dt ${dt}`).toBeCloseTo(coarse.movingTime, 0);
      expect(fine.work / coarse.work, `work at dt ${dt}`).toBeCloseTo(1, 2);
      expect(fine.climbed / coarse.climbed, `climbed at dt ${dt}`).toBeCloseTo(1, 2);
    }
  });

  it('adds distance ridden near a pro team only while moving, and not once finished', () => {
    const r = rig({ power: 200, speed: 8 });
    r.deps.proNearby = () => true;
    ride(r, 10);
    expect(r.sim.ride.proM).toBeGreaterThan(70);
    const before = r.sim.ride.proM;
    r.sim.ride.finished = true;
    ride(r, 10);
    expect(r.sim.ride.proM).toBe(before);
  });
});

describe('not riding', () => {
  it('accumulates no moving time or work while stopped (no power, no speed)', () => {
    const r = rig({ power: 0, speed: 0 });
    ride(r, 30);
    expect(r.sim.ride).toMatchObject({ speed: 0, distance: 0, movingTime: 0, work: 0 });
  });

  it('holds the rider on the line while a race or event is waiting to start, whatever the power', () => {
    const r = rig({ power: 300, speed: 6 });
    r.setHolding(true);
    const riding: boolean[] = [];
    r.deps.segmentFrame = (_d, _t, _w, ok) => { riding.push(ok); };
    ride(r, 10);
    expect(r.sim.ride).toMatchObject({ speed: 0, distance: 0, movingTime: 0, work: 0 });
    expect(riding.every((x) => x === false)).toBe(true);
    r.setHolding(false);
    ride(r, 10, 0.1, 10_000);
    expect(r.sim.ride.distance).toBeGreaterThan(0);
    expect(riding.at(-1)).toBe(true);
  });
});

describe('the finish', () => {
  it('is detected once, at the finish distance, and the ride then stops accumulating', () => {
    const r = rig({ power: 250, speed: 10, finish: 250, grade: 0.02 });
    ride(r, 60);
    const s = r.sim.ride;
    expect(r.finished).toBe(1);
    expect(s.finished).toBe(true);
    expect(s.distance).toBeGreaterThanOrEqual(250);
    // 10 m/s from 0: the step that crossed 250 m was within one step's reach of the line.
    const { movingTime, work, climbed } = { ...s };
    ride(r, 30, 0.1, 60_000);
    expect(r.finished).toBe(1);
    expect(r.sim.ride.movingTime).toBe(movingTime);
    expect(r.sim.ride.work).toBe(work);
    expect(r.sim.ride.climbed).toBe(climbed);
    expect(r.sim.ride.distance).toBeGreaterThan(s.distance - 1e-9); // the road goes on past the line, as before
  });

  it('is not detected on an endless stage', () => {
    const r = rig({ power: 250, speed: 10, finish: null });
    ride(r, 120);
    expect(r.finished).toBe(0);
    expect(r.sim.ride.finished).toBe(false);
  });

  it('the finish hook sees the ride already marked finished, and the position past the line', () => {
    const r = rig({ speed: 12, finish: 100 });
    let seen: { finished: boolean; distance: number } | null = null;
    r.deps.onFinish = () => { seen = { finished: r.sim.ride.finished, distance: r.sim.ride.distance }; };
    ride(r, 20);
    expect(seen).not.toBeNull();
    expect(seen!.finished).toBe(true);
    expect(seen!.distance).toBeGreaterThanOrEqual(100);
    expect(seen!.distance).toBeLessThan(102);
  });
});

describe('order of the hooks', () => {
  it('runs input, surroundings, physics, the hold, the KOM frame, the finish, the drivetrain; the power average comes last', () => {
    const r = rig({ speed: 12, finish: 1 });
    stepRide(r.sim, r.deps, 0.1, 100);
    expect(r.log).toEqual([
      'demo', 'surroundings', 'rider', 'proNearby', 'holding', 'holding', 'segment', 'finish', 'drivetrain',
    ]);
    expect(r.sim.power.count).toBe(1);
  });

  it('skips the pro-team check when the rider is not moving', () => {
    const r = rig({ power: 0, speed: 0 });
    stepRide(r.sim, r.deps, 0.1, 100);
    expect(r.log).not.toContain('proNearby');
  });

  it('the KOM frame sees the new distance before the finish check (a climb topping out at the line counts)', () => {
    const r = rig({ speed: 12, finish: 10 });
    const seen: { distance: number; finished: boolean }[] = [];
    r.deps.segmentFrame = (d) => { seen.push({ distance: d, finished: r.sim.ride.finished }); };
    stepRide(r.sim, r.deps, 1, 100);
    expect(seen).toHaveLength(1);
    expect(seen[0].distance).toBeGreaterThan(10);
    expect(seen[0].finished).toBe(false);
    expect(r.sim.ride.finished).toBe(true);
  });
});

describe('the power average and resetting', () => {
  it('averages the samples of the last 3 seconds and drops older ones', () => {
    const ring = new PowerRing();
    ring.push(0, 100);
    ring.push(1000, 200);
    ring.push(2000, 300);
    expect(ring.count).toBe(3);
    expect(ring.mean()).toBe(200);
    ring.push(3500, 400); // the sample at 0 is now over 3 s old
    expect(ring.count).toBe(3);
    expect(ring.mean()).toBe(300);
    expect(new PowerRing().mean()).toBe(0);
  });

  it('wraps without losing samples (more than the ring holds)', () => {
    const ring = new PowerRing();
    for (let i = 0; i < 7000; i++) ring.push(i, 100); // 1 ms apart: the ring caps at its size
    expect(ring.count).toBeLessThanOrEqual(3000);
    expect(ring.mean()).toBe(100);
  });

  it('resetRideState zeroes the ride and the average but leaves the same objects, and the devices, alone', () => {
    const r = rig({ power: 250, speed: 9 });
    ride(r, 20);
    const { ride: rideObj, live, power } = r.sim;
    resetRideState(r.sim);
    expect(r.sim.ride).toBe(rideObj);
    expect(r.sim.live).toBe(live);
    expect(r.sim.power).toBe(power);
    expect(rideObj).toEqual(freshRide());
    expect(power.count).toBe(0);
    expect(live.power).toBe(250);
  });
});

describe('driven by a real RideClock', () => {
  /** Rides `seconds` of real time with frames `gapMs` apart, as main.ts does: the clock makes the substeps, the sim steps each. */
  function ridden(gapMs: number, o: { seconds: number; scale?: number; limits?: { maxCatchUpMs?: number; dropAboveMs?: number } }) {
    const r = rig({ power: 230, grade: 0.015 });
    const clock = new RideClock(o.scale ?? 1);
    let now = 0;
    clock.reset(now);
    while (now < o.seconds * 1000) {
      now += gapMs;
      r.sim.live.lastReadingAt = now; // the trainer keeps talking
      const s = clock.advance(now, o.limits);
      for (let i = 0; i < s.count; i++) stepRide(r.sim, r.deps, s.dt, s.startMs + (i + 1) * s.realMs);
    }
    return r.sim.ride;
  }

  it('sparse frames (5 s apart, the catch-up cap) give the same ride as dense frames', () => {
    const dense = ridden(16, { seconds: 300 });
    const sparse = ridden(5000, { seconds: 300, limits: { maxCatchUpMs: 5000 } });
    expect(sparse.distance / dense.distance).toBeCloseTo(1, 2);
    expect(sparse.movingTime).toBeCloseTo(dense.movingTime, 0);
    expect(sparse.work / dense.work).toBeCloseTo(1, 2);
    expect(sparse.climbed / dense.climbed).toBeCloseTo(1, 2);
  });

  it('moving time tracks the wall clock', () => {
    const r = ridden(1000, { seconds: 120 });
    expect(r.movingTime).toBeGreaterThan(118);
    expect(r.movingTime).toBeLessThanOrEqual(120 + 1e-6);
  });

  it('?timescale runs the ride that many times faster', () => {
    const slow = ridden(100, { seconds: 60 });
    const fast = ridden(100, { seconds: 60, scale: 8 });
    expect(fast.movingTime).toBeGreaterThan(470); // 60 s × 8, less the first moments from a standstill
    expect(fast.movingTime).toBeLessThanOrEqual(480 + 1e-6);
    expect(fast.distance).toBeGreaterThan(slow.distance * 7);
  });
});
