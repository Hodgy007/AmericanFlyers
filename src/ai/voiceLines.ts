// Every FIXED line the coach and the rivals can say, and the file each is recorded to. Pure (no DOM), shared by
// the app (voiceClipUrl) and scripts/voice-lines.mjs (the list the voice generator loops over).
// A line's file name carries a hash of its exact text, so editing a line makes a new file name: the old clip is
// then simply not found in VOICE_CLIPS (voiceClips.ts) and the line falls back to the browser's voice.
// AI-written lines and lines with numbers worked in are never listed: they are always spoken by speechSynthesis.

import { CANNED_TIPS, COACH_PLAN_LINES } from './canned.js';
import { RIVALS } from './rivals.js';
import { RIVAL_TRIGGERS } from './types.js';

/** The voices: the coach and the four rivals (their ids are in rivals.ts). */
export const COACH_VOICE = 'coach';

export interface VoiceLine {
  speaker: string;
  text: string;
  /** `speaker/slug`: the key in VOICE_CLIPS. */
  key: string;
  /** Where the clip is served from. */
  file: string;
}

/** 32-bit FNV-1a of the text, as 8 hex digits: stable across runs and platforms. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** The first five words, lowercased and dashed, then the hash: `ready-when-you-are-save-1a2b3c4d`. */
export function voiceSlug(text: string): string {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').split(/\s+/).filter(Boolean).slice(0, 5);
  return `${words.join('-') || 'line'}-${fnv1a(text)}`;
}

export const voiceKey = (speaker: string, text: string) => `${speaker}/${voiceSlug(text)}`;

/** Where the clip for this line is (or will be) served from. */
export function voiceClipUrl(speaker: string, text: string): string {
  return `/audio/voices/${voiceKey(speaker, text)}.mp3`;
}

/** Every fixed line, one entry per speaker and distinct text. */
export function allVoiceLines(): VoiceLine[] {
  const raw: [string, string][] = [];
  for (const r of RIVALS) {
    for (const t of RIVAL_TRIGGERS) for (const line of r.canned[t]) raw.push([r.id, line]);
    for (const line of [...r.closing.won, ...r.closing.lost]) raw.push([r.id, line]);
  }
  for (const list of Object.values(CANNED_TIPS)) for (const line of list) raw.push([COACH_VOICE, line]);
  for (const line of COACH_PLAN_LINES) raw.push([COACH_VOICE, line]);
  const seen = new Set<string>();
  const out: VoiceLine[] = [];
  for (const [speaker, text] of raw) {
    const key = voiceKey(speaker, text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ speaker, text, key, file: voiceClipUrl(speaker, text) });
  }
  return out;
}
