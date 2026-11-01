import { beforeEach, describe, expect, it } from 'vitest';
import { ME, type ResultRow } from '../../src/race';
import {
  JERSEY_COLOURS, TOUR_STAGE_IDS, getTour, jerseyHolders, loadTour, myJerseys, onTourChange, priorTotals, quitTour, recordStage,
  refWkg, simulateStage, standings, startTour, tourComplete, tourJersey, tourStageNumber, totals, type TourProgress,
} from '../../src/tour';

const row = (id: string, time: number, sprint = 0, kom = 0): ResultRow => ({ id, name: id, team: -1, time, sprint, kom, you: id === ME });

/** A hand-made tour: three riders over two stages. */
function progress(): TourProgress {
  return {
    id: 'hotw-test',
    seed: 42,
    stage: 2,
    results: [
      { stage: TOUR_STAGE_IDS[0], rows: [['p0-0', 3000, 10, 0], [ME, 3010, 5, 6], ['p1-0', 3050, 0, 3]] },
      { stage: TOUR_STAGE_IDS[1], rows: [[ME, 4000, 0, 4], ['p0-0', 4030, 20, 0], ['p1-0', 4100, 0, 1]] },
    ],
  };
}

beforeEach(() => {
  loadTour(null);
  onTourChange(() => {});
});

describe('tour stages', () => {
  it('tourStageNumber is 1-3 for tour stages, null otherwise', () => {
    expect(tourStageNumber(TOUR_STAGE_IDS[0])).toBe(1);
    expect(tourStageNumber('hell-of-the-west')).toBe(3);
    expect(tourStageNumber('alpe-dhuez')).toBeNull();
  });
});

describe('classifications', () => {
  it('totals add up per rider across stages', () => {
    const t = totals(progress());
    expect(t.get(ME)).toEqual({ time: 7010, sprint: 5, kom: 10 });
    expect(t.get('p0-0')).toEqual({ time: 7030, sprint: 30, kom: 0 });
  });

  it('GC is by total time, points by sprint points, mountains by KOM points', () => {
    const s = standings(progress());
    expect(s.gc.map((r) => r.id)).toEqual([ME, 'p0-0', 'p1-0']);
    expect(s.points.map((r) => r.id)).toEqual(['p0-0', ME, 'p1-0']);
    expect(s.mountains.map((r) => r.id)).toEqual([ME, 'p1-0', 'p0-0']);
    expect(s.gc[0].you).toBe(true);
    expect(s.gc[0].name).toBe('You');
  });

  it('breaks ties on time', () => {
    const p = progress();
    p.results = [{ stage: TOUR_STAGE_IDS[0], rows: [['a', 100, 5, 0], ['b', 90, 5, 0]] }];
    expect(standings(p).points.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('jersey holders: yellow always, green and polka only with points', () => {
    const h = jerseyHolders(progress());
    expect(h.yellow?.id).toBe(ME);
    expect(h.green?.id).toBe('p0-0');
    expect(h.polka?.id).toBe(ME);
    const none = jerseyHolders({ ...progress(), results: [{ stage: TOUR_STAGE_IDS[0], rows: [['a', 100, 0, 0]] }] });
    expect(none.yellow?.id).toBe('a');
    expect(none.green).toBeNull();
    expect(none.polka).toBeNull();
    expect(jerseyHolders(null)).toEqual({ yellow: null, green: null, polka: null });
  });

  it('myJerseys lists the ones you wear', () => {
    expect(myJerseys(progress())).toEqual(['yellow', 'polka']);
    expect(myJerseys(null)).toEqual([]);
  });

  it('tourJersey gives the colours of the best jersey you wear', () => {
    loadTour(progress());
    expect(tourJersey()).toEqual(JERSEY_COLOURS.yellow);
    loadTour(null);
    expect(tourJersey()).toBeNull();
  });
});

describe('progress state', () => {
  it('startTour makes a seeded tour at stage 0 and notifies; quitTour clears it', () => {
    const seen: (TourProgress | null)[] = [];
    onTourChange((p) => seen.push(p));
    const p = startTour();
    expect(p.stage).toBe(0);
    expect(p.results).toEqual([]);
    expect(p.id).toBe(`hotw-${p.seed.toString(36)}`);
    expect(getTour()).toBe(p);
    expect(tourComplete()).toBe(false);
    quitTour();
    expect(getTour()).toBeNull();
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBeNull();
  });

  it('loadTour ignores junk', () => {
    loadTour({ nope: 1 } as unknown as TourProgress);
    expect(getTour()).toBeNull();
    loadTour(progress());
    expect(getTour()?.id).toBe('hotw-test');
  });

  it('recordStage stores a stage, advances the tour, replaces a repeat, and keeps stage order', () => {
    loadTour({ id: 't', seed: 1, stage: 0, results: [] });
    recordStage(TOUR_STAGE_IDS[1], [row(ME, 4000.04), row('a', 4010)]);
    expect(getTour()!.stage).toBe(2);
    recordStage(TOUR_STAGE_IDS[0], [row(ME, 3000), row('a', 3010)]);
    expect(getTour()!.stage).toBe(2); // never goes backwards
    expect(getTour()!.results.map((r) => r.stage)).toEqual([TOUR_STAGE_IDS[0], TOUR_STAGE_IDS[1]]);
    expect(getTour()!.results[1].rows[0][1]).toBe(4000); // rounded to 0.1 s
    recordStage(TOUR_STAGE_IDS[0], [row(ME, 2999)]);
    expect(getTour()!.results).toHaveLength(2);
    expect(getTour()!.results[0].rows[0][1]).toBe(2999);
    recordStage(TOUR_STAGE_IDS[2], [row(ME, 5000)]);
    expect(tourComplete()).toBe(true);
  });

  it('recordStage ignores non-tour stages and does nothing without a tour', () => {
    expect(recordStage(TOUR_STAGE_IDS[0], [row(ME, 1)])).toBeNull();
    loadTour({ id: 't', seed: 1, stage: 0, results: [] });
    recordStage('alpe-dhuez', [row(ME, 1)]);
    expect(getTour()!.results).toEqual([]);
  });

  it('priorTotals counts only stages before the given one', () => {
    const p = progress();
    expect(priorTotals(p, TOUR_STAGE_IDS[0]).size).toBe(0);
    expect(priorTotals(p, TOUR_STAGE_IDS[1]).get(ME)).toEqual({ time: 3010, sprint: 5, kom: 6 });
    expect(priorTotals(null, TOUR_STAGE_IDS[1]).size).toBe(0);
  });
});

describe('refWkg', () => {
  it('is FTP per kilo, clamped to 1.8-5.5', () => {
    expect(refWkg(250, 75)).toBeCloseTo(3.333, 2);
    expect(refWkg(100, 100)).toBe(1.8);
    expect(refWkg(500, 60)).toBe(5.5);
  });
});

describe('simulateStage', () => {
  it('simulates the whole field including you, with plausible results, deterministically', () => {
    const p: TourProgress = { id: 't', seed: 123, stage: 0, results: [] };
    const me = { ftp: 250, riderKg: 75, bikeKg: 9 };
    const a = simulateStage(p, TOUR_STAGE_IDS[1], me);
    const b = simulateStage(p, TOUR_STAGE_IDS[1], me);
    expect(a).toEqual(b);
    expect(a).toHaveLength(37); // 12 teams x 3 + you
    const mine = a.find((r) => r.you)!;
    expect(mine.id).toBe(ME);
    expect(mine.name).toBe('You');
    // 37 km with 600 m of climbing at ~95% of a 250 W FTP: well over an hour, well under three.
    expect(mine.time).toBeGreaterThan(60 * 60);
    expect(mine.time).toBeLessThan(180 * 60);
    for (let i = 1; i < a.length; i++) expect(a[i].time).toBeGreaterThanOrEqual(a[i - 1].time);
    expect(a.some((r) => r.team >= 0 && r.name.includes('('))).toBe(true);
  });

  it('a stronger you finishes higher', () => {
    const p: TourProgress = { id: 't', seed: 5, stage: 0, results: [] };
    const place = (ftp: number) => simulateStage(p, TOUR_STAGE_IDS[0], { ftp, riderKg: 70, bikeKg: 8 }).findIndex((r) => r.you);
    expect(place(380)).toBeLessThan(place(180));
  });
});
