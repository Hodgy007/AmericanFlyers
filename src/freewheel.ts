// The freewheel: when the wheel turns faster than the cassette (coasting, or
// soft-pedalling), spring-loaded pawls in the hub snap over the teeth of a
// ratchet ring. Each snap is a tiny, bright metallic tick, and there are
// ENGAGEMENT_POINTS of them per wheel turn, so at road speed they blur into
// the familiar buzzing whirr, slowing to separate clicks as you roll to a stop.

/** Ratchet teeth per wheel turn (a typical 36-tooth star-ratchet road hub). */
export const ENGAGEMENT_POINTS = 36;
/** Below this many ticks a second, it's quiet (the wheel has as good as stopped). */
export const MIN_TICK_RATE = 3;
/** Above this, ticks merge into a buzz anyway; cap the work per second. */
export const MAX_TICK_RATE = 420;

/**
 * Pawl ticks per second: how much faster the wheel is turning than the
 * cassette (both in revolutions per second), times the engagement points.
 */
export function tickRate(wheelRevs: number, cassetteRevs: number) {
  const rate = Math.max(0, wheelRevs - cassetteRevs) * ENGAGEMENT_POINTS;
  return rate < MIN_TICK_RATE ? 0 : Math.min(MAX_TICK_RATE, rate);
}

/** A small seeded random number generator, so the tick variants are repeatable. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// The ring's ringing modes: frequency (Hz), decay (s) and level. Steel parts
// this small ring high and briefly; the hub shell adds a dull knock.
const MODES: [number, number, number][] = [
  [3150, 0.0075, 1],
  [4720, 0.0055, 0.75],
  [6890, 0.004, 0.55],
  [9300, 0.003, 0.35],
  [12400, 0.0022, 0.2],
  [880, 0.003, 0.3], // shell knock
];
export const TICK_SECONDS = 0.03;

/**
 * One pawl tick as raw samples: a sharp noise snap exciting a handful of
 * inharmonic metallic modes. `variant` shifts the modes and noise slightly so
 * a run of ticks doesn't sound like a machine gun. Peak level is 1.
 */
export function renderTick(sampleRate: number, variant = 0): Float32Array {
  const n = Math.round(sampleRate * TICK_SECONDS);
  const out = new Float32Array(n);
  const rand = rng(0x9e3779b1 + variant * 7919);
  const modes = MODES.map(([f, decay, level]) => ({
    w: 2 * Math.PI * f * (0.96 + rand() * 0.08),
    decay: decay * (0.85 + rand() * 0.3),
    level: level * (0.8 + rand() * 0.4),
    phase: rand() * Math.PI * 2,
  }));
  let peak = 0;
  let hp = 0, prev = 0; // a one-pole high-pass on the snap noise
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const attack = Math.min(1, t / 0.0003, (TICK_SECONDS - t) / 0.008); // 0.3 ms hard edge in, 8 ms fade out (no pops)
    let v = 0;
    for (const m of modes) v += m.level * Math.exp(-t / m.decay) * Math.sin(m.w * t + m.phase);
    const white = rand() * 2 - 1;
    hp = 0.85 * (hp + white - prev);
    prev = white;
    v += 0.9 * hp * Math.exp(-t / 0.0009);
    v *= attack;
    out[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  if (peak > 0) for (let i = 0; i < n; i++) out[i] /= peak;
  return out;
}
