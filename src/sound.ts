// Ride sounds, synthesised with Web Audio (no sound files): wind and tyre
// hum that rise with speed, the freewheel ratchet when you stop pedalling
// (src/freewheel.ts),
// crowds on the hairpins and at the finish, beeps before workout intervals,
// gear-change clicks and a finish fanfare.

import { WHEEL_CIRCUMFERENCE } from './drivetrain';
import { renderTick, tickRate } from './freewheel';

const WIND_MAX = 0.32;
const HUM_MAX = 0.06;
const CROWD_MAX = 0.22;
const RAIN_MAX = 0.1;
const FREEWHEEL_LEVEL = 0.075; // one tick at slow speed; quieter each as they blur into a buzz
const TICK_VARIANTS = 6;
const LOOKAHEAD_S = 0.06; // ticks are scheduled this far ahead on the audio clock

export interface SoundState {
  speedMs: number;
  pedalling: boolean;
  crowd: number; // 0..1: how close the nearest crowd is
  /** How fast the cassette turns (rev/s) while coasting; the freewheel ticks as the wheel outruns it. */
  cassetteRevs?: number;
}

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private wind: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private hum: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private crowd: { gain: GainNode; swell: number } | null = null;
  private rain: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private rainLevel = 0; // 0..1, set by the weather
  private noise: AudioBuffer | null = null;
  private ticks: AudioBuffer[] = [];
  private freewheel: GainNode | null = null;
  private nextTick = 0; // audio-clock time of the next pawl tick (0 = not ticking)
  private whistleAt = 0;
  private on: boolean;
  private unlocked = false; // the rider has clicked or pressed a key

  constructor(enabled: boolean) {
    this.on = enabled;
    // Browsers only let a page start audio after the user interacts with it.
    const start = () => {
      this.unlocked = true;
      if (this.on) this.start();
      window.removeEventListener('pointerdown', start);
      window.removeEventListener('keydown', start);
    };
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.visibilityState === 'hidden') this.ctx.suspend();
      else if (this.on) this.ctx.resume();
    });
  }

  get enabled() {
    return this.on;
  }

  setEnabled(on: boolean) {
    this.on = on;
    if (on) {
      if (!this.unlocked) return; // starts on the first click or key press
      this.start();
      this.ctx?.resume();
    } else {
      this.ctx?.suspend();
    }
  }

  private start() {
    if (this.ctx) return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = (this.ctx = new Ctx());
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(ctx.destination);

    // Two seconds of pink-ish noise, looped, feeds the wind, hum and crowd.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.16;
    }

    this.wind = this.noiseVoice('lowpass', 400, 0.7);
    this.hum = this.noiseVoice('bandpass', 110, 6);
    const crowd = this.noiseVoice('bandpass', 1300, 0.9);
    this.crowd = { gain: crowd.gain, swell: 0 };
    this.rain = this.noiseVoice('highpass', 3200, 0.5);

    // The freewheel: a few pre-rendered pawl ticks, played at the ratchet's rate.
    this.ticks = Array.from({ length: TICK_VARIANTS }, (_, i) => {
      const samples = renderTick(ctx.sampleRate, i);
      const b = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      b.getChannelData(0).set(samples);
      return b;
    });
    this.freewheel = ctx.createGain();
    this.freewheel.connect(this.master);
  }

  /** How hard it's raining (0..1): a soft hiss that follows the weather. */
  setRain(level: number) {
    this.rainLevel = Math.min(1, Math.max(0, level));
  }

  private noiseVoice(type: BiquadFilterType, freq: number, q: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master!);
    src.start(ctx.currentTime + Math.random() * 0.5);
    return { gain, filter };
  }

  /** Call every frame. */
  update(dt: number, s: SoundState) {
    const ctx = this.ctx;
    if (!ctx || !this.on || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const v = Math.max(0, s.speedMs);
    const glide = (p: AudioParam, value: number, tc = 0.25) => p.setTargetAtTime(value, t, tc);

    // Wind grows with the square of speed and brightens as it does.
    const w = Math.min(1, (v / 14) ** 2);
    glide(this.wind!.gain.gain, w * WIND_MAX);
    glide(this.wind!.filter.frequency, 250 + v * 55);
    // Tyre hum: a low rumble that rises in pitch with speed.
    glide(this.hum!.gain.gain, Math.min(1, v / 6) * HUM_MAX);
    glide(this.hum!.filter.frequency, 70 + v * 9);

    // Rain: a steady hiss, a little brighter when it's heavy.
    if (this.rain) {
      glide(this.rain.gain.gain, this.rainLevel * RAIN_MAX, 0.8);
      glide(this.rain.filter.frequency, 2600 + this.rainLevel * 1800, 0.8);
    }

    // Freewheel: the pawls tick over the ratchet whenever the wheel outruns
    // the cassette, from separate clicks rolling slowly to a buzz at speed.
    const wheelRevs = v / WHEEL_CIRCUMFERENCE;
    // Pedalling drives the wheel (no ticks); coasting, the cranks and cassette
    // spin down, so the ticking builds over a second or so.
    const rate = tickRate(wheelRevs, s.pedalling ? wheelRevs : (s.cassetteRevs ?? 0));
    if (rate > 0) {
      // Each tick a little quieter as they speed up, so the buzz isn't harsh.
      const level = FREEWHEEL_LEVEL / Math.max(1, rate / 40) ** 0.4;
      if (this.nextTick < t) this.nextTick = t + 0.01;
      while (this.nextTick < t + LOOKAHEAD_S) {
        this.tick(this.nextTick, level);
        this.nextTick += (1 / rate) * (0.93 + Math.random() * 0.14); // pawls never land perfectly evenly
      }
    } else {
      this.nextTick = 0;
    }

    // Crowds: a murmur that swells into cheering, with the odd whistle.
    const c = this.crowd!;
    c.swell += (Math.random() - 0.5) * dt * 3;
    c.swell = Math.max(-0.4, Math.min(0.4, c.swell));
    glide(c.gain.gain, s.crowd * CROWD_MAX * (0.8 + c.swell), 0.4);
    if (s.crowd > 0.35) {
      this.whistleAt -= dt;
      if (this.whistleAt <= 0) {
        this.whistle(s.crowd);
        this.whistleAt = 1.5 + Math.random() * 4 / s.crowd;
      }
    }
  }

  private tick(at: number, level: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.ticks[Math.floor(Math.random() * this.ticks.length)];
    src.playbackRate.value = 0.97 + Math.random() * 0.06;
    const g = ctx.createGain();
    g.gain.value = level * (0.75 + Math.random() * 0.5);
    src.connect(g).connect(this.freewheel!);
    src.start(at);
  }

  private click(level: number, freq: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + 0.02);
  }

  private tone(freq: number, start: number, length: number, level = 0.18, type: OscillatorType = 'sine', slideTo?: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, start + length);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(level, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + length);
    o.connect(g).connect(this.master!);
    o.start(start);
    o.stop(start + length + 0.02);
  }

  private whistle(level: number) {
    const t = this.ctx!.currentTime;
    const f = 2200 + Math.random() * 900;
    this.tone(f, t, 0.18, 0.03 * level, 'sine', f * 1.15);
    if (Math.random() < 0.5) this.tone(f * 1.1, t + 0.22, 0.3, 0.03 * level, 'sine', f * 0.95);
  }

  private ready() {
    return !!this.ctx && this.on && this.ctx.state === 'running';
  }

  /** Quiets the ride sounds a little while the race commentator speaks. */
  duck(on: boolean) {
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(on ? 0.45 : 0.8, this.ctx.currentTime, 0.12);
  }

  /** Countdown beep before a workout step changes; `last` is the long one as it changes. */
  beep(last = false) {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    this.tone(last ? 1320 : 880, t, last ? 0.45 : 0.12, 0.2, 'triangle');
  }

  /** A gear change: a short mechanical clunk. */
  shift(up: boolean) {
    if (!this.ready()) return;
    this.click(0.05, up ? 2600 : 1900);
    const t = this.ctx!.currentTime;
    this.tone(up ? 180 : 140, t + 0.01, 0.05, 0.05, 'square');
  }

  /** Crossing the finish line. */
  fanfare() {
    if (!this.ready()) return;
    const t = this.ctx!.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, t + i * 0.12, i === 3 ? 0.9 : 0.2, 0.16, 'triangle'));
    if (this.crowd) this.crowd.gain.gain.setTargetAtTime(CROWD_MAX * 1.4, t, 0.1);
  }
}
