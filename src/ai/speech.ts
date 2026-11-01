// Optional spoken lines (settings.coachVoice): the browser's own speechSynthesis.
// Feature-detected everywhere, never throws, and speaks one line at a time.

export const speechAvailable = () => typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';

export function speak(text: string, opts: { pitch?: number; rate?: number } = {}) {
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

export function stopSpeaking() {
  try { if (speechAvailable()) window.speechSynthesis.cancel(); } catch { /* fine */ }
}
