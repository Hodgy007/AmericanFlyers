import { afterEach, describe, expect, it, vi } from 'vitest';
import { Peloton } from '../../src/peloton';
import { LiveRace, raceSetup, EVENT_STEP } from '../../src/race';
import {
  BACK_GAP_M, DROPPED_GAP_M, DropWatcher, EVENT_REF_WKG, GROUP_RIDE_OVER_MESSAGE, INELIGIBLE_NOTE, activeEvent, dropMessage, eventHolding,
  eventOver, eventResultEligible, eventStageAvailable, groupRideStatus, joinMessage, lobbyStatus, mergeEventResults, mmss, secondsSinceStart,
} from '../../src/eventSession';
import { stageById } from '../../src/routes/library';
import { wind, WindState, type Climate } from '../../src/world/wind';

describe('event clock', () => {
  const ev = { startsAtMs: 1_000_000, durationMin: 90 };
  it('counts down before the start and up after it', () => {
    expect(secondsSinceStart(ev, 1_000_000 - 30000)).toBe(-30);
    expect(secondsSinceStart(ev, 1_000_000 + 90000)).toBe(90);
  });
  it('a group ride is over after its duration', () => {
    expect(eventOver(ev, 1_000_000 + 89 * 60000)).toBe(false);
    expect(eventOver(ev, 1_000_000 + 91 * 60000)).toBe(true);
  });
});

describe('DropWatcher', () => {
  it('tells you when you fall more than 100 m behind, once, and when you are back', () => {
    const w = new DropWatcher();
    expect(w.update(50, 0)).toBeNull();
    expect(w.update(DROPPED_GAP_M + 1, 10)).toBe('dropped');
    expect(w.isDropped).toBe(true);
    expect(w.update(300, 20)).toBeNull(); // no nagging
    expect(w.update(BACK_GAP_M + 10, 30)).toBeNull(); // not close enough yet (hysteresis)
    expect(w.update(BACK_GAP_M - 1, 40)).toBe('back');
    expect(w.isDropped).toBe(false);
  });
  it('does not repeat the note within 90 s of the last one', () => {
    const w = new DropWatcher();
    expect(w.update(150, 0)).toBe('dropped');
    expect(w.update(10, 5)).toBe('back');
    expect(w.update(150, 20)).toBeNull();
    expect(w.update(150, 95)).toBe('dropped');
  });
  it('reminds a rider who stays off the back, gently', () => {
    const w = new DropWatcher();
    w.update(150, 0);
    expect(w.update(200, 100)).toBeNull();
    expect(w.update(200, 200)).toBe('dropped');
  });
});

describe('mergeEventResults', () => {
  const bots = [
    { name: 'Hugo (Emigrates)', time: 1500, team: 0, you: false },
    { name: 'Luca (Plasma)', time: 1510, team: 1, you: false },
    { name: 'You', time: 1512, team: -1, you: true }, // the sim's own copy of you is replaced
  ];
  it('puts real riders and bots in one list by time, with you once', () => {
    const rows = mergeEventResults(bots, [{ name: 'Sam T.', finish_s: 1505, is_me: false }, { name: 'Simon H.', finish_s: 1511, is_me: true }], 1511);
    expect(rows.map((r) => r.name)).toEqual(['Hugo (Emigrates)', 'Sam T.', 'Luca (Plasma)', 'You']);
    expect(rows.filter((r) => r.kind === 'you')).toHaveLength(1);
    expect(rows.find((r) => r.name === 'Sam T.')!.kind).toBe('real');
  });
  it('ranks you ahead of a bot and a real rider on the same time', () => {
    const rows = mergeEventResults([{ name: 'Bot', time: 100, team: 0, you: false }], [{ name: 'Real', finish_s: 100, is_me: false }], 100);
    expect(rows.map((r) => r.kind)).toEqual(['you', 'real', 'bot']);
  });
});

describe('the same bots on every device', () => {
  const stage = stageById('route66');
  const enabled = wind.enabled;
  afterEach(() => { wind.enabled = enabled; vi.restoreAllMocks(); });

  function makeRace(conditions: 'personal' | 'event' = 'event') {
    const { roster, course } = raceSetup(stage, 196761067);
    const field = new Peloton().startRace(course, roster, EVENT_REF_WKG, 196761067, conditions);
    return new LiveRace(stage, field, new Map());
  }

  it('uses shared still air despite different personal wind, weather, history and frame patterns', () => {
    const sampleWind = vi.spyOn(wind, 'at');
    const run = (enabled: boolean, climate: Climate, history: number, frames: number[]) => {
      const personal = new WindState();
      personal.enabled = enabled;
      personal.setWeather(climate);
      personal.setStage(stage, stage.headingAt(0));
      personal.update(history);
      sampleWind.mockImplementation((heading) => personal.at(heading));
      const race = makeRace();
      let clock = 0;
      race.useEventClock(() => clock);
      for (const dt of frames) {
        personal.update(dt);
        clock += dt;
        race.update(dt, -10, 0);
      }
      expect(race.time).toBe(120);
      return race.field.sim.states();
    };
    const a = run(false, 'clear', 0, Array(960).fill(0.125));
    const b = run(true, 'rain', 1379, Array.from({ length: 960 }, (_, i) => i % 2 ? 0.0625 : 0.1875));
    const late = run(true, 'cloudy', 4321, [120]);
    expect(b).toEqual(a);
    expect(late).toEqual(a);
    expect(Math.max(...a.map((r) => r.pos))).toBeGreaterThan(100);
    expect(sampleWind).not.toHaveBeenCalled();
  });

it('finishes scheduled bots on the same fixed grid regardless of when results are requested', () => {
    wind.enabled = false;
    const run = (finishAt: number) => {
      const race = makeRace();
      let clock = 0;
      race.useEventClock(() => clock);
      race.update(0, 0, 0);
      while (clock < finishAt) {
        clock = Math.min(finishAt, clock + 100);
        race.update(1 / 60, clock === finishAt ? stage.finish! : 0, 12);
      }
      expect(race.playerFinished).toBe(true);
      // The player is away before the field: results must run the rest in on the event's own 0.25 s grid,
      // not the quick-race 0.5 s one, or the rounding of finish times would depend on the request moment.
      expect(race.field.sim.allFinished).toBe(false);
      const step = vi.spyOn(race.field.sim, 'step');
      const results = race.results();
      expect(results.filter((r) => !r.you)).toHaveLength(36);
      expect(step.mock.calls.length).toBeGreaterThan(0);
      expect(step.mock.calls.every(([dt]) => dt === EVENT_STEP)).toBe(true);
      expect(race.results()).toBe(results);
      return {
        crossings: race.course.lines.at(-1)!.crossings.filter((r) => r.id !== 'me'),
        times: results.filter((r) => !r.you).map((r) => [r.id, r.time]),
      };
    };
    expect(run(1600)).toEqual(run(1200));
  });

  it('keeps personal wind for quick races and the default half-second results shortcut', () => {
    const sampleWind = vi.spyOn(wind, 'at');
    const run = (enabled: boolean) => {
      const personal = new WindState();
      personal.enabled = enabled;
      personal.setWeather('rain');
      personal.setStage(stage, stage.headingAt(0));
      sampleWind.mockImplementation((heading) => personal.at(heading));
      const race = makeRace('personal');
      race.update(3, 0, 0); // quick-race countdown
      for (let i = 0; i < 480; i++) {
        personal.update(EVENT_STEP);
        race.update(EVENT_STEP, -10, 0);
      }
      return race;
    };
    const calm = run(false);
    const breezy = run(true);
    expect(breezy.field.sim.states()).not.toEqual(calm.field.sim.states());
    expect(sampleWind).toHaveBeenCalled();
    const complete = vi.spyOn(breezy.field.sim, 'runToEnd').mockImplementation(() => {});
    breezy.results();
    expect(complete).toHaveBeenCalledExactlyOnceWith(undefined, 0.5);
  });
});

describe('joining', () => {
  const row = { id: 'e1', kind: 'race' as const, stage_id: 'route66', title: 'Evening race', starts_at: '2026-01-01T19:30:00Z', seed: 5, pace_wkg: 2.8, duration_min: 90, waiting: 3, results: 0, my_finish_s: null };
  it('turns a schedule row into the active event', () => {
    expect(activeEvent(row, 123)).toEqual({ id: 'e1', kind: 'race', stageId: 'route66', title: 'Evening race', startsAtMs: 123, seed: 5, paceWkg: 2.8, durationMin: 90 });
  });
  it('needs the stage the row names, and a finish line for a race', () => {
    expect(eventStageAvailable(row, { id: 'route66', finish: 1000 })).toBe(true);
    expect(eventStageAvailable(row, { id: 'heartland', finish: 1000 })).toBe(false); // the library gave another stage for an unknown id
    expect(eventStageAvailable(row, { id: 'route66', finish: null })).toBe(false);
    expect(eventStageAvailable({ ...row, kind: 'group_ride' }, { id: 'route66', finish: null })).toBe(true);
  });
  it('holds a group ride on the line before its start, and nothing else', () => {
    const ev = { kind: 'group_ride' as const, startsAtMs: 1000 };
    expect(eventHolding(ev, 999)).toBe(true);
    expect(eventHolding(ev, 1000)).toBe(false);
    expect(eventHolding({ kind: 'race', startsAtMs: 1000 }, 0)).toBe(false);
  });
  it('says on the line or under way', () => {
    expect(joinMessage('Race', -1)).toBe('You’re on the line for Race. The start is synchronised for everyone.');
    expect(joinMessage('Race', 0)).toBe('Race is under way. Go!');
  });
});

describe('the lobby strip', () => {
  it('writes minutes and seconds', () => {
    expect(mmss(0)).toBe('0:00');
    expect(mmss(65.9)).toBe('1:05');
    expect(mmss(754)).toBe('12:34');
  });
  it('counts down the last hour, then switches to a label, and counts the others on the line', () => {
    expect(lobbyStatus(-272, 0)).toBe('Starts in 4:32');
    expect(lobbyStatus(-3599, 1)).toBe('Starts in 59:59 · 1 other rider on the line');
    expect(lobbyStatus(-3600, 3)).toBe('starts in 1 h 0 min · 3 other riders on the line');
    expect(lobbyStatus(-7500, 0)).toBe('starts in 2 h 5 min');
  });
  it('says where you are against the group', () => {
    expect(groupRideStatus(0, false, 125)).toBe('with the group · 2:05 in');
    expect(groupRideStatus(8, false, 0)).toBe('with the group · 0:00 in');
    expect(groupRideStatus(8.5, false, 0)).toBe('9 m behind the group · 0:00 in');
    expect(groupRideStatus(-8.5, false, 0)).toBe('9 m ahead of the group · 0:00 in');
    expect(groupRideStatus(140.4, true, 600)).toBe('140 m off the back · 10:00 in');
    expect(groupRideStatus(10, true, 600)).toBe('10 m off the back · 10:00 in'); // dropped wins until the watcher says you are back
  });
  it('has its messages', () => {
    expect(GROUP_RIDE_OVER_MESSAGE).toBe('The group ride is over. Thanks for riding!');
    expect(dropMessage('dropped').ms).toBe(6000);
    expect(dropMessage('dropped').text).toMatch(/^You’ve been dropped\./);
    expect(dropMessage('back')).toEqual({ text: 'Back with the group. Nice work!', ms: 3500 });
  });
});

describe('what counts towards the results', () => {
  it('needs no demo riding, a real-time clock and some power', () => {
    expect(eventResultEligible(false, 1, 180)).toBe(true);
    expect(eventResultEligible(true, 1, 180)).toBe(false);
    expect(eventResultEligible(false, 5, 180)).toBe(false);
    expect(eventResultEligible(false, 1, 0)).toBe(false);
    expect(INELIGIBLE_NOTE).toBe('Demo rides and sped-up clocks don’t count towards the event results.');
  });
});
