import { describe, expect, it } from 'vitest';
import { challengesForWeek, isComplete, isoWeek, parseWeek, POOL, previewWeek, progressText } from '../../src/garage/challenges';
import { md5 } from '../../src/garage/md5';
import { elevationProfile, fitPoints, formatDuration, routeShape } from '../../src/garage/shareCard';
import { shareDataFromRide, shareRideFromActivity } from '../../src/garage/shareUi';
import { stageById } from '../../src/stages';
import type { Activity } from '../../src/cloud/sync';

describe('md5 (used to pick the week the way the database does)', () => {
  it('matches the standard test vectors', () => {
    expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5('The quick brown fox jumps over the lazy dog')).toBe('9e107d9d372bb6826bd81d3542a419d6');
    expect(md5('12345678901234567890123456789012345678901234567890123456789012345678901234567890')).toBe('57edf4a22be3c955ac49da2e2107b67a');
  });
});

describe('ISO weeks', () => {
  it('names the week a date falls in (Monday to Sunday)', () => {
    expect(isoWeek(new Date('2026-11-01T12:00:00Z'))).toBe('2026-W44'); // a Sunday
    expect(isoWeek(new Date('2026-11-02T00:00:00Z'))).toBe('2026-W45'); // the Monday after
    expect(isoWeek(new Date('2024-12-30T10:00:00Z'))).toBe('2025-W01'); // belongs to next year's week 1
    expect(isoWeek(new Date('2027-01-01T10:00:00Z'))).toBe('2026-W53');
    expect(isoWeek(new Date('2026-01-01T00:00:00Z'))).toBe('2026-W01');
  });
});

describe('weekly challenge generation', () => {
  it('picks one challenge from each family, in family order', () => {
    const c = challengesForWeek('2026-W10');
    expect(c).toHaveLength(4);
    expect(c.map((x) => x.family)).toEqual(['climb', 'distance', 'special', 'stages']);
  });

  it('matches what the database picked for week 2026-W44', () => {
    expect(challengesForWeek('2026-W44').map((c) => c.id)).toEqual(['climb-2000', 'ride-50', 'pro-20', 'stages-3']);
  });

  it('agrees with the database for the whole of 2026 (spot checks from public.my_challenges)', () => {
    const fromDb: Record<string, string> = {
      '2026-W01': 'climb-2000,ride-100,days-4,stages-1',
      '2026-W09': 'climb-2000,ride-100,race-win,stages-3',
      '2026-W20': 'climb-1000,ride-100,pro-20,stages-3',
      '2026-W33': 'climb-1000,ride-50,race-podium,stages-3',
      '2026-W45': 'climb-1000,ride-50,race-podium,stages-1',
      '2026-W52': 'climb-2000,ride-100,race-podium,stages-1',
    };
    for (const [week, ids] of Object.entries(fromDb)) expect(challengesForWeek(week).map((c) => c.id).join(','), week).toBe(ids);
  });

  it('is the same every time for a week, and changes from week to week', () => {
    expect(challengesForWeek('2026-W20')).toEqual(challengesForWeek('2026-W20'));
    const seen = new Set<string>();
    for (let w = 1; w <= 52; w++) seen.add(challengesForWeek(`2026-W${String(w).padStart(2, '0')}`).map((c) => c.id).join());
    expect(seen.size).toBeGreaterThan(10);
  });

  it('every challenge in the pool is something you can earn credits for', () => {
    expect(new Set(POOL.map((c) => c.id)).size).toBe(POOL.length);
    for (const c of POOL) {
      expect(c.target).toBeGreaterThan(0);
      expect(c.reward).toBeGreaterThan(0);
    }
  });

  it('previews the current week with nothing done yet', () => {
    const w = previewWeek(new Date('2026-11-04T09:00:00Z'));
    expect(w.week).toBe('2026-W45');
    expect(w.endsAt.toISOString()).toBe('2026-11-09T00:00:00.000Z');
    expect(w.challenges.every((c) => c.progress === 0 && !c.claimed)).toBe(true);
  });

  it('reads my_challenges() and tells whether one is finished', () => {
    const w = parseWeek({
      week: '2026-W44', ends_at: '2026-11-02T00:00:00+00:00',
      challenges: [
        { id: 'climb-2000', title: 'Climb 2,000 m', metric: 'climbed_m', target: 2000, reward: 150, progress: 2400, claimed: false },
        { id: 'ride-50', title: 'Ride 50 km', metric: 'km', target: 50, reward: 80, progress: 12.5, claimed: true },
        { nonsense: true },
      ],
    })!;
    expect(w.challenges).toHaveLength(2);
    expect(isComplete(w.challenges[0])).toBe(true);
    expect(isComplete(w.challenges[1])).toBe(false);
    expect(w.challenges[1].claimed).toBe(true);
    expect(parseWeek({})).toBeNull();
  });

  it('writes progress in plain words, in either unit system', () => {
    const climb = { metric: 'climbed_m' as const, progress: 1240, target: 2000 };
    expect(progressText(climb)).toBe('1,240 / 2,000 m');
    expect(progressText(climb, true)).toBe('4,068 / 6,562 ft');
    expect(progressText({ metric: 'km', progress: 80, target: 50 })).toBe('50 / 50 km');
    expect(progressText({ metric: 'stages', progress: 1, target: 3 })).toBe('1 / 3');
  });
});

describe('share card', () => {
  it('fits a route into a box without squashing it', () => {
    const out = fitPoints([[0, 0], [100, 0], [100, 50]], 10, 20, 200, 200);
    const xs = out.map((p) => p[0]);
    const ys = out.map((p) => p[1]);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(10);
    expect(Math.max(...xs)).toBeLessThanOrEqual(210);
    expect(Math.max(...ys)).toBeLessThanOrEqual(220);
    expect((Math.max(...xs) - Math.min(...xs)) / (Math.max(...ys) - Math.min(...ys))).toBeCloseTo(2, 6); // 100 x 50 stays 2:1
    expect(fitPoints([], 0, 0, 10, 10)).toEqual([]);
  });

  it('walks a stage\'s heading to get its shape, and its elevation to get the profile', () => {
    const alpe = stageById('alpe-dhuez');
    const shape = routeShape(alpe, 0, 14000, 100);
    expect(shape).toHaveLength(101);
    expect(shape[0]).toEqual([0, 0]);
    const length = shape.slice(1).reduce((t, p, i) => t + Math.hypot(p[0] - shape[i][0], p[1] - shape[i][1]), 0);
    expect(length).toBeGreaterThan(5000); // hairpins fold the road back, so the shape is shorter than 14 km
    expect(length).toBeLessThanOrEqual(14000 + 1);
    const profile = elevationProfile(alpe, 0, 14000, 50);
    expect(profile).toHaveLength(51);
    expect(profile[50] - profile[0]).toBeGreaterThan(900);
  });

  it('formats times', () => {
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(-3)).toBe('0:00');
  });

  it('builds the card for a ride, metric or imperial', () => {
    const ride = {
      stage: stageById('alpe-dhuez'), fromM: 0, toM: 14000, title: 'Alpe d\'Huez', subtitle: '1 November 2026', timeS: 4500,
      avgPower: 231.6, climbedM: 1118, distanceM: 14000, headline: '2nd of 12', badges: ['👕 Yellow jersey'], imperial: false, kit: null,
    };
    const d = shareDataFromRide(ride);
    expect(d.stats.map((s) => s.label)).toEqual(['Time', 'Distance', 'Climbed', 'Avg power', 'Avg speed']);
    expect(d.stats[0].value).toBe('1:15:00');
    expect(d.stats[1].value).toBe('14.0 km');
    expect(d.stats[3].value).toBe('232 W');
    expect(d.route.length).toBeGreaterThan(50);
    expect(shareDataFromRide({ ...ride, imperial: true }).stats[1].value).toBe('8.7 mi');
    expect(shareDataFromRide({ ...ride, stage: null }).route).toEqual([]);
  });

  it('builds the card from a saved ride, and has no route for stages it does not know', () => {
    const a = {
      id: 'x', started_at: '2026-10-31T10:00:00Z', title: 'Ride', stage_id: 'alpe-dhuez', stage_name: 'Alpe d\'Huez', finished: true, workout_name: null,
      duration_s: 4500, distance_m: 14000, climbed_m: 1100, avg_power: 230, race_place: 2, race_size: 12, finish_s: 4400,
    } as Activity;
    const r = shareRideFromActivity(a, false, null);
    expect(r.stage?.id).toBe('alpe-dhuez');
    expect(r.headline).toBe('2nd of 12');
    expect(r.badges).toContain('🏁 Finished');
    expect(shareRideFromActivity({ ...a, stage_id: 'my-uploaded-route' }, false, null).stage).toBeNull();
  });
});
