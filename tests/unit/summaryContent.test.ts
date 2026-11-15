// What the finish and summary cards say (src/summaryContent.ts): the figures for a ride, a workout and the stage (with and
// without a race, split by a workout or not), the ramp test's FTP offer, the titles and the ghost line.
import { describe, expect, it } from 'vitest';
import {
  finishActions, finishFigures, finishItems, finishTitle, ghostComparison, ordinal, rampTestFtp, rideSummaryActions, rideSummaryItems,
  shareHeadline, splitNote, workoutSummaryActions, workoutSummaryItems, type FinishInput, type StatsLike,
} from '../../src/summaryContent';

const stats = (o: Partial<StatsLike> = {}): StatsLike => ({ seconds: 3725, avgPower: 201.6, np: 215.4, avgHr: 148.6, ...o });
const labels = (items: [string, string][]) => items.map(([k]) => k);

describe('ordinal', () => {
  it('handles the teens and the usual endings', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th']);
  });
});

describe('the end-of-ride card', () => {
  it('lists time, distance, power, heart rate and climbing, in metric', () => {
    expect(rideSummaryItems(stats(), { distance: 25340, climbed: 412.4 }, false)).toEqual([
      ['Time', '1:02:05'], ['Distance', '25.34 km'], ['Avg power', '202 W'], ['Norm. power', '215 W'], ['Avg HR', '149 bpm'], ['Climbed', '412 m'],
    ]);
  });

  it('uses miles and feet when imperial, and -- when there is no heart rate', () => {
    const items = rideSummaryItems(stats({ avgHr: 0 }), { distance: 16093.44, climbed: 100 }, true);
    expect(items[1]).toEqual(['Distance', '10.00 mi']);
    expect(items[4]).toEqual(['Avg HR', '--']);
    expect(items[5]).toEqual(['Climbed', '328 ft']);
  });

  it('offers Keep riding and Start a new ride, which runs the callback', () => {
    let n = 0;
    const a = rideSummaryActions(() => { n++; });
    expect(a.map((x) => x.label)).toEqual(['Keep riding', 'Start a new ride']);
    expect(a[0].primary).toBeUndefined();
    expect(a[1].primary).toBe(true);
    a[0].onClick();
    expect(n).toBe(0);
    a[1].onClick();
    expect(n).toBe(1);
  });

  it('says a workout split the trip only for a ride window, and only when the trip was split', () => {
    expect(splitNote(true, false)).toMatch(/^Part of this trip was a workout/);
    expect(splitNote(true, true)).toBe('');
    expect(splitNote(false, false)).toBe('');
  });
});

describe('the workout card', () => {
  const w = { ...stats({ seconds: 1800, avgPower: 180, np: 190 }), tss: (ftp: number) => ftp / 4, work: 324000, best60: 300 };

  it('lists time, power, TSS, energy and heart rate', () => {
    expect(workoutSummaryItems(w, 200, null)).toEqual([
      ['Time', '30:00'], ['Avg power', '180 W'], ['Norm. power', '190 W'], ['TSS', '50'], ['Energy', '324 kJ'], ['Avg HR', '149 bpm'],
    ]);
  });

  it('puts the FTP estimate and best minute first after a ramp test', () => {
    const items = workoutSummaryItems(w, 200, 225);
    expect(labels(items).slice(0, 3)).toEqual(['Est. FTP', 'Best minute', 'Time']);
    expect(items[0][1]).toBe('225 W');
    expect(items[1][1]).toBe('300 W');
  });

  it('the ramp estimate is 75 % of the best minute, for the ramp test only and only with a best minute', () => {
    expect(rampTestFtp(true, 300)).toBe(225);
    expect(rampTestFtp(true, 301)).toBe(226);
    expect(rampTestFtp(true, 0)).toBeNull();
    expect(rampTestFtp(false, 300)).toBeNull();
  });

  it('offers only Done, or "Set my FTP" first after a ramp test', () => {
    expect(workoutSummaryActions(null, () => {}).map((a) => a.label)).toEqual(['Done']);
    const got: number[] = [];
    const a = workoutSummaryActions(225, (f) => got.push(f));
    expect(a.map((x) => x.label)).toEqual(['Set my FTP to 225 W', 'Done']);
    expect(a[0].primary).toBe(true);
    a[0].onClick();
    expect(got).toEqual([225]);
  });
});

describe('the finish card', () => {
  const base = (o: Partial<FinishInput> = {}): FinishInput => ({
    stats: stats({ seconds: 900, avgPower: 150 }),
    totals: { distance: 9000, climbed: 120 },
    whole: true,
    ride: { movingTime: 3600, work: 720000, climbed: 640, startDistance: 0 },
    finish: 30000,
    imperial: false,
    race: null,
    ...o,
  });

  it('a whole-stage ride uses the trip: moving time, work over time, the finish distance and the trip climbing', () => {
    expect(finishItems(base())).toEqual([
      ['Time', '1:00:00'], ['Avg power', '200 W'], ['Avg speed', '30.0 km/h'], ['Climbed', '640 m'], ['Avg HR', '149 bpm'], ['Norm. power', '215 W'],
    ]);
  });

  it('the stage length counts from where the ride started', () => {
    expect(finishItems(base({ ride: { movingTime: 3600, work: 0, climbed: 0, startDistance: 6000 } }))[2]).toEqual(['Avg speed', '24.0 km/h']);
  });

  it('a ride split by a workout uses the window: its seconds, its average power, its distance and climbing', () => {
    expect(finishItems(base({ whole: false }))).toEqual([
      ['Time', '15:00'], ['Avg power', '150 W'], ['Avg speed', '36.0 km/h'], ['Climbed', '120 m'], ['Avg HR', '149 bpm'], ['Norm. power', '215 W'],
    ]);
  });

  it('shows miles per hour and feet when imperial', () => {
    const items = finishItems(base({ imperial: true }));
    expect(items[2]).toEqual(['Avg speed', '18.6 mph']);
    expect(items[3]).toEqual(['Climbed', '2100 ft']);
  });

  it('has no divide-by-zero with no time', () => {
    const items = finishItems(base({ ride: { movingTime: 0, work: 0, climbed: 0, startDistance: 0 } }));
    expect(items.slice(0, 3)).toEqual([['Time', '0:00'], ['Avg power', '0 W'], ['Avg speed', '0.0 km/h']]);
  });

  it('a race replaces the time with place and race time, adds the points and keeps six lines', () => {
    const items = finishItems(base({ race: { place: 3, of: 40, time: 3671, sprint: 5, kom: 12 } }));
    expect(items).toEqual([
      ['Place', '3rd of 40'], ['Race time', '1:01:11'], ['Points', '5 sprint · 12 mountain'], ['Avg power', '200 W'], ['Avg speed', '30.0 km/h'], ['Climbed', '640 m'],
    ]);
  });

  it('the figures the share picture shares are the same ones', () => {
    expect(finishFigures(base())).toEqual({ timeS: 3600, avgPower: 200, climbedM: 640 });
    expect(finishFigures(base({ whole: false }))).toEqual({ timeS: 900, avgPower: 150, climbedM: 120 });
  });

  it('offers Keep riding and Ride it again', () => {
    let n = 0;
    const a = finishActions(() => { n++; });
    expect(a.map((x) => x.label)).toEqual(['Keep riding', 'Ride it again']);
    a[1].onClick();
    expect(n).toBe(1);
  });

  it('titles: finished, or the place after a race', () => {
    expect(finishTitle('Col du Test', null)).toBe('Col du Test: finished!');
    expect(finishTitle('Col du Test', 2)).toBe('Col du Test: 2nd');
  });

  it('the share headline is the race place, else a new personal best against your own ghost, else none', () => {
    expect(shareHeadline({ place: 1, of: 12 }, null, false)).toBe('1st of 12');
    expect(shareHeadline(null, -5, true)).toBe('New personal best');
    expect(shareHeadline(null, -5, false)).toBeUndefined();
    expect(shareHeadline(null, 5, true)).toBeUndefined();
    expect(shareHeadline(null, null, true)).toBeUndefined();
  });

  it('the ghost line says how far ahead or behind, and a new best also changes the title', () => {
    expect(ghostComparison('Stage', -12, { name: 'Me', isMe: true })).toEqual({ title: 'Stage: new personal best!', note: '🏆 0:12 faster than your best' });
    expect(ghostComparison('Stage', -12, { name: 'Ana', isMe: false })).toEqual({ title: null, note: '🏆 0:12 faster than Ana’s ghost' });
    expect(ghostComparison('Stage', 75, { name: 'Me', isMe: true })).toEqual({ title: null, note: '1:15 behind your best' });
  });
});
