import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADAPT, Adapter, judge } from '../../src/world/adapt';
import {
  NOTE_FIRST_MS, NOTE_GAP_MS, NoteGate, RETEST_AFTER_MS, RETEST_SESSIONS, SCALES, TIER_SPECS, TIERS, clearAutoMemory, isChoice, isSoftwareGpu, loadAutoMemory,
  pickAutoStart, pickAutoTier, saveAutoMemory, settledMemory, tierNote, type AutoMemory, type Signals, type Tier,
} from '../../src/world/quality';
import { gradeFor, goldenAmount, makeGrade } from '../../src/world/grade';

const desktop: Signals = { cores: 12, memoryGb: 8, width: 1920, height: 1080, dpr: 1, gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)' };

const SWIFTSHADER = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)';
const phone: Signals = { cores: 6, memoryGb: 4, width: 390, height: 844, dpr: 3, touch: true, gpu: 'Apple GPU' };

describe('pickAutoTier', () => {
  it('puts software renderers on Low', () => {
    expect(pickAutoTier({ ...desktop, gpu: SWIFTSHADER })).toBe('low');
    expect(pickAutoTier({ ...desktop, gpu: 'llvmpipe (LLVM 15.0.7, 256 bits)' })).toBe('low');
    expect(isSoftwareGpu('Microsoft Basic Render Driver')).toBe(true);
    expect(isSoftwareGpu('NVIDIA GeForce RTX 3070')).toBe(false);
  });
  it('starts everything else on Ultra: phones, tablets, integrated graphics, weak CPUs, 4K', () => {
    expect(pickAutoTier(desktop)).toBe('ultra');
    expect(pickAutoTier(phone)).toBe('ultra');
    expect(pickAutoTier({ ...phone, gpu: 'Mali-G78' })).toBe('ultra');
    expect(pickAutoTier({ cores: 8, memoryGb: 4, width: 1024, height: 1366, dpr: 2, touch: true })).toBe('ultra');
    expect(pickAutoTier({ ...desktop, gpu: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)' })).toBe('ultra');
    expect(pickAutoTier({ ...desktop, cores: 2, memoryGb: 2 })).toBe('ultra');
    expect(pickAutoTier({ cores: 8, memoryGb: 8, width: 3840, height: 2160, dpr: 1 })).toBe('ultra');
    expect(pickAutoTier({ width: 1280, height: 720, dpr: 1 })).toBe('ultra'); // nothing known: Ultra
  });
});

const NOW = Date.UTC(2026, 10, 2, 12);
const DAY = 24 * 3600 * 1000;
const mem = (over: Partial<AutoMemory> = {}): AutoMemory => ({ tier: 'high', scale: 1, at: NOW - DAY, tested: NOW - DAY, sessions: 0, gpu: desktop.gpu!, ...over });

describe('pickAutoStart', () => {
  it('starts on Low on a software renderer, whatever is remembered', () => {
    const s = pickAutoStart({ ...desktop, gpu: SWIFTSHADER }, mem({ tier: 'ultra' }), NOW);
    expect(s).toMatchObject({ tier: 'low', scaleIdx: 0, remembered: null, retest: false, memory: null });
  });
  it('starts on Ultra with nothing remembered, or when the GPU is not the one it was learnt on', () => {
    expect(pickAutoStart(phone, null, NOW)).toMatchObject({ tier: 'ultra', remembered: null, retest: false });
    expect(pickAutoStart(desktop, mem({ gpu: 'something else' }), NOW)).toMatchObject({ tier: 'ultra', remembered: null });
  });
  it('starts from the remembered tier and scale, and counts the session', () => {
    const s = pickAutoStart(desktop, mem({ tier: 'medium', scale: 0.85, sessions: 1 }), NOW);
    expect(s).toMatchObject({ tier: 'medium', scaleIdx: 1, remembered: 'medium', retest: false });
    expect(s.memory?.sessions).toBe(2);
    expect(pickAutoStart(desktop, mem(), NOW, false).memory).toBeNull(); // choosing Auto in Settings is not a new session
  });
  it('re-tests one tier higher every third session', () => {
    const s = pickAutoStart(desktop, mem({ tier: 'medium', scale: 0.7, sessions: RETEST_SESSIONS }), NOW);
    expect(s).toMatchObject({ tier: 'high', scaleIdx: 0, remembered: 'medium', retest: true });
    expect(s.memory).toMatchObject({ tier: 'medium', sessions: 0, tested: NOW }); // counters start again; the remembered tier stays
  });
  it('re-tests after 3 days, never more than one tier up, and never above Ultra', () => {
    const old = mem({ tier: 'low', tested: NOW - RETEST_AFTER_MS - 1 });
    expect(pickAutoStart(desktop, old, NOW)).toMatchObject({ tier: 'medium', retest: true });
    expect(pickAutoStart(desktop, mem({ tested: NOW - RETEST_AFTER_MS + 1000 }), NOW).retest).toBe(false);
    const top = pickAutoStart(desktop, mem({ tier: 'ultra', sessions: 9, tested: 0 }), NOW);
    expect(top).toMatchObject({ tier: 'ultra', retest: false });
  });
});

describe('the remembered state', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('round-trips through localStorage', () => {
    expect(loadAutoMemory()).toBeNull();
    const m = settledMemory(null, 'high', 1, desktop.gpu!, NOW);
    expect(m).toEqual({ tier: 'high', scale: 0.85, at: NOW, tested: NOW, sessions: 0, gpu: desktop.gpu });
    saveAutoMemory(m);
    expect(store.has('americanflyers.graphicsAuto')).toBe(true);
    expect(loadAutoMemory()).toEqual(m);
    clearAutoMemory();
    expect(loadAutoMemory()).toBeNull();
  });
  it('keeps the re-test counters when it settles again, but not across GPUs', () => {
    const prev = mem({ tested: NOW - 5 * DAY, sessions: 2 });
    expect(settledMemory(prev, 'medium', 0, prev.gpu, NOW)).toMatchObject({ tier: 'medium', at: NOW, tested: prev.tested, sessions: 2 });
    expect(settledMemory(prev, 'medium', 0, 'other gpu', NOW)).toMatchObject({ tested: NOW, sessions: 0 });
  });
  it('ignores junk', () => {
    for (const raw of ['nope', '{}', 'null', '{"tier":"max","scale":1,"at":1,"tested":1,"sessions":0}', '{"tier":"high","scale":0.5,"at":1,"tested":1,"sessions":0}', '{"tier":"high","scale":1,"at":"x","tested":1,"sessions":0}']) {
      store.set('americanflyers.graphicsAuto', raw);
      expect(loadAutoMemory()).toBeNull();
    }
  });
  it('survives storage that throws', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } });
    expect(loadAutoMemory()).toBeNull();
    expect(() => { saveAutoMemory(mem()); clearAutoMemory(); }).not.toThrow();
  });
});

describe('tier-change notes', () => {
  it('says what changed', () => {
    expect(tierNote('high', 'lowered')).toBe('Graphics lowered to High for a smoother ride');
    expect(tierNote('ultra', 'raised')).toBe('Graphics raised to Ultra');
  });
  it('stays quiet for the first 4 s, then lets one through per 20 s', () => {
    const g = new NoteGate(1000);
    expect(g.allow(1000 + NOTE_FIRST_MS - 1)).toBe(false);
    expect(g.allow(1000 + NOTE_FIRST_MS)).toBe(true);
    expect(g.allow(1000 + NOTE_FIRST_MS + 5000)).toBe(false);
    expect(g.allow(1000 + NOTE_FIRST_MS + NOTE_GAP_MS - 1)).toBe(false);
    expect(g.allow(1000 + NOTE_FIRST_MS + NOTE_GAP_MS)).toBe(true);
  });
  it('restart() makes the first moments of a new ride quiet, without forgetting the last note', () => {
    const g = new NoteGate(0);
    expect(g.allow(5000)).toBe(true);
    g.restart(30000);
    expect(g.allow(31000)).toBe(false); // first 4 s
    expect(g.allow(34000)).toBe(true); // 29 s after the last note
    g.restart(40000);
    expect(g.allow(44500)).toBe(false); // 10.5 s after the last note
  });
});

describe('tiers', () => {
  it('only Medium and up load the post-processing chunk, and each tier adds to the one below', () => {
    expect(TIER_SPECS.low.post).toBe(false);
    for (const t of TIERS.slice(1)) expect(TIER_SPECS[t].post).toBe(true);
    for (let i = 1; i < TIERS.length; i++) {
      const lo = TIER_SPECS[TIERS[i - 1]];
      const hi = TIER_SPECS[TIERS[i]];
      expect(hi.maxPixelRatio).toBeGreaterThanOrEqual(lo.maxPixelRatio);
      expect(hi.shadowSize).toBeGreaterThanOrEqual(lo.shadowSize);
      expect(hi.bloom).toBeGreaterThanOrEqual(lo.bloom);
      expect(hi.ao).toBeGreaterThanOrEqual(lo.ao);
    }
    expect(TIER_SPECS.high.ao).toBeGreaterThan(0);
    expect(TIER_SPECS.medium.ao).toBe(0);
  });
  it('cascaded sun shadows only on High and Ultra, reaching further on Ultra, with sane splits', () => {
    expect(TIER_SPECS.low.cascade).toBeNull();
    expect(TIER_SPECS.medium.cascade).toBeNull();
    for (const t of ['high', 'ultra'] as const) {
      const c = TIER_SPECS[t].cascade!;
      expect(c).not.toBeNull();
      expect(c.ends[0]).toBeGreaterThan(5); // the rider and bike (a few metres from the camera) sit in the sharp cascade
      expect(c.ends[1]).toBeGreaterThan(c.ends[0] * 2);
      expect(c.range).toBeGreaterThan(c.ends[1] * 2);
      expect(c.range).toBeGreaterThanOrEqual(150);
      expect(c.range).toBeLessThanOrEqual(260);
      expect(c.tile).toBeGreaterThanOrEqual(TIER_SPECS.medium.shadowSize);
    }
    expect(TIER_SPECS.ultra.cascade!.range).toBeGreaterThanOrEqual(TIER_SPECS.high.cascade!.range);
    expect(TIER_SPECS.ultra.cascade!.tile).toBeGreaterThanOrEqual(TIER_SPECS.high.cascade!.tile);
    expect(TIER_SPECS.medium.shadowBox).toBeGreaterThanOrEqual(TIER_SPECS.low.shadowBox); // Medium's single box is a little wider than Low's
  });
  it('recognises valid choices only', () => {
    expect(isChoice('auto')).toBe(true);
    expect(isChoice('ultra')).toBe(true);
    expect(isChoice('max')).toBe(false);
    expect(isChoice(null)).toBe(false);
  });
});

/** Feeds the adapter 60 Hz-style frames of `frameMs` (and `workMs` of render work) from `from` to `to` ms; returns the first change. */
function run(a: Adapter, from: number, to: number, frameMs: number, workMs = 8) {
  for (let t = from; t < to; t += frameMs) {
    const ev = a.push(t, frameMs, workMs);
    if (ev) return { ev, at: t };
  }
  return null;
}

describe('Adapter', () => {
  it('ignores the warm-up, then steps the render scale down before the tier', () => {
    const a = new Adapter('high', 'high', true, 0);
    expect(run(a, 0, ADAPT.warmupMs - 100, 40)).toBeNull(); // slow frames while shaders compile don't count
    const first = run(a, ADAPT.warmupMs, 12000, 40)!;
    expect(first.ev).toMatchObject({ tier: 'high', scaleIdx: 1, reason: 'slow' });
    const second = run(a, first.at + 1, first.at + 20000, 40)!;
    expect(second.ev).toMatchObject({ tier: 'high', scaleIdx: 2 });
    const third = run(a, second.at + 1, second.at + 20000, 40)!;
    expect(third.ev).toMatchObject({ tier: 'medium', scaleIdx: 0 });
    expect(third.at - second.at).toBeGreaterThanOrEqual(ADAPT.cooldownMs); // cool-down between changes
  });

  it('does not react to a steady 60 fps, or to one-off hitches', () => {
    const a = new Adapter('high', 'high', true, 0);
    expect(run(a, 0, 60000, 16.7, 6)).toBeNull();
    const b = new Adapter('high', 'high', true, 0);
    let t = 5000;
    for (let i = 0; i < 600; i++) {
      t += i % 200 === 0 ? 120 : 16.7; // a stall every ~3.5 s: the median stays at 60 fps and the window holds at most one
      expect(b.push(t, i % 200 === 0 ? 120 : 16.7, 6)).toBeNull();
    }
  });

  it('drops long gaps (hidden tab) instead of counting them as slow frames', () => {
    const a = new Adapter('high', 'high', true, 0);
    let t = 5000;
    for (let i = 0; i < 20; i++) {
      expect(a.push(t += 3000, 3000, 5)).toBeNull();
      for (let j = 0; j < 5; j++) expect(a.push(t += 16.7, 16.7, 5)).toBeNull();
    }
  });

  it('with a fixed tier only the render scale moves', () => {
    const a = new Adapter('ultra', 'ultra', false, 0);
    let t = ADAPT.warmupMs;
    const seen: number[] = [];
    for (let n = 0; n < 4; n++) {
      const r = run(a, t, t + 30000, 40);
      if (!r) break;
      expect(r.ev.tier).toBe('ultra');
      seen.push(r.ev.scaleIdx);
      t = r.at + 1;
    }
    expect(seen).toEqual([1, 2]);
  });

  it('gives up shadows as a last resort at Low, and gets them back with headroom', () => {
    const a = new Adapter('low', 'low', true, 0);
    let t = ADAPT.warmupMs;
    let last = null as ReturnType<typeof run>;
    for (let n = 0; n < 5; n++) {
      const r = run(a, t, t + 30000, 40);
      if (!r) break;
      last = r; t = r.at + 1;
    }
    expect(a.state).toEqual({ tier: 'low', scaleIdx: SCALES.length - 1, noShadows: true });
    expect(last?.ev.noShadows).toBe(true);
    // Plenty of headroom for a long time: shadows come back first.
    t += ADAPT.minRaiseGapMs;
    const up = run(a, t, t + 60000, 8, 2)!;
    expect(up.ev).toMatchObject({ reason: 'headroom', noShadows: false, scaleIdx: SCALES.length - 1 });
  });

  it('raises only after a long calm, never above the ceiling, and backs off when a raise is undone', () => {
    const a = new Adapter('medium', 'high', true, 0);
    a.reset({ tier: 'medium', scaleIdx: 0, noShadows: false }, 0);
    // Calm 60 Hz frames with little render work: not before 10 s of them.
    const up = run(a, 5000, 60000, 16.7, 2)!;
    expect(up.ev).toMatchObject({ tier: 'high', reason: 'headroom' });
    expect(up.at).toBeGreaterThanOrEqual(5000 + ADAPT.fastWindowMs * 0.95 - 1);
    // High is the ceiling here: no further raise even with endless headroom (only the scale it came back at).
    const next = run(a, up.at + 1, up.at + 120000, 16.7, 2)!;
    expect(next.ev).toMatchObject({ tier: 'high', scaleIdx: 0 });
    expect(run(a, next.at + 1, next.at + 120000, 16.7, 2)).toBeNull();

    // A raise that is undone soon after makes the next attempt wait much longer.
    const b = new Adapter('medium', 'high', true, 0);
    const r1 = run(b, 5000, 60000, 16.7, 2)!;
    expect(r1.ev.tier).toBe('high');
    const down = run(b, r1.at + 1, r1.at + 40000, 40)!; // too slow at High: undone
    expect(down.ev.reason).toBe('slow');
    const retry = run(b, down.at + 1, down.at + ADAPT.backoffMs[0] - 2000, 16.7, 2);
    expect(retry).toBeNull();
  });

  it('on a 60 Hz display, headroom needs little render work as well as a steady frame', () => {
    const a = new Adapter('medium', 'high', true, 0);
    a.reset({ tier: 'medium', scaleIdx: 1, noShadows: false }, 0);
    expect(run(a, 5000, 60000, 16.7, 12)).toBeNull(); // 60 fps but the render call is busy: no headroom
  });
});

/** Feeds frames from a pattern function (ms for frame i) starting at `from`; returns the first change. */
function runPattern(a: Adapter, from: number, to: number, ms: (i: number) => number, workMs = 8) {
  let t = from;
  for (let i = 0; t < to; i++) {
    const f = ms(i);
    t += f;
    const ev = a.push(t, f, workMs);
    if (ev) return { ev, at: t };
  }
  return null;
}

describe('judge (jerkiness)', () => {
  const steady = (n: number, ms = 16.7) => Array.from({ length: n }, () => ms);
  it('calls a steady 60 fps smooth', () => {
    expect(judge(steady(180))).toMatchObject({ jerky: false, severe: false, stalls: 0, hitchShare: 0 });
  });
  it('counts a frame over 2.5x the median, or over 50 ms, as a hitch', () => {
    const f = steady(100);
    f[10] = 42; f[20] = 41; // over 2.5 x 16.7 = 41.75? 42 is, 41 is not
    expect(judge(f).hitchShare).toBeCloseTo(0.01);
    const slowish = steady(100, 30);
    slowish[5] = 55; // over 50 ms (and 2.5 x 30 = 75 is not reached)
    slowish[6] = 74; // over 50 ms
    expect(judge(slowish).hitchShare).toBeCloseTo(0.02);
  });
  it('is jerky when the median is over 22 ms', () => {
    expect(judge(steady(100, 23))).toMatchObject({ jerky: true, severe: false });
    expect(judge(steady(100, 21)).jerky).toBe(false);
  });
  it('is jerky with more than 8% hitches even at a good median', () => {
    const f = steady(100);
    for (let i = 0; i < 9; i++) f[i * 10] = 60;
    expect(judge(f)).toMatchObject({ jerky: true, severe: false });
    const g = steady(100);
    for (let i = 0; i < 8; i++) g[i * 10] = 60;
    expect(judge(g).jerky).toBe(false); // exactly 8%: not over
  });
  it('is jerky with 3 stalls over 100 ms, but not with 2', () => {
    const f = steady(180);
    f[10] = 130; f[90] = 130;
    expect(judge(f).jerky).toBe(false);
    f[150] = 101;
    expect(judge(f)).toMatchObject({ jerky: true, stalls: 3, severe: false });
  });
  it('is clearly struggling over a 40 ms median or 20% hitches', () => {
    expect(judge(steady(100, 41)).severe).toBe(true);
    expect(judge(steady(100, 39)).severe).toBe(false);
    const f = steady(100);
    for (let i = 0; i < 21; i++) f[i * 4] = 70;
    expect(judge(f).severe).toBe(true);
  });
});

describe('Adapter: stepping down', () => {
  it('drops a whole tier at once when clearly struggling, with a short cool-down', () => {
    const a = new Adapter('ultra', 'ultra', true, 0);
    const first = run(a, ADAPT.warmupMs, 30000, 50)!; // 20 fps
    expect(first.ev).toMatchObject({ tier: 'high', scaleIdx: 0, reason: 'slow', fast: true });
    expect(first.at).toBeLessThan(ADAPT.warmupMs + 4000);
    const second = run(a, first.at + 1, first.at + 30000, 50)!;
    expect(second.ev).toMatchObject({ tier: 'medium', scaleIdx: 0, fast: true });
    expect(second.at - first.at).toBeGreaterThanOrEqual(ADAPT.fastCooldownMs);
    expect(second.at - first.at).toBeLessThan(ADAPT.cooldownMs + 3000); // quicker than the gentle path
  });
  it('steps down at a few frames a second too, where the window never holds 20 frames', () => {
    for (const ms of [150, 250, 390]) {
      const a = new Adapter('ultra', 'ultra', true, 0);
      const hit = run(a, ADAPT.warmupMs, 60000, ms)!;
      expect(hit, `${ms} ms frames`).not.toBeNull();
      expect(hit.ev).toMatchObject({ tier: 'high', fast: true });
    }
  });
  it('drops a whole tier at once on a flood of hitches, and puts the scale back to 1', () => {
    const a = new Adapter('high', 'high', true, 0, false, 2); // starts at 70% sharpness
    const ev = runPattern(a, ADAPT.warmupMs, 30000, (i) => (i % 4 === 0 ? 90 : 16.7))!.ev; // 25% hitches, median 16.7
    expect(ev).toMatchObject({ tier: 'medium', scaleIdx: 0, fast: true });
  });
  it('takes the gentle path (scale first) when only jerky, not struggling', () => {
    const a = new Adapter('high', 'high', true, 0);
    const first = runPattern(a, ADAPT.warmupMs, 30000, (i) => (i % 8 === 0 ? 70 : 16.7))!; // 12% hitches
    expect(first.ev).toMatchObject({ tier: 'high', scaleIdx: 1, reason: 'slow' });
    expect(first.ev.fast).toBeFalsy();
    const slowish = new Adapter('high', 'high', true, 0);
    const second = run(slowish, ADAPT.warmupMs, 30000, 30)!; // median 30: slow, under 40
    expect(second.ev).toMatchObject({ tier: 'high', scaleIdx: 1 });
    expect(second.ev.fast).toBeFalsy();
  });
  it('steps down on three stalls in the window', () => {
    const a = new Adapter('high', 'high', true, 0);
    const ev = runPattern(a, ADAPT.warmupMs, 30000, (i) => (i % 55 === 0 && i > 0 ? 130 : 16.7))!.ev; // 3 stalls inside 3 s
    expect(ev).toMatchObject({ tier: 'high', scaleIdx: 1, reason: 'slow' });
  });
  it('a fixed tier only moves the scale even when clearly struggling', () => {
    const a = new Adapter('ultra', 'ultra', false, 0);
    expect(run(a, ADAPT.warmupMs, 30000, 80)!.ev).toMatchObject({ tier: 'ultra', scaleIdx: 1 });
  });
  it('at Low, struggling falls back to the scale and then shadows', () => {
    const a = new Adapter('low', 'low', true, 0);
    expect(run(a, ADAPT.warmupMs, 30000, 80)!.ev).toMatchObject({ tier: 'low', scaleIdx: 1 });
  });
  it('does not judge the warm-up, a hold (dialog, load, tab switch) or one long frame', () => {
    const a = new Adapter('ultra', 'ultra', true, 0);
    expect(run(a, 0, ADAPT.warmupMs - 50, 80)).toBeNull();
    a.hold(ADAPT.warmupMs + 5000, 1000);
    expect(run(a, ADAPT.warmupMs + 5000, ADAPT.warmupMs + 5990, 80)).toBeNull(); // inside the hold
    const b = new Adapter('ultra', 'ultra', true, 0);
    let t = 5000;
    for (let i = 0; i < 10; i++) { expect(b.push(t += 700, 700, 5)).toBeNull(); b.push(t += 16.7, 16.7, 5); } // lone gaps over 400 ms: not samples
  });
  it('never climbs above the starting tier, even when it started below Ultra', () => {
    const a = new Adapter('medium', 'medium', true, 0);
    expect(run(a, ADAPT.warmupMs, 120000, 8, 1)).toBeNull();
  });
  it('after a whole-tier drop it waits before trying to go back up, and backs off if that was a mistake', () => {
    const a = new Adapter('ultra', 'ultra', true, 0);
    const down = run(a, ADAPT.warmupMs, 30000, 50)!;
    expect(down.ev.tier).toBe('high');
    expect(run(a, down.at + 1, down.at + ADAPT.minRaiseGapMs - 2000, 8, 1)).toBeNull();
    const up = run(a, down.at + ADAPT.minRaiseGapMs, down.at + 120000, 8, 1)!;
    expect(up.ev).toMatchObject({ tier: 'ultra', reason: 'headroom' });
    const undone = run(a, up.at + 1, up.at + 40000, 50)!;
    expect(undone.ev.tier).toBe('high');
    expect(run(a, undone.at + 1, undone.at + ADAPT.backoffMs[0] - 2000, 8, 1)).toBeNull(); // the back-off grew
  });
  it('treats three frames in a row over 400 ms as clearly struggling, but not a lone stall or the warm-up', () => {
    const a = new Adapter('ultra', 'ultra', true, 0);
    for (let i = 0; i < 3; i++) expect(a.push(1000 + i * 900, 900, 5)).toBeNull(); // shaders compiling in the warm-up
    let t = ADAPT.warmupMs + 1000;
    expect(a.push(t += 900, 900, 5)).toBeNull(); // one stall
    for (let i = 0; i < 30; i++) expect(a.push(t += 16.7, 16.7, 5)).toBeNull(); // then fine
    expect(a.push(t += 900, 900, 5)).toBeNull();
    expect(a.push(t += 900, 900, 5)).toBeNull();
    expect(a.push(t += 900, 900, 5)).toMatchObject({ tier: 'high', scaleIdx: 0, reason: 'slow', fast: true });
  });
  it('starts at a remembered render scale', () => {
    const a = new Adapter('high', 'high', true, 0, false, 1);
    expect(a.state).toEqual({ tier: 'high', scaleIdx: 1, noShadows: false });
  });
});

describe('Adapter: settling', () => {
  it('reports its state once after 30 s of riding without a change, not before', () => {
    const a = new Adapter('high', 'high', true, 0);
    expect(run(a, 0, ADAPT.warmupMs + 29000, 16.7, 6)).toBeNull();
    expect(a.takeSettled()).toBeNull();
    run(a, ADAPT.warmupMs + 29000, ADAPT.warmupMs + 31500, 16.7, 6);
    expect(a.takeSettled()).toEqual({ tier: 'high', scaleIdx: 0, noShadows: false });
    expect(a.takeSettled()).toBeNull(); // once
  });
  it('counts riding time only: holds do not count, and a change starts it again', () => {
    const a = new Adapter('ultra', 'ultra', true, 0);
    const down = run(a, ADAPT.warmupMs, 30000, 50)!;
    expect(a.takeSettled()).toBeNull();
    let t = down.at + 1;
    a.settleMs = 5000;
    for (let i = 0; i < 20; i++) { a.hold(t, 1000); t += 500; } // a dialog open: nothing measured
    expect(a.takeSettled()).toBeNull();
    run(a, t + 1000, t + 9000, 16.7, 5);
    expect(a.takeSettled()).toMatchObject({ tier: 'high' });
  });
});

describe('gradeFor', () => {
  const day = gradeFor({ night: 0, overcast: 0.1, wet: 0, sunY: 0.8 }, makeGrade());
  const dusk = gradeFor({ night: 0, overcast: 0.1, wet: 0, sunY: 0.12 }, makeGrade());
  const rain = gradeFor({ night: 0, overcast: 1, wet: 1, sunY: 0.8 }, makeGrade());
  const night = gradeFor({ night: 1, overcast: 0, wet: 0, sunY: -0.5 }, makeGrade());

  it('is gentle by day: close to neutral', () => {
    expect(day.saturation).toBeGreaterThan(1);
    expect(day.saturation).toBeLessThan(1.12);
    expect(Math.abs(day.gain[0] - day.gain[2])).toBeLessThan(0.05);
    expect(day.vignette).toBeLessThan(0.25);
  });
  it('is warmer and more saturated at dusk and dawn', () => {
    expect(dusk.gain[0]).toBeGreaterThan(day.gain[0]);
    expect(dusk.gain[2]).toBeLessThan(day.gain[2]);
    expect(dusk.saturation).toBeGreaterThan(day.saturation);
  });
  it('is cooler, flatter and greyer in rain', () => {
    expect(rain.saturation).toBeLessThan(day.saturation - 0.1);
    expect(rain.contrast).toBeLessThan(day.contrast);
    expect(rain.gain[2]).toBeGreaterThan(rain.gain[0]);
  });
  it('is blue at night but keeps contrast, with an easier bloom', () => {
    expect(night.gain[2]).toBeGreaterThan(night.gain[0] + 0.15);
    expect(night.contrast).toBeGreaterThanOrEqual(1);
    expect(night.bloomThreshold).toBeLessThan(day.bloomThreshold);
    expect(night.bloomStrength).toBeGreaterThan(day.bloomStrength);
    expect(night.lift[2]).toBeGreaterThan(day.lift[2]);
  });
  it('keeps every value in a tasteful range', () => {
    for (const g of [day, dusk, rain, night]) {
      expect(g.saturation).toBeGreaterThan(0.7);
      expect(g.saturation).toBeLessThan(1.3);
      expect(g.contrast).toBeGreaterThan(0.85);
      expect(g.contrast).toBeLessThan(1.15);
      expect(g.vignette).toBeLessThan(0.45);
      expect(g.bloomStrength).toBeLessThan(0.8);
      for (const c of g.gain) { expect(c).toBeGreaterThan(0.8); expect(c).toBeLessThan(1.2); }
    }
  });
  it('goldenAmount peaks with the sun low and clear, and vanishes at noon, at night and under cloud', () => {
    expect(goldenAmount(0.1, 0)).toBeGreaterThan(0.9);
    expect(goldenAmount(0.9, 0)).toBe(0);
    expect(goldenAmount(-0.4, 0)).toBe(0);
    expect(goldenAmount(0.1, 1)).toBeLessThan(0.3);
  });
});

describe('tier names', () => {
  it('lists the four tiers in order', () => {
    expect(TIERS as readonly Tier[]).toEqual(['low', 'medium', 'high', 'ultra']);
  });
});
