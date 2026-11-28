import { describe, expect, it } from 'vitest';
import { CANNED_TIPS, COACH_PLAN_LINES, cannedPlan } from '../../src/ai/canned';
import { RIVALS } from '../../src/ai/rivals';
import { RIVAL_TRIGGERS } from '../../src/ai/types';
import { allVoiceLines, fnv1a, voiceClipUrl, voiceKey, voiceSlug } from '../../src/ai/voiceLines';
import { VOICE_CLIPS } from '../../src/ai/voiceClips';
import { cleanLine } from '../../src/ai/text';

describe('voice line names', () => {
  it('hashes stably (FNV-1a) and names a clip by its words and hash', () => {
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('a')).toBe('e40c292c');
    expect(voiceSlug('Ready when you are. Save something for the sprint!')).toBe(`ready-when-you-are-save-${fnv1a('Ready when you are. Save something for the sprint!')}`);
    expect(voiceClipUrl('blaze', 'Watch this!')).toBe(`/audio/voices/blaze/watch-this-${fnv1a('Watch this!')}.mp3`);
    expect(voiceKey('coach', 'Hi')).toBe(`coach/hi-${fnv1a('Hi')}`);
  });

  it('changes the file name when the line changes', () => {
    expect(voiceSlug('Watch this!')).not.toBe(voiceSlug('Watch this.'));
  });

  it('only uses safe characters in a file name', () => {
    for (const l of allVoiceLines()) expect(l.file).toMatch(/^\/audio\/voices\/[a-z]+\/[a-z0-9-]+\.mp3$/);
  });
});

describe('the list of fixed lines', () => {
  const lines = allVoiceLines();
  const has = (speaker: string, text: string) => lines.some((l) => l.speaker === speaker && l.text === text);

  it('has every rival canned and closing line', () => {
    for (const r of RIVALS) {
      for (const t of RIVAL_TRIGGERS) for (const line of r.canned[t]) expect(has(r.id, line)).toBe(true);
      for (const line of [...r.closing.won, ...r.closing.lost]) expect(has(r.id, line)).toBe(true);
    }
  });

  it('has every coach tip and fixed plan line, which the plan says unchanged', () => {
    for (const list of Object.values(CANNED_TIPS)) for (const line of list) expect(has('coach', line)).toBe(true);
    for (const line of COACH_PLAN_LINES) { expect(has('coach', line)).toBe(true); expect(cleanLine(line, 18)).toBe(line); }
    const plan = cannedPlan({ stage: { climbs: [], sprints: [], koms: [], lengthM: 5000 }, workout: null } as never);
    for (const t of plan.tips) if (COACH_PLAN_LINES.includes(t.text as never)) expect(has('coach', t.text)).toBe(true);
  });

  it('lists no templated or duplicate lines and has unique keys and files', () => {
    for (const l of lines) expect(l.text).not.toMatch(/\$\{|\{\{/);
    expect(new Set(lines.map((l) => l.key)).size).toBe(lines.length);
    expect(new Set(lines.map((l) => l.file)).size).toBe(lines.length);
    expect(new Set(lines.map((l) => l.speaker))).toEqual(new Set(['coach', ...RIVALS.map((r) => r.id)]));
  });

  it('only marks clips that belong to a current line', () => {
    const keys = new Set(lines.map((l) => l.key));
    for (const k of VOICE_CLIPS) expect(keys.has(k)).toBe(true);
  });
});
