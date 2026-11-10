// Ride music, synthesised with Web Audio like the rest of the sound (no files
// to download or license). Two pieces of country-rock Americana, all on the
// same clock the ride sounds use:
//  - `Theme`: the American Flyers theme tune. It plays on the home screen and
//    in the hub, and as a fanfare just before a race starts.
//  - `Band`: a loopable riding score that varies with the ride (speed, grade,
//    heart rate) and drops to a sparse, quiet mix on a climb.
// Everything is scheduled in a lookahead window (setInterval), so the music
// stays in time however slow the frame rate goes, and every scheduled node is
// registered so `stop()` can cut it dead.

const LOOKAHEAD_S = 0.25; // how far ahead notes are written to the audio clock
const TICK_MS = 60;

/** Swing the off-beat eighth notes (0 = straight, 1 = fully bumped). */
const SWING = 0.25;

/** MIDI note number to Hz. */
export const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

const mtof = hz;

/** Where the theme is in its form, as a bar number within a 28-bar loop. */
export type ThemeSection = 'intro' | 'verse' | 'chorus' | 'turnaround' | 'close';

/** The theme's form, bar by bar: these are the bars where a section begins. */
export const THEME_FORM: { bar: number; section: ThemeSection }[] = [
  { bar: 0, section: 'intro' },
  { bar: 4, section: 'verse' },
  { bar: 12, section: 'chorus' },
  { bar: 20, section: 'turnaround' },
  { bar: 24, section: 'close' },
];

/** How many bars the theme runs before it starts over. */
export const THEME_BARS = 28;

interface Style {
  bpm: number;
  root: number; // the tonic as a MIDI note
  chords: number[][]; // semitones from the root
  swing: number;
}

const STYLE: Style = {
  bpm: 104,
  root: 50, // D
  chords: [
    [0, 4, 7, 11], // I maj7
    [5, 9, 12, 16], // IV
    [2, 5, 9, 12], // ii m7
    [-3, 0, 4, 7], // bVII
  ],
  swing: SWING,
};

/**
 * The music for a ride: the theme tune and a loopable riding score, sharing
 * one compressor (so neither can clip) and one audio clock. Both pieces are
 * written with a lookahead, so they stay in time however slow the frame rate
 * goes, and every scheduled node is registered so `stop()` can cut it dead.
 */
export class Music {
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;
  private comp: DynamicsCompressorNode | null = null;
  private timer = 0;
  private playing: 'theme' | 'ride' | null = null;
  private level = 0.5;
  private enabled = true;
  private take: 'theme' | 'ride' = 'theme';
  // The next note slots (audio-clock times and bar/beat positions).
  private nextTime = 0;
  private bar = 0;
  private beat = 0;
  // Riding intensity, written by main from the ride numbers: 0 = coasting,
  // 1 = hard; `climb` 0..1 strips the riding score back to a loping, low pulse.
  intensity = 0.4;
  climb = 0;
  private nodes = new Set<AudioScheduledSourceNode>();

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.3;
    const bus = ctx.createGain();
    bus.gain.value = 0;
    bus.connect(comp).connect(destination);
    this.bus = bus;
    this.comp = comp;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.applyLevel(0.2);
  }

  /** 0..1 listener volume; the ride sounds are not touched. */
  setLevel(level: number) {
    this.level = Math.max(0, Math.min(1, level));
    this.applyLevel(0.2);
  }

  get current() {
    return this.playing;
  }

  private applyLevel(tc: number) {
    if (!this.bus || !this.ctx) return;
    const target = this.enabled && this.playing ? this.level * 0.9 : 0;
    this.bus.gain.setTargetAtTime(target, this.ctx.currentTime, tc);
  }

/** Starts a piece from the top; safe to call when it's already playing (it just continues). */
  play(piece: 'theme' | 'ride') {
    if (!this.ctx) return;
    if (this.playing === piece) return;
    const settled = this.playing !== null; // the old piece is audible: don't let its tail ring over the new one
    this.playing = piece;
    this.take = piece;
    this.bar = 0;
    this.beat = 0;
    this.nextTime = this.ctx.currentTime + 0.15;
    if (settled) { this.bus!.gain.setValueAtTime(0, this.ctx.currentTime); this.stopClock(); }
    this.applyLevel(0.6);
    this.startClock();
  }

  stop() {
    this.playing = null;
    this.applyLevel(0.35);
    this.stopClock();
  }

  /** Parks the current piece without cutting it off: the caller resumes with `play`. */
  pause() {
    if (!this.playing) return;
    this.playing = null;
    this.applyLevel(0.12); // a beat to duck under a new piece or a voice
  }

  private startClock() {
    if (this.timer) return;
    this.step(); // fill the first window at once, not after 60 ms
    this.timer = window.setInterval(() => this.step(), TICK_MS);
  }

  private stopClock() {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = 0;
    // Let the tail ring out (the bus fades it) rather than cutting it dead.
    const now = this.ctx!.currentTime;
    for (const n of this.nodes) {
      try { n.stop(now + 0.4); } catch { /* already stopped */ }
    }
  }

  /** Writes any notes falling in the lookahead window onto the audio clock. */
  private step() {
    const ctx = this.ctx!;
    if (ctx.state !== 'running' || !this.playing) return;
    if (this.nextTime < ctx.currentTime - 0.05) this.nextTime = ctx.currentTime + 0.05; // tab was hidden
    while (this.nextTime < ctx.currentTime + LOOKAHEAD_S) {
      const spb = 60 / STYLE.bpm;
      const swing = STYLE.swing;
      const t = this.nextTime;
      const beatInBar = this.beat;
      const bar = this.bar;
      if (this.take === 'theme') this.themeStep(t, bar, beatInBar, spb, swing);
      else this.rideStep(t, bar, beatInBar, spb, swing);
      // Advance in eighths, swung.
      const off = beatInBar % 1 !== 0;
      this.nextTime += spb * 0.5 * (off ? 1 - swing : 1 + swing);
      this.beat = beatInBar + 0.5;
      if (this.beat >= 4) {
        this.beat = 0;
        this.bar++;
        // The tune ends at the close; anything longer is a new pass through the form.
      }
    }
  }

  // ------------------------------------------------------------ the theme ----

  /**
   * The American Flyers theme, one bar at a time. Form, in bars:
   *  0-3 intro (guitar and bass alone), 4-11 verse, 12-19 chorus (bigger,
   *  with a chord a bar), 20-23 the turnaround home, 24-27 the close.
   */
  private themeStep(t: number, bar: number, beat: number, spb: number, swing: number) {
    const r = STYLE.root;
    const i = bar % 28;
    const chorus = i >= 12 && i < 20;
    const close = i >= 24;
    // One chord per bar through the chorus, two bars each elsewhere.
    const chord = close ? STYLE.chords[0] : chorus ? STYLE.chords[i % 4] : STYLE.chords[Math.floor(i / 2) % 4];
    const vel = i < 4 ? 0.55 : i < 12 ? 0.78 : chorus ? 1 : 0.88;
    const eighths = spb * 0.5;

    const note = THEME_MELODY[i]?.[Math.round(beat * 2)];
    if (note) this.lead(t, r + note[0], note[1] * eighths, vel);

    if (beat === 0) {
      for (let k = 1; k < chord.length; k++) this.pad(t, r + chord[k], spb * 4, vel);
      this.bass(t, r + chord[0] - 12, spb * 1.8, 0.8 * vel);
    }
    if (beat === 2) this.bass(t, r + chord[0] - 12, spb * 1.4, 0.6 * vel);
    if (chorus && (beat === 1 || beat === 3)) this.bass(t, r + chord[2] - 12, spb * 0.8, 0.5 * vel);

    // The strummed acoustic: a down-stroke on each beat, an up-stroke between.
    if (beat % 1 === 0) this.strum(t, chord.map((n) => r + n), spb * 0.9, 0.6 * vel, 'down');
    else this.strum(t, chord.map((n) => r + n), eighths * 0.8, 0.32 * vel, 'up');

    // Drums: the intro is the tune alone; the band is brushed in from the verse.
    if (i >= 4) {
      if (beat === 0) this.kick(t, 0.7 * vel);
      if (beat === 2) this.kick(t, 0.55 * vel);
      if (beat === 1 || beat === 3) this.snare(t, 0.9 * vel);
      if (beat % 1 === 0) this.hat(t, 0.3 * vel);
      else this.hat(t, 0.18 * vel);
      if (chorus && beat === 2.5) this.snare(t + eighths * (1 + swing), 0.4 * vel); // a pickup into the next bar
    }
  }

  // ------------------------------------------------------------- the ride ----

  /**
   * The riding score: a four-bar groove over the same progression as the
   * theme, played quieter and sparser than the theme. It thickens with
   * `intensity` (hard efforts bring the drums and the second guitar in),
   * and `climb` strips it back to a loping, low fifth and a slow pulse.
   */
  private rideStep(t: number, bar: number, beat: number, spb: number, _swing: number) {
    const st = STYLE;
    const r = st.root;
    const chord = st.chords[bar % 4];
    const hard = this.intensity;
    const climb = this.climb;
    const vel = 0.45 + hard * 0.4;

    if (beat === 0) {
      this.bass(t, r + chord[0] - 12, spb * (1 + (1 - hard) * 2), 0.45 + hard * 0.25);
      this.strum(t, chord.map((n) => r + n), spb * 1.4, 0.28 + hard * 0.18, 'up');
      this.pad(t, r + chord[1], spb * 4, 0.16 + hard * 0.14);
    }
    if (beat === 2) this.bass(t, r + chord[2] - 12, spb * 1.2, 0.35 + hard * 0.15);
    // A slow pulse while climbing: a heartbeat at the downbeat and the third.
    if (beat % 2 === 0) this.kick(t, (climb > 0.4 ? 0.4 : 0.18 + hard * 0.2) * vel);
    if (climb < 0.5 && beat % 1 === 0) this.hat(t, (beat % 2 === 0 ? 0.14 : 0.1) * (0.5 + hard));
    if (climb < 0.3 && (beat === 1 || beat === 3)) this.snare(t, 0.22 + hard * 0.15);
    // At a hard effort, the theme's own motif creeps back in quietly.
    if (hard > 0.6 && beat % 2 === 0) {
      const motif = [7, 4, 9, 7][Math.floor(this.bar / 2) % 4];
      this.lead(t, r + 12 + motif, spb * 1.6, 0.18 + hard * 0.12);
    }
  }

  // -------------------------------------------------------------- the voices ----

  /** The lead: a warm, slightly-overdriven electric with a songbird's timing. */
  private lead(t: number, midi: number, dur: number, vel: number) {
    const ctx = this.ctx!;
    const bus = this.bus!;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    const f = mtof(midi);
    // A country singer's scoop into the note.
    o.frequency.setValueAtTime(f * 0.97, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.03);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.2;
    const vibGain = ctx.createGain();
    vibGain.gain.setValueAtTime(0, t);
    vibGain.gain.linearRampToValueAtTime(f * 0.006, t + Math.min(dur, 0.4));
    vib.connect(vibGain).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vel * 0.22, t + 0.02);
    g.gain.setValueAtTime(vel * 0.2, t + Math.max(0.03, dur - 0.06));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    o.connect(lp).connect(g).connect(bus);
    o.start(t);
    vib.start(t);
    o.stop(t + dur + 0.02);
    vib.stop(t + dur + 0.02);
    this.nodes.add(o);
    this.nodes.add(vib);
    o.onended = () => this.nodes.delete(o);
    vib.onended = () => this.nodes.delete(vib);
  }

  /** A soft, wide pad: two detuned triangles behind a slow low-pass. */
  private pad(t: number, midi: number, dur: number, level: number) {
    const ctx = this.ctx!;
    const f = mtof(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level * 0.08, t + Math.min(0.35, dur * 0.3));
    g.gain.setValueAtTime(level * 0.08, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    g.connect(lp).connect(this.bus!);
    for (const cents of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.detune.value = cents;
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 0.02);
      this.nodes.add(o);
      o.onended = () => this.nodes.delete(o);
    }
  }

  /** An upright bass: a plucked sine with a touch of finger noise. */
  private bass(t: number, midi: number, dur: number, level: number) {
    const ctx = this.ctx!;
    const f = mtof(midi);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f * 1.01, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level * 0.34, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.bus!);
    o.start(t);
    o.stop(t + dur + 0.02);
    this.nodes.add(o);
    o.onended = () => this.nodes.delete(o);
  }

  /** A strummed acoustic: a handful of very short plucks spread over ~60 ms. */
  private strum(t: number, notes: number[], dur: number, level: number, dir: 'down' | 'up') {
    const ctx = this.ctx!;
    const order = dir === 'down' ? notes : [...notes].reverse();
    order.forEach((midi, i) => {
      const at = t + i * 0.014;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = mtof(midi);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(level * 0.05, at + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, at + Math.min(dur, 0.5));
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 260 + i * 90;
      bp.Q.value = 1.2;
      o.connect(bp).connect(g).connect(this.bus!);
      o.start(at);
      o.stop(at + Math.min(dur, 0.5) + 0.02);
      this.nodes.add(o);
      o.onended = () => this.nodes.delete(o);
    });
  }

  /** The drums: a short thump, a brushed snare and a hat, all cheap one-shots. */

  private kick(t: number, level: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(level * 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    o.connect(g).connect(this.bus!);
    o.start(t);
    o.stop(t + 0.3);
    this.nodes.add(o);
    o.onended = () => this.nodes.delete(o);
  }

  private snare(t: number, level: number) {
    const ctx = this.ctx!;
    const len = Math.round(ctx.sampleRate * 0.16);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.045));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.value = level * 0.22;
    src.connect(bp).connect(g).connect(this.bus!);
    src.start(t);
    this.nodes.add(src);
    src.onended = () => this.nodes.delete(src);
  }

  private hat(t: number, level: number) {
    const ctx = this.ctx!;
    const len = Math.round(ctx.sampleRate * 0.05);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.012));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.value = level * 0.5;
    src.connect(hp).connect(g).connect(this.bus!);
    src.start(t);
    this.nodes.add(src);
    src.onended = () => this.nodes.delete(src);
  }

  /** Releases the compressor and bus (the caller owns the AudioContext). */
  dispose() {
    this.stop();
    this.bus?.disconnect();
    this.comp?.disconnect();
    this.bus = null;
    this.comp = null;
  }
}

/**
 * The theme's tune, in semitones above the tonic, by bar and eighth-note slot
 * (slot 0-7): [semitones, length in eighths]. Four bars per line, seven lines
 * (the intro is the first line again, one octave down, held long).
 */
const THEME_MELODY: ([number, number] | undefined)[][] = [
  // 0-3 intro: the tune's opening figure, lazy and long
  [[7, 2], undefined, undefined, undefined, [4, 1], undefined, [5, 1], undefined],
  [[7, 4], undefined, undefined, undefined, undefined, undefined, [9, 2], undefined],
  [[7, 2], undefined, undefined, undefined, [4, 1], undefined, [5, 1], undefined],
  [[4, 6], undefined, undefined, undefined, undefined, undefined, undefined, undefined],
  // 4-11 verse
  [[7, 2], undefined, undefined, undefined, [9, 1], undefined, [11, 1], undefined],
  [[12, 3], undefined, undefined, [9, 2], undefined, undefined, undefined, undefined],
  [[7, 2], undefined, [9, 1], undefined, [11, 3], undefined, undefined, undefined],
  [[9, 2], undefined, undefined, undefined, [7, 2], undefined, [4, 2], undefined],
  [[7, 2], undefined, undefined, undefined, [9, 1], undefined, [11, 1], undefined],
  [[12, 3], undefined, undefined, [14, 2], undefined, undefined, undefined, undefined],
  [[16, 2], undefined, [14, 1], undefined, [12, 3], undefined, undefined, undefined],
  [[14, 2], undefined, undefined, undefined, [12, 4], undefined, undefined, undefined],
  // 12-19 chorus: higher, bolder
  [[19, 2], undefined, [16, 1], undefined, [14, 2], undefined, [12, 1], undefined],
  [[12, 2], undefined, undefined, undefined, [14, 2], undefined, [16, 2], undefined],
  [[19, 3], undefined, undefined, [16, 2], undefined, undefined, undefined, undefined],
  [[14, 2], undefined, [16, 1], undefined, [19, 3], undefined, undefined, undefined],
  [[14, 2], undefined, undefined, undefined, [12, 2], undefined, [9, 2], undefined],
  [[12, 2], undefined, [9, 1], undefined, [7, 3], undefined, undefined, undefined],
  [[16, 2], undefined, [14, 1], undefined, [12, 2], undefined, [11, 2], undefined],
  [[12, 6], undefined, undefined, undefined, undefined, undefined, undefined, undefined],
  // 20-23 turnaround
  [[7, 1], undefined, [9, 1], undefined, [11, 1], undefined, [12, 1], undefined],
  [[14, 2], undefined, undefined, undefined, [12, 2], undefined, [9, 2], undefined],
  [[7, 1], undefined, [9, 1], undefined, [11, 1], undefined, [12, 1], undefined],
  [[14, 6], undefined, undefined, undefined, undefined, undefined, undefined, undefined],
  // 24-27 the close: the opening phrase again, then one long note
  [[7, 2], undefined, undefined, undefined, [4, 1], undefined, [5, 1], undefined],
  [[7, 4], undefined, undefined, undefined, undefined, undefined, [9, 2], undefined],
  [[7, 2], undefined, undefined, undefined, [11, 2], undefined, [12, 2], undefined],
  [[14, 8], undefined, undefined, undefined, undefined, undefined, undefined, undefined],
];
