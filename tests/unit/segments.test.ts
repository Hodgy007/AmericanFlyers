// KOM segments (src/segments.ts): which climbs each built-in stage has (ids pinned, so a detector tweak can't silently
// orphan leaderboards), timing an effort (pause-void, jumps, laps), the 50 m splits and the live gap by interpolation.
import { describe, expect, it } from 'vitest';
import {
  SPLIT_M, SegmentTracker, distanceAt, gapSeconds, gapText, judgeEffort, resultText, segmentStatus, segmentTime, segmentsFor, shortStageName, timeAt,
  type Effort, type Segment,
} from '../../src/segments';
import { STAGES, stageById } from '../../src/stages';

/** id, name, start, end (metres, rounded) for every built-in stage. Changing any of these changes a leaderboard: add a row to db/schema.sql's segment_limits too. */
const PINNED: Record<string, [string, string, number, number][]> = {
  'heartland': [],
  'route66': [],
  'hotw-morgul-bismark': [['hotw-morgul-bismark:the-wall', 'The Wall', 20175, 21131]],
  'hotw-tour-of-the-moon': [
    ['hotw-tour-of-the-moon:cold-shivers', 'Cold Shivers', 2425, 6800],
    ['hotw-tour-of-the-moon:the-high-point', 'The high point', 12400, 13150],
  ],
  'hell-of-the-west': [['hell-of-the-west:echo-lake', 'Echo Lake', 11850, 20800]],
  'alpe-dhuez': [['alpe-dhuez:main', 'Alpe d\'Huez', 25, 14000]],
  'stelvio': [['stelvio:main', 'Stelvio Pass', 525, 24500]],
  'ventoux': [['ventoux:main', 'Mont Ventoux', 3450, 21400]],
  'tourmalet': [['tourmalet:main', 'Col du Tourmalet', 675, 19000]],
  'zoncolan': [['zoncolan:main', 'Monte Zoncolan', 50, 10100]],
  'mt-washington': [['mt-washington:main', 'Mount Washington', 125, 12200]],
  'mt-blue-sky': [['mt-blue-sky:main', 'Mount Blue Sky', 50, 23300]],
  'mt-diablo': [['mt-diablo:main', 'Mount Diablo', 2150, 18000]],
  'flagstaff': [['flagstaff:main', 'Flagstaff Mountain', 25, 7400]],
};

describe('segment detection on the built-in stages', () => {
  it('pins every stage: ids, names and where each segment starts and ends', () => {
    expect(Object.keys(PINNED).sort()).toEqual(STAGES.map((s) => s.id).sort()); // a new stage needs a row here
    for (const s of STAGES) {
      const got = segmentsFor(s).map((g) => [g.id, g.name, Math.round(g.start / 25) * 25, Math.round(g.end / 25) * 25] as const);
      const want = PINNED[s.id].map(([id, name, a, b]) => [id, name, Math.round(a / 25) * 25, Math.round(b / 25) * 25] as const);
      expect(got, s.id).toEqual(want);
    }
  });

  it('gives each single-climb stage exactly one main segment, and rolling stages their named climbs', () => {
    for (const id of ['alpe-dhuez', 'ventoux', 'tourmalet', 'mt-washington', 'flagstaff', 'stelvio', 'zoncolan', 'mt-diablo', 'mt-blue-sky']) {
      const segs = segmentsFor(stageById(id));
      expect(segs.map((g) => g.id), id).toEqual([`${id}:main`]);
    }
    expect(segmentsFor(stageById('hotw-morgul-bismark')).map((g) => g.name)).toEqual(['The Wall']);
    expect(segmentsFor(stageById('hotw-tour-of-the-moon')).map((g) => g.name)).toEqual(['Cold Shivers', 'The high point']);
    expect(segmentsFor(stageById('hell-of-the-west')).map((g) => g.name)).toEqual(['Echo Lake']);
    expect(segmentsFor(stageById('hell-of-the-west'))[0].end).toBe(stageById('hell-of-the-west').finish); // runs to the line at Echo Lake
    expect(segmentsFor(stageById('heartland'))).toEqual([]);
    expect(segmentsFor(stageById('route66'))).toEqual([]);
  });

  it('only meets the size thresholds, has unique ids, and makes Morgul-Bismark’s wall a segment ridden on each of its two laps', () => {
    const ids = new Set<string>();
    for (const s of STAGES) {
      for (const g of segmentsFor(s)) {
        expect(g.length, g.id).toBeGreaterThanOrEqual(750);
        expect(g.gain, g.id).toBeGreaterThanOrEqual(49);
        expect(g.shared).toBe(true);
        expect(ids.has(g.id)).toBe(false);
        ids.add(g.id);
      }
    }
    const wall = segmentsFor(stageById('hotw-morgul-bismark'))[0];
    expect(wall.passes).toBe(2);
    expect(wall.lap).toBeCloseTo(stageById('hotw-morgul-bismark').lapLength!, 6);
    expect(wall.end).toBeLessThanOrEqual(wall.lap!);
  });

  it('caches per stage and finds none on an endless stage', () => {
    const a = stageById('alpe-dhuez');
    expect(segmentsFor(a)).toBe(segmentsFor(a));
    expect(segmentsFor({ ...stageById('heartland'), finish: null })).toEqual([]);
  });

  it('keeps an uploaded route’s segments local (no shared board)', () => {
    const route = { ...stageById('alpe-dhuez'), id: 'route-abc', uploaded: true };
    const segs = segmentsFor(route);
    expect(segs.length).toBeGreaterThan(0);
    expect(segs.every((g) => !g.shared && g.id.startsWith('route-abc:'))).toBe(true);
  });

  it('shortens a tour stage’s name', () => {
    expect(shortStageName('Hell of the West · Stage 2: Tour of the Moon')).toBe('Tour of the Moon');
    expect(shortStageName('Alpe d\'Huez')).toBe('Alpe d\'Huez');
  });
});

// ------------------------------------------------------------------ timing ----

const SEG: Segment = { id: 't:climb', stageId: 't', name: 'Test climb', start: 1000, end: 1500, length: 500, gain: 40, avg: 0.08, max: 0.1, passes: 1, shared: true };
const LAPS: Segment = { ...SEG, id: 't:laps', start: 1000, end: 1500, lap: 3000, passes: 2 };

/** Rides at a steady `v` m/s, `dt` per frame, from `from` metres to `to`, optionally stopping for `stopFor` s on reaching `stopAt`. */
function ride(tracker: SegmentTracker, o: { from: number; to: number; v: number; dt?: number; power?: number; stopAt?: number; stopFor?: number }) {
  const dt = o.dt ?? 0.1;
  let d = o.from;
  let t = 0;
  let w = 0;
  let stopped = false;
  tracker.update(d, t, w, true);
  while (d < o.to) {
    if (o.stopAt !== undefined && !stopped && d >= o.stopAt) {
      stopped = true;
      for (let i = 0; i < (o.stopFor ?? 0) / dt; i++) tracker.update(d, t, w, false);
    }
    d += o.v * dt;
    t += dt;
    w += (o.power ?? 300) * dt;
    tracker.update(d, t, w, true);
  }
  return t;
}

function collect(segments: Segment[]) {
  const finished: { seg: Segment; pass: number; e: Effort }[] = [];
  const voided: string[] = [];
  const started: number[] = [];
  const tracker = new SegmentTracker({
    start: (_s, p) => started.push(p),
    finish: (seg, pass, e) => finished.push({ seg, pass, e }),
    voided: (_s, _p, why) => voided.push(why),
  });
  tracker.setSegments(segments);
  return { tracker, finished, voided, started };
}

describe('timing an effort', () => {
  it('times start to top in moving time, with a split every 50 m and the average power', () => {
    const { tracker, finished } = collect([SEG]);
    ride(tracker, { from: 900, to: 1600, v: 5, power: 320 });
    expect(finished).toHaveLength(1);
    const { e } = finished[0];
    expect(e.t).toBeCloseTo(100, 1); // 500 m at 5 m/s
    expect(e.p).toBe(320);
    expect(e.s).toHaveLength(9); // 50, 100 ... 450 m (the top is `t`)
    expect(e.s.map((x) => x / 10)).toEqual(Array.from({ length: 9 }, (_, i) => expect.closeTo((i + 1) * 10, 1)));
    expect(e.s.every((x) => Number.isInteger(x))).toBe(true);
  });

  it('interpolates the start crossing between frames (a coarse frame does not change the time)', () => {
    const fine = collect([SEG]);
    ride(fine.tracker, { from: 900, to: 1600, v: 5, dt: 0.05 });
    const coarse = collect([SEG]);
    ride(coarse.tracker, { from: 903, to: 1600, v: 5, dt: 2 }); // 10 m a frame, crossing both lines mid-frame
    expect(Math.abs(fine.finished[0].e.t - coarse.finished[0].e.t)).toBeLessThan(0.05);
    expect(coarse.finished[0].e.s).toHaveLength(9);
  });

  it('voids an effort when the rider stops, and does not count the rest of the climb', () => {
    const { tracker, finished, voided } = collect([SEG]);
    ride(tracker, { from: 900, to: 1600, v: 5, stopAt: 1200, stopFor: 3 });
    expect(voided).toEqual(['stopped']);
    expect(finished).toHaveLength(0);
  });

  it('voids on a jump along the road, and a jump over the start line does not start one', () => {
    const a = collect([SEG]);
    a.tracker.update(900, 0, 0, true);
    a.tracker.update(1010, 2, 0, true); // started
    a.tracker.update(1400, 4, 0, true); // jumped 390 m in a frame
    expect(a.voided).toEqual(['jumped']);
    const b = collect([SEG]);
    b.tracker.update(500, 0, 0, true);
    b.tracker.update(1100, 1, 0, true); // jumped across the line
    expect(b.started).toEqual([]);
    expect(b.finished).toHaveLength(0);
  });

  it('does not start from standing still on the line, or while not riding', () => {
    const { tracker, started } = collect([SEG]);
    tracker.update(990, 0, 0, false);
    tracker.update(1010, 1, 0, false); // not riding (for example held on a race start line)
    expect(started).toEqual([]);
  });

  it('voids when reset (a new ride, the hub opening)', () => {
    const { tracker, voided } = collect([SEG]);
    tracker.update(990, 0, 0, true);
    tracker.update(1100, 1, 0, true);
    tracker.reset();
    expect(voided).toEqual(['reset']);
    expect(tracker.live).toBeNull();
  });

  it('times each lap of a circuit as its own effort', () => {
    const { tracker, finished, started } = collect([LAPS]);
    ride(tracker, { from: 900, to: 4600, v: 5 });
    expect(started).toEqual([0, 1]);
    expect(finished.map((f) => f.pass)).toEqual([0, 1]);
    expect(finished[0].e.t).toBeCloseTo(100, 1);
    expect(finished[1].e.t).toBeCloseTo(100, 1);
  });

  it('reports the live position and elapsed time while on the segment', () => {
    const { tracker } = collect([SEG]);
    tracker.update(990, 0, 0, true);
    tracker.update(1100, 20, 0, true);
    expect(tracker.live?.x).toBeCloseTo(100, 6);
    expect(tracker.live?.elapsed).toBeGreaterThan(0);
  });
});

// -------------------------------------------------------------- splits & gap ----

/** An effort at a steady speed: the splits at every 50 m. */
function steady(length: number, v: number): Effort {
  const s: number[] = [];
  for (let m = SPLIT_M; m < length; m += SPLIT_M) s.push(Math.round((m / v) * 10));
  return { t: length / v, p: 300, s, at: 0 };
}

describe('splits and the live gap', () => {
  const best = steady(500, 5); // 100 s

  it('reads times back from the splits, linearly between them', () => {
    expect(timeAt(best, 500, 0)).toBe(0);
    expect(timeAt(best, 500, 50)).toBeCloseTo(10, 6);
    expect(timeAt(best, 500, 275)).toBeCloseTo(55, 6);
    expect(timeAt(best, 500, 480)).toBeCloseTo(96, 6); // past the last split: towards the top
    expect(timeAt(best, 500, 500)).toBe(100);
    expect(timeAt(best, 500, 900)).toBe(100);
  });

  it('works out ahead (negative), behind (positive) and level against a stored effort', () => {
    expect(gapSeconds(best, 500, 250, 45)).toBeCloseTo(-5, 6); // 250 m takes 50 s: 5 s up
    expect(gapSeconds(best, 500, 250, 62)).toBeCloseTo(12, 6);
    expect(gapSeconds(best, 500, 250, 50)).toBeCloseTo(0, 6);
  });

  it('copes with an effort that has few or no splits', () => {
    expect(timeAt({ t: 100, s: [] }, 500, 250)).toBeCloseTo(50, 6);
    expect(timeAt({ t: 100, s: [100] }, 500, 250)).toBeGreaterThan(10);
  });

  it('inverts it for the ghost', () => {
    expect(distanceAt(best, 500, 0)).toBe(0);
    expect(distanceAt(best, 500, 55)).toBeCloseTo(275, 4);
    expect(distanceAt(best, 500, 97)).toBeCloseTo(485, 4);
    expect(distanceAt(best, 500, 150)).toBe(500);
  });

  it('writes the gap as the HUD shows it', () => {
    expect(gapText(-7)).toBe('−0:07');
    expect(gapText(12)).toBe('+0:12');
    expect(gapText(75.4)).toBe('+1:15');
    expect(gapText(0.2)).toBe('±0:00');
    expect(segmentTime(3134)).toBe('52:14');
    expect(segmentTime(3725)).toBe('1:02:05');
  });

  it('judges a first attempt, a PB and a slower effort, and words the result', () => {
    const first = judgeEffort({ t: 3134 }, undefined);
    expect(first).toEqual({ pb: true, firstAttempt: true, vsBest: null });
    expect(resultText('Alpe d\'Huez', { t: 3134 }, first, null, null)).toBe('Alpe d\'Huez — 52:14 · First attempt, a time to beat');
    const pb = judgeEffort({ t: 3134 }, { t: 3175 });
    expect(pb).toEqual({ pb: true, firstAttempt: false, vsBest: -41 });
    expect(resultText('Alpe d\'Huez', { t: 3134 }, pb, 3, 27)).toBe('Alpe d\'Huez — 52:14 · New PB by 0:41 · #3 of 27');
    const off = judgeEffort({ t: 3146 }, { t: 3134 });
    expect(off.pb).toBe(false);
    expect(resultText('Alpe d\'Huez', { t: 3146 }, off, null, null)).toBe('Alpe d\'Huez — 52:26 · 0:12 off your best');
  });

  it('finds the segment you are on or the next within range, including each lap of a circuit', () => {
    expect(segmentStatus([SEG], 100, 500)).toBeNull();
    expect(segmentStatus([SEG], 0, 2000)).toMatchObject({ state: 'ahead', toStart: 1000 });
    expect(segmentStatus([SEG], 1200, 2000)).toMatchObject({ state: 'on', x: 200 });
    expect(segmentStatus([SEG], 1500, 2000)).toBeNull();
    expect(segmentStatus([LAPS], 2500, 2000)).toMatchObject({ state: 'ahead', pass: 1, toStart: 1500 });
    expect(segmentStatus([LAPS], 1700, 2000)).toBeNull();
    expect(segmentStatus([LAPS], 4200, 2000)).toMatchObject({ state: 'on', pass: 1, x: 200 });
  });
});
