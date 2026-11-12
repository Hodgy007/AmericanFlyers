import { describe, expect, it } from 'vitest';
import {
  EVENT_STAGE_POOL, GROUP_RIDE_STAGE, countdownLabel, dailySchedule, eventStageKey, joinState, poolOnDay, raceStageForDay,
} from '../../src/schedule';
import { stageById } from '../../src/stages';

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

  it('keeps the first nine pool positions as the database has them and adds the American climbs, then the circuits, the coast and Grand Vale, after them', () => {
    expect(EVENT_STAGE_POOL.slice(0, 9).map((s) => s.id)).toEqual([
      'hotw-morgul-bismark', 'alpe-dhuez', 'hotw-tour-of-the-moon', 'stelvio', 'route66', 'ventoux', 'hell-of-the-west', 'tourmalet', 'zoncolan',
    ]);
    expect(EVENT_STAGE_POOL.slice(9).map((s) => s.id)).toEqual(['mt-washington', 'mt-blue-sky', 'mt-diablo', 'flagstaff', 'richmond-worlds', 'central-park', 'harrogate-worlds', 'pacific-coast', 'kestrel-vale-grand']);
    // The SQL picks the (day number mod n)th stage in rotation that day: 1 November 2026 is day 20758.
    expect(raceStageForDay(utc('2026-11-01T00:00:00Z')).id).toBe(EVENT_STAGE_POOL[20758 % 17].id);
  });

  it('rotates through every stage in the pool, one a day, then starts over', () => {
    const start = utc('2026-01-01T00:00:00Z');
    const n = poolOnDay(start / DAY).length;
    const seen = Array.from({ length: n }, (_, i) => raceStageForDay(start + i * DAY).id);
    expect(new Set(seen).size).toBe(n);
    expect(raceStageForDay(start + n * DAY).id).toBe(seen[0]);
    // Any time within a UTC day gives the same stage as that day's start.
    expect(raceStageForDay(Math.floor((start + 5 * DAY + 77777) / DAY) * DAY).id).toBe(seen[5]);
  });

  // The pool grew by Grand Vale. The rotation is "day number mod the number of stages in rotation that day", and the database has already created the
  // events for the days ahead of it (upcoming_events() fills up to 14 days), so a plain append would have moved their stages (and the SQL would have
  // inserted a second race at the same time). A stage with a sinceDay (the schema's since_day) leaves every earlier day as it was.
  describe('adding Grand Vale to the pool', () => {
    // The pool as it was before: 17 stages, in these positions.
    const BEFORE = ['hotw-morgul-bismark', 'alpe-dhuez', 'hotw-tour-of-the-moon', 'stelvio', 'route66', 'ventoux', 'hell-of-the-west', 'tourmalet', 'zoncolan', 'mt-washington', 'mt-blue-sky', 'mt-diablo', 'flagstaff', 'richmond-worlds', 'central-park', 'harrogate-worlds', 'pacific-coast'];
    const grand = EVENT_STAGE_POOL.find((s) => s.id === 'kestrel-vale-grand')!;

    it('is the last position, with a start day in the future of the database that already holds the next two weeks', () => {
      expect(EVENT_STAGE_POOL.indexOf(grand)).toBe(17);
      expect(grand.sinceDay).toBeDefined();
      // 14 December 2026 (the database creates events at most 14 days ahead, so apply the schema more than 15 days before it).
      expect(grand.sinceDay! * DAY).toBe(utc('2026-12-14T00:00:00Z'));
    });

    it('leaves every day before its start day with the stage it already had, so events already in the database keep their stage', () => {
      for (let day = grand.sinceDay! - 400; day < grand.sinceDay!; day++) {
        expect(raceStageForDay(day * DAY).id, `day ${day}`).toBe(BEFORE[day % 17]);
        expect(poolOnDay(day)).toHaveLength(17);
      }
    });

    it('joins the rotation on its start day: eighteen stages from then on, each once every 18 days, Grand Vale included', () => {
      const days = Array.from({ length: 18 }, (_, i) => grand.sinceDay! + i);
      const ids = days.map((day) => raceStageForDay(day * DAY).id);
      expect(poolOnDay(grand.sinceDay!)).toHaveLength(18);
      expect(new Set(ids).size).toBe(18);
      expect(ids).toContain('kestrel-vale-grand');
      expect(raceStageForDay((grand.sinceDay! + 18) * DAY).id).toBe(ids[0]);
    });

    it('lists the same stage for a day in the pre-sign-in schedule as the database creates, across the cutover', () => {
      const now = grand.sinceDay! * DAY - 3 * DAY;
      const races = dailySchedule(now, 24 * 7).filter((e) => e.kind === 'race');
      for (const r of races) expect(r.stageId).toBe(raceStageForDay(Math.floor(r.startsAt / DAY) * DAY).id);
      expect(races.length).toBeGreaterThan(5);
    });

    it('is a real stage with a finish whose length is the pool row', () => {
      expect(Math.round(stageById('kestrel-vale-grand').finish!)).toBe(grand.lengthM);
    });
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
