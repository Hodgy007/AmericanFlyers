// The race or scheduled event in progress (src/raceSession.ts): lining a race up, joining and leaving an event, what a finished race
// hands the card (the place, the tour update, the buttons), the lobby strip and group-ride notes, and the commentator's cues.
import { describe, expect, it, vi } from 'vitest';
import { Peloton } from '../../src/peloton';
import { ME, type PanelData, type ResultRow } from '../../src/race';
import type { EventRow } from '../../src/cloud/events';
import { EVENT_REF_WKG } from '../../src/eventSession';
import {
  createRaceSession, lobbyDue, nextTourStage, raceSnapshot, raceStartMessage, riderResult, tourLeadMessage,
  type CommentaryKit, type RaceCommentaryLike, type RaceSessionDeps,
} from '../../src/raceSession';
import { stageById } from '../../src/routes/library';
import { TOUR_STAGE_IDS, type TourProgress } from '../../src/tour';

const row = (id: string, time: number, o: Partial<ResultRow> = {}): ResultRow => ({ id, name: id, team: -1, time, sprint: 0, kom: 0, you: id === ME, ...o });
const stage = stageById('route66');

describe('riderResult', () => {
  it('finds the rider in the results and their place', () => {
    const rows = [row('a', 100), row(ME, 105, { sprint: 3, kom: 2 }), row('b', 110)];
    const { me, place } = riderResult(rows, 999);
    expect(me).toBe(rows[1]);
    expect(place).toBe(2);
  });
  it('makes up a row at the race time when the rider is missing, with place 0', () => {
    const { me, place } = riderResult([row('a', 100)], 321);
    expect(me).toEqual({ id: ME, name: 'You', team: -1, time: 321, sprint: 0, kom: 0, you: true });
    expect(place).toBe(0);
  });
});

describe('nextTourStage', () => {
  const tour = (stagesDone: number): TourProgress => ({
    id: 'hotw-x', seed: 1, stage: stagesDone,
    results: TOUR_STAGE_IDS.slice(0, stagesDone).map((s) => ({ stage: s, rows: [[ME, 100, 0, 0]] })),
  });
  it('is the next stage while the tour is running', () => {
    expect(nextTourStage(1, tour(1))).toBe(TOUR_STAGE_IDS[1]);
    expect(nextTourStage(2, tour(2))).toBe(TOUR_STAGE_IDS[2]);
  });
  it('is null after the last stage, when the tour is complete, or with no tour', () => {
    expect(nextTourStage(3, tour(3))).toBeNull();
    expect(nextTourStage(1, tour(3))).toBeNull();
    expect(nextTourStage(1, null)).toBeNull();
  });
});

describe('the wording', () => {
  it('names the jerseys you lead in lower case', () => {
    expect(tourLeadMessage(['yellow'])).toBe('You lead the tour: yellow jersey!');
    expect(tourLeadMessage(['yellow', 'polka'])).toBe('You lead the tour: yellow jersey and polka-dot jersey!');
  });
  it('says which stage lines up, without the tour name', () => {
    expect(raceStartMessage('Hell of the West · Morgul Bismark', 1)).toBe('Stage 1 of the tour · Morgul Bismark: roll up to the line.');
    expect(raceStartMessage('Route 66', null)).toBe('Route 66: roll up to the line.');
  });
});

describe('lobbyDue', () => {
  it('is between 5 and 30 seconds from the start, in the countdown only', () => {
    expect(lobbyDue({ phase: 'countdown', untilGo: 30 })).toBe(true);
    expect(lobbyDue({ phase: 'countdown', untilGo: 5.01 })).toBe(true);
    expect(lobbyDue({ phase: 'countdown', untilGo: 5 })).toBe(false);
    expect(lobbyDue({ phase: 'countdown', untilGo: 30.1 })).toBe(false);
    expect(lobbyDue({ phase: 'racing', untilGo: 10 })).toBe(false);
  });
});

describe('raceSnapshot', () => {
  const panel = {
    place: 4, total: 37, raceTime: 612, leadPos: 5400, groups: [{ label: 'Bunch', size: 20, gapSec: 3, you: true }],
    jerseys: { yellow: 'You', green: null, polka: null },
  } as unknown as PanelData;
  const course = { finish: 20000, lines: [{ kind: 'sprint', d: 3000 }, { kind: 'summit', d: 8000 }, { kind: 'finish', d: 20000 }, { kind: 'summit', d: 12000 }] };
  it('puts the panel, the rider and the course together', () => {
    const s = raceSnapshot({ course, tourStage: 2 } as never, panel, { distance: 5200, power: 240, ftp: 250 });
    expect(s).toEqual({
      t: 612, place: 4, total: 37, myDistance: 5200, leadDistance: 5400, finish: 20000, power: 240, ftp: 250,
      groups: panel.groups, yellowIsYou: true, tour: true, summits: [8000, 12000], dt: 0.2,
    });
  });
  it('is not a tour stage with no tour stage number, and yellow is not you for another name', () => {
    const s = raceSnapshot({ course, tourStage: null } as never, { ...panel, jerseys: { yellow: 'Hugo', green: null, polka: null } }, { distance: 0, power: 0, ftp: 200 });
    expect(s.tour).toBe(false);
    expect(s.yellowIsYou).toBe(false);
  });
});

// ------------------------------------------------------------- the session ----

const eventRow = (o: Partial<EventRow> = {}): EventRow => ({
  id: 'ev1', kind: 'race', stage_id: 'route66', title: 'Evening race', starts_at: new Date(1_000_000).toISOString(), seed: 7, pace_wkg: null,
  duration_min: 90, waiting: 0, results: 0, my_finish_s: null, ...o,
});

function setup(o: { tour?: TourProgress | null; commentator?: boolean; commentaryWanted?: boolean; gap?: number | null; now?: number } = {}) {
  const real = new Peloton();
  const log: string[] = [];
  const state = { tour: o.tour ?? null, now: o.now ?? 1_000_000, wanted: o.commentaryWanted ?? true, gap: o.gap ?? null, distance: 500, others: 0 };
  const toasts: [string, number | undefined][] = [];
  const later: [string, number, number][] = [];
  const bar = { shown: [] as [string, string][], hidden: 0 };
  const commentator = { enabled: false, tick: vi.fn() };
  let pending: ((kit: CommentaryKit) => void)[] = [];
  const raceCommentary: RaceCommentaryLike = { lobby: vi.fn(), event: vi.fn(), finished: vi.fn(), update: vi.fn() };
  const kit: CommentaryKit = { reset: vi.fn(), create: () => raceCommentary, preload: vi.fn() };
  const peloton = {
    startRace: vi.fn((...a: Parameters<Peloton['startRace']>) => real.startRace(...a)),
    endRace: vi.fn((around?: number) => { log.push(`endRace ${around}`); }),
    startGroupRide: vi.fn(),
    endGroupRide: vi.fn((around?: number) => { log.push(`endGroupRide ${around}`); }),
  };
  const deps: RaceSessionDeps = {
    peloton,
    tour: { get: () => state.tour, record: vi.fn() },
    refWkg: () => 3.1,
    random: () => 0.5,
    serverNow: () => state.now,
    nowS: () => 42,
    rider: () => ({ distance: state.distance, power: 230, ftp: 250 }),
    toast: (text, ms) => { toasts.push([text, ms]); },
    toastLater: (text, d, ms) => { later.push([text, d, ms]); },
    beep: vi.fn(),
    prefetchRaceUi: vi.fn(),
    hidePanel: () => { log.push('hidePanel'); },
    hideCountdown: () => { log.push('hideCountdown'); },
    useCommentary: (run) => { pending.push(run); },
    commentator: () => (o.commentator === false ? null : commentator),
    commentaryWanted: () => state.wanted,
    stopClips: () => { log.push('stopClips'); },
    eventBar: { show: (t, s) => { bar.shown.push([t, s]); }, hide: () => { bar.hidden++; } },
    restagePresence: () => { log.push('restage'); },
    otherRiders: () => state.others,
    groupGap: () => state.gap,
    resetRide: vi.fn(),
    beginRace: vi.fn(),
    openTour: vi.fn(),
  };
  const session = createRaceSession(deps);
  const loadCommentary = () => { const run = pending; pending = []; run.forEach((f) => f(kit)); };
  return { session, deps, peloton, state, toasts, later, bar, log, commentator, raceCommentary, kit, loadCommentary, get pending() { return pending; } };
}

describe('start (a race of your own)', () => {
  it('lines up a seeded field scaled to the rider, with the stage-line toast', () => {
    const t = setup();
    t.session.start(stage, null);
    expect(t.peloton.startRace).toHaveBeenCalledTimes(1);
    const [course, , wkg, seed, conditions] = t.peloton.startRace.mock.calls[0];
    expect(course.finish).toBe(stage.finish);
    expect(wkg).toBe(3.1);
    expect(seed).toBe(500_000_000);
    expect(conditions).toBeUndefined();
    expect(t.session.race?.stage).toBe(stage);
    expect(t.session.race?.tourStage).toBeNull();
    expect(t.session.race?.phase).toBe('countdown');
    expect(t.toasts).toEqual([['Route 66: roll up to the line.'.replace('Route 66', stage.name), 4000]]);
  });
  it('wires the beeps and starts the race screens loading', () => {
    const t = setup();
    t.session.start(stage, null);
    t.session.race!.onBeep(true);
    expect(t.deps.beep).toHaveBeenCalledWith(true);
    expect(t.deps.prefetchRaceUi).toHaveBeenCalledTimes(1);
  });
  it('uses the tour\'s seed, and its earlier totals, on a tour stage', () => {
    const tour: TourProgress = { id: 'hotw-x', seed: 4242, stage: 1, results: [{ stage: TOUR_STAGE_IDS[0], rows: [[ME, 3000, 5, 2]] }] };
    const t = setup({ tour });
    t.session.start(stageById(TOUR_STAGE_IDS[1]), 2);
    expect(t.peloton.startRace.mock.calls[0][3]).toBe(4242);
    expect(t.session.race?.tourStage).toBe(2);
    expect(t.session.race?.prior.get(ME)).toEqual({ time: 3000, sprint: 5, kom: 2 });
    expect(t.toasts[0][0].startsWith('Stage 2 of the tour · ')).toBe(true);
  });
  it('takes a random seed when the tour stage has no tour under way', () => {
    const t = setup({ tour: null });
    t.session.start(stageById(TOUR_STAGE_IDS[0]), 1);
    expect(t.peloton.startRace.mock.calls[0][3]).toBe(500_000_000);
  });
});

describe('the commentator for a race', () => {
  it('is attached once the commentary chunk has loaded, and fed the race\'s events', () => {
    const t = setup();
    t.session.start(stage, null);
    expect(t.pending).toHaveLength(1);
    t.loadCommentary();
    expect(t.kit.reset).toHaveBeenCalledTimes(1);
    t.session.race!.onEvent('Attack!', 'attack');
    expect(t.raceCommentary.event).toHaveBeenCalledWith('Attack!', 'attack');
  });
  it('is dropped if the race ended or changed while the chunk loaded', () => {
    const t = setup();
    t.session.start(stage, null);
    const first = t.session.race!;
    t.session.leave();
    t.loadCommentary();
    expect(t.kit.reset).not.toHaveBeenCalled();
    first.onEvent('x', 'attack');
    expect(t.raceCommentary.event).not.toHaveBeenCalled();
    // and a second race's own request is the one that counts
    t.session.start(stage, null);
    const a = t.pending[0];
    t.session.start(stage, null);
    a(t.kit);
    expect(t.kit.reset).not.toHaveBeenCalled();
  });
  it('preloads the voice clips once, only when commentary is wanted', () => {
    const t = setup({ commentaryWanted: false });
    t.session.start(stage, null);
    t.loadCommentary();
    expect(t.kit.preload).not.toHaveBeenCalled();
    t.state.wanted = true;
    t.session.start(stage, null);
    t.loadCommentary();
    t.session.start(stage, null);
    t.loadCommentary();
    expect(t.kit.preload).toHaveBeenCalledTimes(1);
  });
});

describe('leave', () => {
  it('ends the race, hides its screens and silences the commentator, in that order', () => {
    const t = setup();
    t.session.start(stage, null);
    t.log.length = 0;
    t.session.leave();
    expect(t.session.race).toBeNull();
    expect(t.log).toEqual(['endRace undefined', 'hidePanel', 'hideCountdown', 'stopClips']);
  });
  it('forgets the race commentator', () => {
    const t = setup();
    t.session.start(stage, null);
    t.loadCommentary();
    t.session.leave();
    t.session.updateCommentary(null);
    expect(t.commentator.tick).not.toHaveBeenCalled();
  });
  it('still silences the clips with nothing under way, and touches nothing else', () => {
    const t = setup();
    t.session.leave();
    expect(t.log).toEqual(['stopClips']);
    expect(t.bar.hidden).toBe(0);
  });
  it('leaves a joined event: the group goes, the strip hides and presence restages', () => {
    const t = setup({ now: 1_000_000 + 60_000 });
    t.session.join(eventRow({ kind: 'group_ride', stage_id: stage.id }), stage);
    t.log.length = 0;
    t.bar.hidden = 0;
    t.state.distance = 1234;
    t.session.leave();
    expect(t.session.event).toBeNull();
    expect(t.log).toEqual(['stopClips', 'endGroupRide 1234', 'restage']);
    expect(t.bar.hidden).toBe(1);
  });
});

describe('join', () => {
  it('starts an event race in shared conditions with the event\'s clock, then the lobby', () => {
    const t = setup({ now: 1_000_000 - 90_000 }); // 90 s before the start
    t.session.join(eventRow(), stage);
    expect(t.session.event?.ev).toMatchObject({ id: 'ev1', kind: 'race', stageId: 'route66', title: 'Evening race', startsAtMs: 1_000_000, seed: 7, durationMin: 90 });
    expect(t.session.event?.demoUsed).toBe(false);
    const call = t.peloton.startRace.mock.calls[0];
    expect(call[2]).toBe(EVENT_REF_WKG);
    expect(call[3]).toBe(7);
    expect(call[4]).toBe('event');
    expect(t.session.race?.phase).toBe('countdown');
    expect(t.session.race?.untilGo).toBe(90);
    expect(t.session.race?.tourStage).toBeNull();
    expect(t.session.race?.prior.size).toBe(0);
    expect(t.deps.prefetchRaceUi).toHaveBeenCalled();
    expect(t.log).toEqual(['restage']);
    expect(t.toasts).toEqual([['You’re on the line for Evening race. The start is synchronised for everyone.', 5000]]);
    expect(t.bar.shown).toEqual([['Evening race', 'Starts in 1:30']]);
  });
  it('joins a race already under way: it is racing, the toast says go and the strip is not shown', () => {
    const t = setup({ now: 1_000_000 + 30_000 });
    t.session.join(eventRow(), stage);
    expect(t.session.race?.phase).toBe('racing');
    expect(t.toasts).toEqual([['Evening race is under way. Go!', 5000]]);
    expect(t.bar.shown).toEqual([]);
    expect(t.bar.hidden).toBe(1);
  });
  it('starts a group ride at its pace (2.6 W/kg when none is given) on the event clock, with no race', () => {
    const t = setup({ now: 1_000_000 - 10_000 });
    t.session.join(eventRow({ kind: 'group_ride', pace_wkg: null, seed: 9 }), stage);
    expect(t.session.race).toBeNull();
    expect(t.peloton.startGroupRide).toHaveBeenCalledTimes(1);
    const [wkg, seed, clock] = t.peloton.startGroupRide.mock.calls[0];
    expect([wkg, seed]).toEqual([2.6, 9]);
    expect(clock()).toBe(-10);
    t.state.now += 25_000;
    expect(clock()).toBe(15);
    t.session.join(eventRow({ kind: 'group_ride', pace_wkg: 3.2 }), stage);
    expect(t.peloton.startGroupRide.mock.calls[1][0]).toBe(3.2);
  });
});

describe('eventHolding', () => {
  it('holds a group ride on the line until its start, not a race and not a ride after it', () => {
    const t = setup({ now: 1_000_000 - 5000 });
    expect(t.session.eventHolding()).toBe(false);
    t.session.join(eventRow({ kind: 'group_ride' }), stage);
    expect(t.session.eventHolding()).toBe(true);
    t.state.now = 1_000_000;
    expect(t.session.eventHolding()).toBe(false);
    const r = setup({ now: 1_000_000 - 5000 });
    r.session.join(eventRow(), stage);
    expect(r.session.eventHolding()).toBe(false); // the race's own countdown holds the rider
  });
});

describe('updateEvent', () => {
  it('does nothing with no event', () => {
    const t = setup();
    t.session.updateEvent();
    expect(t.bar.shown).toEqual([]);
    expect(t.bar.hidden).toBe(0);
  });
  it('shows the lobby countdown and who else is on the line', () => {
    const t = setup({ now: 1_000_000 - 125_000 });
    t.session.join(eventRow({ kind: 'group_ride' }), stage);
    t.state.others = 2;
    t.session.updateEvent();
    expect(t.bar.shown.at(-1)).toEqual(['Evening race', 'Starts in 2:05 · 2 other riders on the line']);
    t.state.others = 1;
    t.session.updateEvent();
    expect(t.bar.shown.at(-1)![1]).toBe('Starts in 2:05 · 1 other rider on the line');
  });
  it('words a lobby over an hour long as a countdown label', () => {
    const t = setup({ now: 1_000_000 - 2 * 3600_000 });
    t.session.join(eventRow({ kind: 'group_ride' }), stage);
    expect(t.bar.shown.at(-1)![1]).toBe('starts in 2 h 0 min');
  });
  it('hides the strip once an event race has started', () => {
    const t = setup({ now: 1_000_000 + 5000 });
    t.session.join(eventRow(), stage);
    t.bar.hidden = 0;
    t.session.updateEvent();
    expect(t.bar.hidden).toBe(1);
  });
  describe('on a group ride', () => {
    const start = () => {
      const t = setup({ now: 1_000_000 + 600_000, gap: 0 });
      t.session.join(eventRow({ kind: 'group_ride' }), stage);
      t.toasts.length = 0;
      t.bar.shown.length = 0;
      return t;
    };
    it('says where you are against the group, and how long you have ridden', () => {
      const t = start();
      t.session.updateEvent();
      expect(t.bar.shown.at(-1)).toEqual(['Evening race', 'with the group · 10:00 in']);
      t.state.gap = 40;
      t.session.updateEvent();
      expect(t.bar.shown.at(-1)![1]).toBe('40 m behind the group · 10:00 in');
      t.state.gap = -20.4;
      t.session.updateEvent();
      expect(t.bar.shown.at(-1)![1]).toBe('20 m ahead of the group · 10:00 in');
    });
    it('tells you when you are dropped, and when you are back, and shows the gap off the back', () => {
      const t = start();
      t.state.gap = 150;
      t.session.updateEvent();
      expect(t.toasts).toEqual([['You’ve been dropped. The group keeps its pace and won’t wait: dig in to get back on, or ride your own ride.', 6000]]);
      expect(t.bar.shown.at(-1)![1]).toBe('150 m off the back · 10:00 in');
      t.toasts.length = 0;
      t.state.gap = 5;
      t.session.updateEvent();
      expect(t.toasts).toEqual([['Back with the group. Nice work!', 3500]]);
      expect(t.bar.shown.at(-1)![1]).toBe('with the group · 10:00 in');
    });
    it('says nothing while the pace group does not exist yet', () => {
      const t = start();
      t.state.gap = null;
      t.session.updateEvent();
      expect(t.bar.shown).toEqual([]);
      expect(t.toasts).toEqual([]);
    });
    it('is over after its duration: a toast, then a new ride (which leaves the event)', () => {
      const t = start();
      t.state.now = 1_000_000 + 91 * 60_000;
      t.session.updateEvent();
      expect(t.toasts).toEqual([['The group ride is over. Thanks for riding!', 6000]]);
      expect(t.deps.resetRide).toHaveBeenCalledTimes(1);
      expect(t.bar.shown).toEqual([]);
    });
  });
});

describe('finish', () => {
  const fakeRace = (stg: typeof stage, rows: ResultRow[], time = 1800) => ({ stage: stg, time, results: () => rows }) as never;
  const rows = [row('a', 1790), row(ME, 1800, { sprint: 5, kom: 3 }), row('b', 1810)];

  it('gives the rows, the rider and the place, and offers keep riding and race again for a single race', () => {
    const t = setup();
    const f = t.session.finish(fakeRace(stage, rows));
    expect(f.rows).toBe(rows);
    expect(f.me).toBe(rows[1]);
    expect(f.place).toBe(2);
    expect(f.tour).toBeNull();
    expect(f.actions.map((a) => [a.label, !!a.primary])).toEqual([['Keep riding', false], ['Race again', true]]);
    f.actions[1].onClick();
    expect(t.deps.beginRace).toHaveBeenCalledWith(stage, null);
    expect(t.deps.tour.record).not.toHaveBeenCalled();
    expect(t.later).toEqual([]);
  });
  it('Keep riding does nothing', () => {
    const t = setup();
    const f = t.session.finish(fakeRace(stage, rows));
    expect(() => f.actions[0].onClick()).not.toThrow();
    expect(t.deps.beginRace).not.toHaveBeenCalled();
  });
  it('does not touch a tour when the stage is not a tour stage, even with one under way', () => {
    const tour: TourProgress = { id: 'hotw-x', seed: 1, stage: 0, results: [] };
    const t = setup({ tour });
    const f = t.session.finish(fakeRace(stage, rows));
    expect(t.deps.tour.record).not.toHaveBeenCalled();
    expect(f.tour).toBeNull();
    expect(f.actions[1].label).toBe('Race again');
  });

  describe('on a tour stage', () => {
    const tourState = (done: number, lead: boolean): TourProgress => ({
      id: 'hotw-x', seed: 5, stage: done,
      results: TOUR_STAGE_IDS.slice(0, done).map((s) => ({ stage: s, rows: [[ME, lead ? 100 : 200, lead ? 5 : 0, 0], ['p0-0', 150, 0, 0]] as [string, number, number, number][] })),
    });
    it('records the stage, toasts the jerseys you lead after a delay, and offers the next stage', () => {
      const t = setup({ tour: tourState(1, true) });
      // record() moves the tour on: the toast and the buttons come from the tour as it stands afterwards
      (t.deps.tour.record as ReturnType<typeof vi.fn>).mockImplementation(() => { t.state.tour = tourState(1, true); });
      const stg = stageById(TOUR_STAGE_IDS[0]);
      const f = t.session.finish(fakeRace(stg, rows));
      expect(t.deps.tour.record).toHaveBeenCalledWith(stg.id, rows);
      expect(t.later).toEqual([['You lead the tour: yellow jersey and green jersey!', 1200, 6000]]);
      expect(f.tour).toBe(t.state.tour);
      expect(f.actions.map((a) => [a.label, !!a.primary])).toEqual([['Keep riding', false], ['Next: stage 2', true]]);
      f.actions[1].onClick();
      const [next, n] = (t.deps.beginRace as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(next.id).toBe(TOUR_STAGE_IDS[1]);
      expect(n).toBe(2);
    });
    it('toasts nothing when you lead no classification', () => {
      const t = setup({ tour: tourState(1, false) });
      t.session.finish(fakeRace(stageById(TOUR_STAGE_IDS[0]), rows));
      expect(t.later).toEqual([]);
    });
    it('offers the tour standings after the last stage', () => {
      const t = setup({ tour: tourState(3, false) });
      const f = t.session.finish(fakeRace(stageById(TOUR_STAGE_IDS[2]), rows));
      expect(f.actions.map((a) => [a.label, !!a.primary])).toEqual([['Keep riding', false], ['Tour standings', true]]);
      f.actions[1].onClick();
      expect(t.deps.openTour).toHaveBeenCalledTimes(1);
      expect(t.deps.beginRace).not.toHaveBeenCalled();
    });
    it('does not record with no tour under way: the stage is just a race (race again)', () => {
      const t = setup({ tour: null });
      const f = t.session.finish(fakeRace(stageById(TOUR_STAGE_IDS[1]), rows));
      expect(t.deps.tour.record).not.toHaveBeenCalled();
      expect(f.tour).toBeNull();
      expect(f.actions[1].label).toBe('Race again');
      f.actions[1].onClick();
      const [stg, n] = (t.deps.beginRace as ReturnType<typeof vi.fn>).mock.calls[0];
      expect([stg.id, n]).toEqual([TOUR_STAGE_IDS[1], 2]);
    });
  });
});

describe('endRace and announceFinish', () => {
  it('hands the teams back to the road at the rider\'s distance, hides the panel and ends the event', () => {
    const t = setup({ now: 1_000_000 + 5000 });
    t.session.join(eventRow(), stage);
    t.log.length = 0;
    t.state.distance = 20000;
    t.session.endRace(20000);
    expect(t.session.race).toBeNull();
    expect(t.session.event).toBeNull();
    expect(t.log).toEqual(['endRace 20000', 'hidePanel', 'endGroupRide 20000', 'restage']);
  });
  it('says the finish line through the race commentator, if it has loaded', () => {
    const t = setup();
    t.session.start(stage, null);
    t.session.announceFinish(1);
    expect(t.raceCommentary.finished).not.toHaveBeenCalled();
    t.loadCommentary();
    t.session.announceFinish(3);
    expect(t.raceCommentary.finished).toHaveBeenCalledWith(3);
  });
});

describe('updateCommentary', () => {
  const panel = { place: 1, total: 10, raceTime: 60, leadPos: 400, groups: [], jerseys: { yellow: null, green: null, polka: null } } as unknown as PanelData;

  it('does nothing until the commentator has loaded', () => {
    const t = setup({ commentator: false });
    t.session.start(stage, null);
    t.loadCommentary();
    expect(() => t.session.updateCommentary(panel)).not.toThrow();
    expect(t.raceCommentary.update).not.toHaveBeenCalled();
  });
  it('switches the commentator on or off with the settings and the sound, even with no race', () => {
    const t = setup();
    t.state.wanted = true;
    t.session.updateCommentary(null);
    expect(t.commentator.enabled).toBe(true);
    t.state.wanted = false;
    t.session.updateCommentary(null);
    expect(t.commentator.enabled).toBe(false);
    expect(t.commentator.tick).not.toHaveBeenCalled();
  });
  it('does nothing without a race commentator (not loaded yet)', () => {
    const t = setup();
    t.session.start(stage, null);
    t.session.updateCommentary(panel);
    expect(t.raceCommentary.update).not.toHaveBeenCalled();
  });
  it('says the lobby line in the countdown, and ticks the commentator when there is no panel', () => {
    const t = setup({ now: 1_000_000 - 20_000 });
    t.session.join(eventRow(), stage);
    t.loadCommentary();
    t.session.updateCommentary(null);
    expect(t.raceCommentary.lobby).toHaveBeenCalledTimes(1);
    expect(t.commentator.tick).toHaveBeenCalledTimes(1);
    expect(t.raceCommentary.update).not.toHaveBeenCalled();
  });
  it('does not say the lobby line outside 5 to 30 seconds', () => {
    const t = setup({ now: 1_000_000 - 60_000 });
    t.session.join(eventRow(), stage);
    t.loadCommentary();
    t.session.updateCommentary(null);
    expect(t.raceCommentary.lobby).not.toHaveBeenCalled();
    expect(t.commentator.tick).toHaveBeenCalledTimes(1);
  });
  it('feeds the race picture while racing, with no separate tick of its own', () => {
    const t = setup({ now: 1_000_000 + 5000 });
    t.session.join(eventRow(), stage);
    t.loadCommentary();
    t.session.updateCommentary(panel);
    expect(t.raceCommentary.update).toHaveBeenCalledTimes(1);
    expect(t.raceCommentary.update).toHaveBeenCalledWith(expect.objectContaining({ t: 60, myDistance: 500, power: 230, ftp: 250, finish: stage.finish, tour: false, dt: 0.2 }));
    expect(t.commentator.tick).not.toHaveBeenCalled();
  });
});
