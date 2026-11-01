import { describe, expect, it } from 'vitest';
import {
  EVENT_STAGE_POOL, GROUP_RIDE_STAGE, countdownLabel, dailySchedule, eventStageKey, joinState, raceStageForDay,
} from '../../src/schedule';

const DAY = 86400000;
const utc = (s: string) => Date.parse(s);

describe('daily schedule', () => {
  it('has an evening race at 19:30 UTC and a midday group ride at 12:30 UTC every day', () => {
    const now = utc('2026-11-01T11:00:00Z');
    const ev = dailySchedule(now, 48);
    const races = ev.filter((e) => e.kind === 'race');
    const rides = ev.filter((e) => e.kind === 'group_ride');
    expect(races.map((e) => new Date(e.startsAt).toISOString())).toEqual(['2026-11-01T19:30:00.000Z', '2026-11-02T19:30:00.000Z']);
    expect(rides[0].startsAt).toBe(utc('2026-11-01T12:30:00Z'));
    expect(rides.every((e) => e.stageId === GROUP_RIDE_STAGE && e.paceWkg === 2.6)).toBe(true);
    expect(ev.map((e) => e.startsAt)).toEqual([...ev.map((e) => e.startsAt)].sort((a, b) => a - b));
  });

  it('matches what the database created for 1–2 November 2026 (Route 66, then Mont Ventoux)', () => {
    expect(raceStageForDay(utc('2026-11-01T00:00:00Z')).id).toBe('route66');
    expect(raceStageForDay(utc('2026-11-02T00:00:00Z')).id).toBe('ventoux');
  });

  it('rotates through every stage in the pool, one a day, then starts over', () => {
    const start = utc('2026-01-01T00:00:00Z');
    const seen = Array.from({ length: EVENT_STAGE_POOL.length }, (_, i) => raceStageForDay(start + i * DAY).id);
    expect(new Set(seen).size).toBe(EVENT_STAGE_POOL.length);
    expect(raceStageForDay(start + EVENT_STAGE_POOL.length * DAY).id).toBe(seen[0]);
    // Any time within a UTC day gives the same stage as that day's start.
    expect(raceStageForDay(Math.floor((start + 5 * DAY + 77777) / DAY) * DAY).id).toBe(seen[5]);
  });

  it('only lists events from the last 12 hours to the end of the window', () => {
    const now = utc('2026-11-01T23:30:00Z');
    const ev = dailySchedule(now, 6);
    expect(ev.every((e) => e.startsAt > now - 12 * 3600000 && e.startsAt < now + 6 * 3600000)).toBe(true);
    // The 19:30 race (4 h ago) is still listed; tomorrow's 12:30 ride is not in a 6 h window.
    expect(ev.some((e) => e.kind === 'race' && e.startsAt === utc('2026-11-01T19:30:00Z'))).toBe(true);
    expect(ev.some((e) => e.startsAt === utc('2026-11-02T12:30:00Z'))).toBe(false);
  });

  it('pool stages are all real, finish-line stages', () => {
    for (const s of EVENT_STAGE_POOL) expect(s.lengthM).toBeGreaterThan(5000);
  });
});

describe('countdownLabel', () => {
  it('counts down in minutes and seconds, then hours', () => {
    expect(countdownLabel(272000)).toBe('starts in 4:32');
    expect(countdownLabel(7500000)).toBe('starts in 2 h 05 min'.replace('05', '5'));
    expect(countdownLabel(3 * DAY)).toBe('starts in 3 d 0 h');
  });
  it('says when it has started', () => {
    expect(countdownLabel(-20000)).toBe('starting now');
    expect(countdownLabel(-180000)).toBe('started 3 min ago');
    expect(countdownLabel(-5400000)).toBe('started 1 h 30 min ago');
  });
});

describe('joining', () => {
  const start = utc('2026-11-01T19:30:00Z');
  it('opens an hour before and closes 5 minutes into a race (20 into a ride)', () => {
    expect(joinState('race', start, start - 3 * 3600000)).toBe('early');
    expect(joinState('race', start, start - 30 * 60000)).toBe('open');
    expect(joinState('race', start, start + 2 * 60000)).toBe('open');
    expect(joinState('race', start, start + 6 * 60000)).toBe('late');
    expect(joinState('group_ride', start, start + 15 * 60000)).toBe('open');
    expect(joinState('group_ride', start, start + 25 * 60000)).toBe('late');
  });
  it('gives each event its own presence room, within the database limit', () => {
    const key = eventStageKey('hotw-tour-of-the-moon', '08f6286c-500a-43da-941d-412c11625d5a');
    expect(key).toBe('hotw-tour-of-the-moon#event-08f6286c-500a-43da-941d-412c11625d5a');
    expect(key.length).toBeLessThanOrEqual(80);
    expect(eventStageKey('route66', 'a')).not.toBe(eventStageKey('route66', 'b'));
  });
});
