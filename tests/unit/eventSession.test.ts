import { describe, expect, it } from 'vitest';
import { RaceSim } from '../../src/raceSim';
import { makeRoster } from '../../src/peloton';
import { raceSetup, EVENT_STEP } from '../../src/race';
import {
  BACK_GAP_M, DROPPED_GAP_M, DropWatcher, eventOver, mergeEventResults, secondsSinceStart,
} from '../../src/eventSession';
import { stageById } from '../../src/routes/library';

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
  it('a race stepped in fixed slices from an event seed ends up identical, however the frames fall', () => {
    const stage = stageById('route66');
    const { roster, course } = raceSetup(stage, 196761067);
    const run = (frames: number[]) => {
      const sim = new RaceSim(course, roster, { refWkg: 3.4, seed: 196761067, startFront: -2.2 });
      let clock = 0;
      for (const dt of frames) {
        clock += dt;
        while (sim.t + EVENT_STEP <= clock) sim.step(EVENT_STEP); // what LiveRace does in event mode
      }
      return sim.states().map((s) => Math.round(s.pos * 100) / 100);
    };
    const a = run(Array(1200).fill(0.1)); // 120 s at 10 fps
    const b = run(Array.from({ length: 1000 }, (_, i) => (i % 2 ? 0.05 : 0.19))); // 120 s, ragged frames
    expect(b).toEqual(a);
    expect(Math.max(...a)).toBeGreaterThan(100);
    void makeRoster;
  });
});
