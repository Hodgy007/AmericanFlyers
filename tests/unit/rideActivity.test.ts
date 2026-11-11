import { describe, expect, it } from 'vitest';
import { RideStats } from '../../src/stats';
import { activityTitle, baselineAt, buildActivityRow, climbedSince, distanceSince, proSince, worthSaving, type ActivityInput } from '../../src/rideActivity';

describe('activity baselines', () => {
  it('measure distance, climbing and pro distance since a window began', () => {
    const trip = { distance: 5000, startDistance: 1000, climbed: 120, proM: 300 };
    const b = baselineAt(trip); // the trip was 4 km in when the window began
    expect(b).toEqual({ dist: 4000, climbed: 120, proM: 300 });
    const later = { distance: 9500, startDistance: 1000, climbed: 200, proM: 450 };
    expect(distanceSince(later, b)).toBe(4500);
    expect(climbedSince(later, b)).toBe(80);
    expect(proSince(later, b)).toBe(150);
  });
  it('stay consistent when a demo jump moves the start with the distance', () => {
    const b = baselineAt({ distance: 3000, startDistance: 0, climbed: 50, proM: 0 });
    // a jump of 2 km: distance and startDistance both move, the ride's own distance does not
    expect(distanceSince({ distance: 5100, startDistance: 2000, climbed: 50, proM: 0 }, b)).toBe(100);
  });
  it('never go negative', () => {
    const b = baselineAt({ distance: 3000, startDistance: 0, climbed: 50, proM: 10 });
    expect(distanceSince({ distance: 2000, startDistance: 0, climbed: 40, proM: 5 }, b)).toBe(0);
    expect(climbedSince({ distance: 2000, startDistance: 0, climbed: 40, proM: 5 }, b)).toBe(0);
  });
});

describe('worth saving', () => {
  it('needs a minute, and something new since the last save', () => {
    expect(worthSaving(59, 0, 60)).toBe(false);
    expect(worthSaving(60, 0, 60)).toBe(true);
    expect(worthSaving(300, 300, 60)).toBe(false);
    expect(worthSaving(301, 300, 60)).toBe(true);
  });
});

describe('activity title', () => {
  it('names a workout after itself and a ride after the stage', () => {
    expect(activityTitle('Sweet spot', 'Alpe d’Huez')).toBe('Sweet spot · Alpe d’Huez');
    expect(activityTitle(null, 'Alpe d’Huez')).toBe('Alpe d’Huez');
  });
});

describe('buildActivityRow', () => {
  const stats = new RideStats(() => ({ ftp: 250, maxHr: 185 }));
  for (let i = 0; i < 120; i++) stats.add(1, 200, 90, 140, true);
  const input: ActivityInput = {
    id: 'w1', startedAt: new Date('2026-02-02T08:00:00Z'),
    samples: { power: [1], cadence: [1], hr: [1], speed: [1], distance: [1], elevation: [1] },
    stats, stage: { id: 's', name: 'Stage' }, workout: 'Over-unders', workoutCompleted: 'Over-unders',
    finished: false, distanceM: 2345.6, climbedM: 77.4, finishS: null, demo: false,
    racePlace: null, raceSize: null, proM: 0, ftp: 250, maxHr: 185,
  };
  it('puts the window’s own numbers in the row', () => {
    const a = buildActivityRow(input);
    expect(a).toMatchObject({ id: 'w1', title: 'Over-unders · Stage', workout_name: 'Over-unders', duration_s: 120, distance_m: 2346, climbed_m: 77, avg_power: 200, finish_s: null, demo: false, finished: false, pro_m: null });
    expect(a.started_at).toBe('2026-02-02T08:00:00.000Z');
    expect(a.best_power).toEqual({ 5: 200, 60: 200 });
  });
  it('leaves workout_name empty for a workout that was stopped, and keeps a finish time only when given', () => {
    const a = buildActivityRow({ ...input, workoutCompleted: null, finishS: 1800.4, racePlace: 3, raceSize: 40, proM: 99.6 });
    expect(a.workout_name).toBeNull();
    expect(a.title).toBe('Over-unders · Stage');
    expect(a).toMatchObject({ finish_s: 1800, race_place: 3, race_size: 40, pro_m: 100 });
  });
});
