import { describe, expect, it } from 'vitest';
import {
  achievementPicks, bestTimes, buildSummary, firstName, ftpSummary, greeting, nextEvents, periodTotals, pickStage, pickWorkout,
  planSummary, recentRides, scheduleRows, stageClimb, stageFigures, stageForWorkout, totalsBetween, weekStart, weeklyDistances,
} from '../../src/hub/data';
import type { Activity } from '../../src/cloud/sync';
import type { EventRow } from '../../src/cloud/events';
import { PLANS, complete } from '../../src/plans';
import { STAGES } from '../../src/stages';

/** A ride with sensible defaults; override what matters. */
function ride(over: Partial<Activity> & { started_at: string }): Activity {
  return {
    id: over.id ?? over.started_at, title: 'Ride', stage_id: 'heartland', stage_name: 'Heartland Rollers', finished: false, workout_name: null,
    duration_s: 3600, distance_m: 30000, climbed_m: 300, avg_power: 180, np: null, max_power: null, avg_hr: null, max_hr: null, avg_cadence: null,
    kj: null, tss: 50, ftp: 200, best_power: null, hr_zones: null, power_zones: null, max_hr_setting: null, finish_s: null,
    ...over,
  };
}

// Wednesday 28 October 2026, midday local time.
const NOW = new Date(2026, 9, 28, 12, 0, 0);
const at = (y: number, m: number, d: number, h = 8) => new Date(y, m - 1, d, h).toISOString();

describe('weekly totals', () => {
  it('weeks start on Monday at local midnight', () => {
    const mon = new Date(weekStart(NOW));
    expect([mon.getFullYear(), mon.getMonth(), mon.getDate(), mon.getHours()]).toEqual([2026, 9, 26, 0]);
    expect(new Date(weekStart(new Date(2026, 9, 25, 23, 59))).getDate()).toBe(19); // Sunday belongs to the week before
    expect(new Date(weekStart(new Date(2026, 9, 26, 0, 0))).getDate()).toBe(26);
  });

  it('adds up this week and the last four weeks', () => {
    const acts = [
      ride({ started_at: at(2026, 10, 27), distance_m: 40000, duration_s: 4000, climbed_m: 500, tss: 60 }), // Tuesday: this week
      ride({ started_at: at(2026, 10, 26), distance_m: 10000, duration_s: 1000, climbed_m: 100, tss: 20 }), // Monday 08:00: this week
      ride({ started_at: at(2026, 10, 25), distance_m: 20000, duration_s: 2000, climbed_m: 200, tss: 30 }), // Sunday: last week, in the 4 weeks
      ride({ started_at: at(2026, 10, 1), distance_m: 5000, duration_s: 500, climbed_m: 50, tss: 5 }), // 27 days before: still in
      ride({ started_at: at(2026, 9, 30), distance_m: 99999, duration_s: 9999, climbed_m: 999, tss: 99 }), // 28 days before: out
    ];
    const { week, last4 } = periodTotals(acts, NOW);
    expect(week).toEqual({ rides: 2, timeS: 5000, distanceM: 50000, climbedM: 600, tss: 80 });
    expect(last4).toEqual({ rides: 4, timeS: 7500, distanceM: 75000, climbedM: 850, tss: 115 });
  });

  it('leaves TSS out (null) when no ride has one, and skips rides without it', () => {
    const none = totalsBetween([ride({ started_at: at(2026, 10, 27), tss: null })], 0);
    expect(none.tss).toBeNull();
    expect(none.rides).toBe(1);
    const some = totalsBetween([ride({ started_at: at(2026, 10, 27), tss: null }), ride({ started_at: at(2026, 10, 27), tss: 41.6 })], 0);
    expect(some.tss).toBe(42);
  });

  it('is empty and safe with no rides', () => {
    expect(periodTotals([], NOW).week).toEqual({ rides: 0, timeS: 0, distanceM: 0, climbedM: 0, tss: null });
  });

  it('gives one distance per week, oldest first, ending with this week', () => {
    const acts = [
      ride({ started_at: at(2026, 10, 27), distance_m: 40000 }),
      ride({ started_at: at(2026, 10, 20), distance_m: 10000 }),
      ride({ started_at: at(2026, 10, 21), distance_m: 5000 }),
    ];
    const w = weeklyDistances(acts, NOW, 4);
    expect(w).toHaveLength(4);
    expect(w.map((x) => x.distanceM)).toEqual([0, 0, 15000, 40000]);
    expect(w[3].start).toBe(weekStart(NOW));
    expect(w[2].start).toBeLessThan(w[3].start);
  });
});

describe('best times and recent rides', () => {
  it('keeps the fastest finished whole-stage ride per stage', () => {
    const best = bestTimes([
      ride({ id: 'a', started_at: at(2026, 10, 1), stage_id: 'alpe-dhuez', finished: true, finish_s: 3500 }),
      ride({ id: 'b', started_at: at(2026, 10, 2), stage_id: 'alpe-dhuez', finished: true, finish_s: 3300 }),
      ride({ id: 'c', started_at: at(2026, 10, 3), stage_id: 'alpe-dhuez', finished: true, finish_s: null }), // a demo ride has no time
      ride({ id: 'd', started_at: at(2026, 10, 4), stage_id: 'route66', finished: false, finish_s: 100 }), // didn't finish
      ride({ id: 'e', started_at: at(2026, 10, 5), stage_id: null, finished: true, finish_s: 100 }),
    ]);
    expect(Object.keys(best)).toEqual(['alpe-dhuez']);
    expect(best['alpe-dhuez']).toMatchObject({ finishS: 3300, activityId: 'b' });
  });

  it('lists the newest rides first and caps the list', () => {
    const acts = Array.from({ length: 8 }, (_, i) => ride({ id: `r${i}`, started_at: at(2026, 10, 10 + i) }));
    const rows = recentRides(acts, 3);
    expect(rows.map((r) => r.id)).toEqual(['r7', 'r6', 'r5']);
    expect(rows[0]).toMatchObject({ durationS: 3600, distanceM: 30000, finished: false });
    expect(recentRides([], 5)).toEqual([]);
  });
});

describe('FTP and achievements', () => {
  it('summarises the FTP history', () => {
    const f = ftpSummary([{ ftp: 200, recorded_at: '2026-01-01T00:00:00Z' }, { ftp: 230, recorded_at: '2026-06-01T00:00:00Z' }], 245);
    expect(f).toMatchObject({ current: 245, first: 200, change: 45 });
    expect(f.points).toHaveLength(2);
    expect(ftpSummary([], 200)).toMatchObject({ first: null, change: 0, points: [] });
  });

  it('picks the earned badges and the closest ones to go', () => {
    const mk = (name: string, done: boolean, progress: number) => ({ icon: '*', name, description: '', done, progress, detail: '' });
    const picks = achievementPicks([mk('a', true, 1), mk('b', false, 0.2), mk('c', false, 0.9), mk('d', false, 0.5), mk('e', false, 0), mk('f', true, 1)], 2);
    expect(picks.earned.map((a) => a.name)).toEqual(['a', 'f']);
    expect(picks.next.map((a) => a.name)).toEqual(['c', 'd']);
    expect(picks.total).toBe(6);
  });
});

describe('plan summary', () => {
  const plan = PLANS[0];

  it('finds the next session and what comes after it', () => {
    const s = planSummary(plan, { id: plan.id, started: '2026-10-01', done: [0, 1] });
    expect(s.done).toBe(2);
    expect(s.total).toBe(9);
    expect(s.pct).toBe(22);
    expect(s.next?.index).toBe(2);
    expect(s.upcoming.map((u) => u.index)).toEqual([3, 4, 5]);
    expect(s.complete).toBe(false);
  });

  it('skips sessions ticked off out of order', () => {
    const s = planSummary(plan, { id: plan.id, started: '2026-10-01', done: [0, 2] });
    expect(s.next?.index).toBe(1);
    expect(s.upcoming[0].index).toBe(3);
  });

  it('moves on when a session is completed', () => {
    const p0 = { id: plan.id, started: '2026-10-01', done: [] as number[] };
    const p1 = complete(plan, p0, { workout: plan.weeks[0][0].workout })!;
    expect(planSummary(plan, p1).next?.index).toBe(1);
  });

  it('knows when the plan is complete', () => {
    const all = Array.from({ length: 9 }, (_, i) => i);
    const s = planSummary(plan, { id: plan.id, started: '2026-10-01', done: all });
    expect(s.complete).toBe(true);
    expect(s.next).toBeNull();
    expect(s.pct).toBe(100);
    expect(s.upcoming).toEqual([]);
  });
});

describe('next events', () => {
  const HOUR = 3600000;
  const base = Date.UTC(2026, 9, 28, 12, 0, 0);
  const row = (kind: EventRow['kind'], startMs: number, id = `${kind}-${startMs}`): EventRow => ({
    id, kind, stage_id: 'heartland', title: id, starts_at: new Date(startMs).toISOString(), seed: 1, pace_wkg: null,
    duration_min: kind === 'race' ? 150 : 90, waiting: 0, results: 0, my_finish_s: null,
  });

  it('picks the soonest race and group ride that are not over for joining', () => {
    const rows = [row('race', base + 8 * HOUR), row('group_ride', base + 1 * HOUR), row('race', base + 32 * HOUR), row('group_ride', base + 25 * HOUR)];
    const n = nextEvents(rows, base);
    expect(n.race?.starts_at).toBe(new Date(base + 8 * HOUR).toISOString());
    expect(n.groupRide?.starts_at).toBe(new Date(base + 1 * HOUR).toISOString());
  });

  it('skips events whose join window has closed, but keeps ones that just started', () => {
    const rows = [row('race', base - 10 * 60000), row('race', base + 2 * HOUR), row('group_ride', base - 10 * 60000)];
    const n = nextEvents(rows, base);
    expect(n.race?.starts_at).toBe(new Date(base + 2 * HOUR).toISOString()); // 10 minutes in: too late for a race
    expect(n.groupRide?.starts_at).toBe(new Date(base - 10 * 60000).toISOString()); // a group ride can be joined for 20 minutes
  });

  it('is null for a kind with nothing coming, and works from unsorted input', () => {
    expect(nextEvents([], base)).toEqual({ race: null, groupRide: null });
    const n = nextEvents([row('race', base + 5 * HOUR), row('race', base + 2 * HOUR)], base);
    expect(n.race?.starts_at).toBe(new Date(base + 2 * HOUR).toISOString());
    expect(n.groupRide).toBeNull();
  });

  it('builds server-shaped rows from the daily schedule for signed-out riders', () => {
    const rows = scheduleRows(base, 48);
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.every((r) => r.id.startsWith('sched-'))).toBe(true);
    const n = nextEvents(rows, base);
    expect(n.race).not.toBeNull();
    expect(n.groupRide).not.toBeNull();
    expect(n.race!.duration_min).toBe(150);
    expect(n.groupRide!.duration_min).toBe(90);
  });
});

describe('what Ride starts', () => {
  const stages = STAGES.map((s) => ({ id: s.id, finish: s.finish }));

  it('keeps an endless stage for a workout and otherwise rides the free-ride stage', () => {
    expect(stages.find((s) => s.id === 'heartland')!.finish).toBeNull();
    expect(stageForWorkout('heartland', stages)).toBe('heartland');
    expect(stageForWorkout('alpe-dhuez', stages)).toBe('heartland');
    expect(stageForWorkout('no-such-stage', stages)).toBe('heartland');
  });

  it('picking a route clears the workout; picking a workout sets the stage to suit', () => {
    expect(pickStage({ stageId: 'heartland', workoutId: 'w1' }, 'stelvio')).toEqual({ stageId: 'stelvio', workoutId: null });
    expect(pickWorkout({ stageId: 'stelvio', workoutId: null }, 'w1', stages)).toEqual({ stageId: 'heartland', workoutId: 'w1' });
    expect(pickWorkout({ stageId: 'heartland', workoutId: null }, 'w2', stages)).toEqual({ stageId: 'heartland', workoutId: 'w2' });
  });
});

describe('stage figures', () => {
  it('works out the climbing of a stage and caches it', () => {
    const alpe = STAGES.find((s) => s.id === 'alpe-dhuez')!;
    expect(stageClimb(alpe)).toBeGreaterThan(1000);
    const f = stageFigures(alpe);
    expect(f.lengthM).toBe(alpe.finish);
    expect(stageFigures(alpe)).toBe(f);
    const heartland = STAGES.find((s) => s.id === 'heartland')!;
    expect(stageFigures(heartland).lengthM).toBeNull();
  });
});

describe('small helpers', () => {
  it('greets by the time of day', () => {
    expect(greeting(3)).toBe('Late night');
    expect(greeting(8)).toBe('Good morning');
    expect(greeting(14)).toBe('Good afternoon');
    expect(greeting(21)).toBe('Good evening');
  });

  it('takes a first name, even from an email address', () => {
    expect(firstName('Sam Rider')).toBe('Sam');
    expect(firstName('  Sam  ')).toBe('Sam');
    expect(firstName('sam@example.com')).toBe('sam');
    expect(firstName('')).toBe('');
  });

  it('builds a cacheable summary from rides and FTP history', () => {
    const acts = [ride({ id: 'x', started_at: at(2026, 10, 27), finished: true, stage_id: 'route66', finish_s: 2000 })];
    const s = buildSummary({ acts, ftp: [{ ftp: 200, source: 'signup', recorded_at: '2026-01-01T00:00:00Z' }], riderKg: 75, ftpNow: 210, now: NOW });
    expect(s.rides).toBe(1);
    expect(s.week.rides).toBe(1);
    expect(s.bests.route66.finishS).toBe(2000);
    expect(s.ftp.change).toBe(10);
    expect(s.weekly).toHaveLength(8);
    expect(s.achievements.length).toBeGreaterThan(10);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s); // plain JSON: safe to cache
  });
});
