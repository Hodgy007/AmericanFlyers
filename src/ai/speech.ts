// Optional spoken lines (settings.coachVoice). A fixed line that has been recorded (VOICE_CLIPS, voiceClips.ts)
// plays its clip through an <audio> element; every other line, AI-written ones included, goes to the browser's own
// speechSynthesis. Feature-detected everywhere, never throws, and speaks one line at a time.
// (The race commentator has its own player in commentary.ts, a lazy chunk this file must not pull in.)

import { VOICE_CLIPS } from './voiceClips';
import { voiceClipUrl, voiceKey } from './voiceLines';

export const speechAvailable = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

type SpeakOpts = { pitch?: number; rate?: number };

/** Quiets the ride sounds while a clip speaks (main.ts hands in `sound.duck`). */
let onDuck: (on: boolean) => void = () => {};
export function setVoiceDuck(fn: (on: boolean) => void) { onDuck = fn; }

let clip: HTMLAudioElement | null = null;

function stopClip() {
  if (!clip) return;
  const el = clip;
  clip = null;
  try { el.pause(); } catch { /* fine */ }
  onDuck(false);
}

/** Plays a recorded clip; false when there is no <audio> to play it with. If the file fails to load the line is spoken instead. */
function playClip(url: string, fallback: () => void): boolean {
  if (typeof Audio === 'undefined') return false;
  try {
    stopClip();
    const el = new Audio(url);
    el.volume = 0.9;
    clip = el;
    const end = () => { if (clip === el) { clip = null; onDuck(false); } };
    el.addEventListener('ended', end);
    el.addEventListener('error', () => { const mine = clip === el; end(); if (mine) fallback(); }); // a missing or broken file
    onDuck(true);
    el.play().catch(() => { const mine = clip === el; end(); if (mine) fallback(); }); // blocked until the rider has clicked somewhere
    return true;
  } catch {
    return false;
  }
}

export function speak(text: string, opts: SpeakOpts = {}) {
  if (!speechAvailable() || !text) return;
  try {
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.pitch = opts.pitch ?? 1;
    u.rate = opts.rate ?? 1;
    u.volume = 0.9;
    const en = synth.getVoices().find((v) => /^en[-_]/i.test(v.lang));
    if (en) u.voice = en;
    synth.speak(u);
  } catch {
    // Speech is a bonus.
  }
}

/** Says a line as one of the voices (`coach` or a rival's id): its recording if there is one, else the browser's voice with `opts`. */
export function speakAs(speaker: string, text: string, opts: SpeakOpts = {}) {
  if (!text) return;
  stopSpeaking();
  if (VOICE_CLIPS.has(voiceKey(speaker, text)) && playClip(voiceClipUrl(speaker, text), () => speak(text, opts))) return;
  speak(text, opts);
}

export function stopSpeaking() {
  stopClip();
  try { if (speechAvailable()) window.speechSynthesis.cancel(); } catch { /* fine */ }
}
