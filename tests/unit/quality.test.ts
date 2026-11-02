import { describe, expect, it } from 'vitest';
import { ADAPT, Adapter } from '../../src/world/adapt';
import { SCALES, TIER_SPECS, TIERS, isChoice, pickAutoTier, type Signals, type Tier } from '../../src/world/quality';
import { gradeFor, goldenAmount, makeGrade } from '../../src/world/grade';

const desktop: Signals = { cores: 12, memoryGb: 8, width: 1920, height: 1080, dpr: 1, gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)' };

describe('pickAutoTier', () => {
  it('puts software renderers on Low', () => {
    expect(pickAutoTier({ ...desktop, gpu: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)' })).toBe('low');
    expect(pickAutoTier({ ...desktop, gpu: 'llvmpipe (LLVM 15.0.7, 256 bits)' })).toBe('low');
  });
  it('puts phones on Low, and a recent flagship phone on Medium', () => {
    const phone: Signals = { cores: 6, memoryGb: 4, width: 390, height: 844, dpr: 3, touch: true, gpu: 'Apple GPU' };
    expect(pickAutoTier(phone)).toBe('low');
    expect(pickAutoTier({ ...phone, cores: 8, memoryGb: 8, gpu: undefined })).toBe('medium');
    expect(pickAutoTier({ ...phone, gpu: 'Mali-G78' })).toBe('low');
  });
  it('puts tablets on Medium', () => {
    expect(pickAutoTier({ cores: 8, memoryGb: 4, width: 1024, height: 1366, dpr: 2, touch: true })).toBe('medium');
  });
  it('puts ordinary desktops on High and strong GPUs on Ultra', () => {
    expect(pickAutoTier({ cores: 8, memoryGb: 8, width: 1920, height: 1080, dpr: 1, gpu: 'ANGLE (AMD, AMD Radeon RX 580 Direct3D11)' })).toBe('high');
    expect(pickAutoTier({ cores: 8, memoryGb: 8, width: 1920, height: 1080, dpr: 1 })).toBe('high');
    expect(pickAutoTier(desktop)).toBe('ultra');
  });
  it('puts integrated graphics on Medium', () => {
    expect(pickAutoTier({ ...desktop, gpu: 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)' })).toBe('medium');
  });
  it('caps by CPU and memory', () => {
    expect(pickAutoTier({ ...desktop, cores: 2 })).toBe('low');
    expect(pickAutoTier({ ...desktop, cores: 4 })).toBe('medium');
    expect(pickAutoTier({ ...desktop, memoryGb: 2 })).toBe('low');
    expect(pickAutoTier({ ...desktop, memoryGb: 4 })).toBe('medium');
  });
  it('drops a tier for a 4K canvas unless the GPU is strong', () => {
    const tv: Signals = { cores: 8, memoryGb: 8, width: 3840, height: 2160, dpr: 1, gpu: 'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics)' };
    expect(pickAutoTier({ ...tv, gpu: undefined })).toBe('medium');
    expect(pickAutoTier({ ...tv, gpu: 'NVIDIA GeForce RTX 4080' })).toBe('ultra');
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
      t += i % 50 === 0 ? 120 : 16.7; // a hitch every ~50 frames: the median stays at 60 fps
      expect(b.push(t, i % 50 === 0 ? 120 : 16.7, 6)).toBeNull();
    }
  });

  it('drops long gaps (hidden tab) instead of counting them as slow frames', () => {
    const a = new Adapter('high', 'high', true, 0);
    for (let i = 0; i < 20; i++) expect(a.push(5000 + i * 3000, 3000, 5)).toBeNull();
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
