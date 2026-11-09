// Checks and trims whatever came back from the AI before it is shown: the
// Vercel function runs it on Claude's JSON, and the browser runs it again on
// the function's reply, so a surprise in either place becomes a canned
// fallback rather than a broken screen. Each function returns null when the
// reply can't be used. Pure.

import { cleanLine } from './text.js';
import { cannedRivalLines } from './canned.js';
import { SUGGESTION_IDS } from './catalogue.js';
import {
  RIVAL_TRIGGERS,
  type ClimbResult, type ClimbSource, type CoachTip, type DebriefResult, type PlanResult, type RivalLines, type RivalPostResult, type TipResult,
} from './types.js';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const strings = (v: unknown, n: number, words: number): string[] =>
  (Array.isArray(v) ? v : []).map((x) => cleanLine(x, words)).filter(Boolean).slice(0, n);

export const TIP_WORDS = 18;
export const RIVAL_WORDS = 16;

export function sanitizeTip(raw: unknown): TipResult | null {
  const text = isObj(raw) ? cleanLine(raw.text, TIP_WORDS) : '';
  return text ? { text } : null;
}

export function sanitizePlan(raw: unknown, lengthM: number | null = null): PlanResult | null {
  if (!isObj(raw) || !Array.isArray(raw.tips)) return null;
  const tips: CoachTip[] = [];
  for (const t of raw.tips) {
    if (!isObj(t)) continue;
    const text = cleanLine(t.text, TIP_WORDS);
    let at_m = num(t.at_m);
    const at_s = num(t.at_s);
    if (at_m !== null && lengthM !== null && at_m > lengthM) at_m = null;
    if (!text || (at_m === null && at_s === null)) continue;
    tips.push({ at_m: at_m === null ? null : Math.round(at_m), at_s: at_m === null && at_s !== null ? Math.round(at_s) : null, text });
  }
  tips.sort((a, b) => (a.at_m ?? a.at_s ?? 0) - (b.at_m ?? b.at_s ?? 0));
  return tips.length ? { tips: tips.slice(0, 8) } : null;
}

export function sanitizeDebrief(raw: unknown): DebriefResult | null {
  if (!isObj(raw)) return null;
  const headline = cleanLine(raw.headline, 10, 80);
  const summary = cleanLine(raw.summary, 60, 420);
  const went_well = strings(raw.went_well, 2, 16);
  const work_on = strings(raw.work_on, 2, 16);
  const next = isObj(raw.next) ? raw.next : null;
  const id = typeof next?.id === 'string' ? next.id : '';
  if (!headline || !summary || !went_well.length || !work_on.length || !SUGGESTION_IDS.includes(id)) return null;
  return { headline, summary, went_well, work_on, next: { id, why: cleanLine(next?.why, 20) } };
}

/** Lines per trigger; a trigger with nothing usable gets the rival's canned lines. */
export function sanitizeRivalLines(raw: unknown, rivalId: string): { lines: RivalLines; usable: number } | null {
  if (!isObj(raw) || !isObj(raw.lines)) return null;
  const canned = cannedRivalLines(rivalId);
  let usable = 0;
  const lines = Object.fromEntries(RIVAL_TRIGGERS.map((t) => {
    const got = strings((raw.lines as Record<string, unknown>)[t], 2, RIVAL_WORDS);
    if (got.length) usable++;
    return [t, got.length ? got : canned[t]];
  })) as RivalLines;
  return usable >= 4 ? { lines, usable } : null;
}

export function sanitizeRivalPost(raw: unknown): RivalPostResult | null {
  if (!isObj(raw)) return null;
  const line = cleanLine(raw.line, RIVAL_WORDS);
  if (!line) return null;
  return { line, note: cleanLine(raw.note, 24, 140) };
}

// ------------------------------------------------------- climb guide ----

export const CLIMB_SUMMARY_CHARS = 520;
export const CLIMB_FACT_CHARS = 240;
export const CLIMB_MAX_FACTS = 5;
export const CLIMB_MAX_SOURCES = 5;

/**
 * Plain text for the screen: no HTML or markdown, one paragraph, at most `max` characters, and a
 * citation marker like [2] kept only when `remap` has a source for it (renumbered through `remap`).
 */
export function cleanProse(text: unknown, max: number, remap: ReadonlyMap<number, number>): string {
  if (typeof text !== 'string') return '';
  let s = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\[([^\]\d][^\]]*)\]\([^)]*\)/g, '$1') // [label](url) becomes label
    .replace(/\[(?:web:)?(\d{1,3})\]/g, (_m, n: string) => { const to = remap.get(Number(n)); return to ? `[${to}]` : ''; })
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/[*_`#>~|\\]/g, '')
    .replace(/^\s*[-•]\s+/, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
  if (s.length > max) {
    s = s.slice(0, max).replace(/\s+\S*$/, '').replace(/\[\d*$/, '').trim();
    if (!/[.!?]$/.test(s)) s += '…';
  }
  return s;
}

const hostOf = (url: string): string | null => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname.includes('.') ? u.hostname.replace(/^www\./, '').toLowerCase() : null;
  } catch {
    return null;
  }
};

/**
 * Checks a web answer ({summary, facts, sources}) before it is shown: https sources only (deduplicated, at most five,
 * renumbered from 1 with the markers in the text following them), plain text, length caps. Null when nothing usable is left.
 */
export function sanitizeClimbGuide(raw: unknown, stageId: string, topic: ClimbResult['topic'], asOf: string): ClimbResult | null {
  if (!isObj(raw)) return null;
  const sources: ClimbSource[] = [];
  const remap = new Map<number, number>();
  const seen = new Set<string>();
  for (const [i, s] of (Array.isArray(raw.sources) ? raw.sources : []).entries()) {
    if (!isObj(s) || typeof s.url !== 'string' || sources.length >= CLIMB_MAX_SOURCES) continue;
    const host = hostOf(s.url);
    if (!host || seen.has(s.url)) continue;
    seen.add(s.url);
    const n = sources.length + 1;
    const was = typeof s.n === 'number' && Number.isInteger(s.n) ? s.n : i + 1;
    remap.set(was, n);
    sources.push({ n, title: cleanProse(s.title, 90, new Map()) || host, host, url: s.url });
  }
  const summary = cleanProse(raw.summary, CLIMB_SUMMARY_CHARS, remap);
  const facts = (Array.isArray(raw.facts) ? raw.facts : []).map((f) => cleanProse(f, CLIMB_FACT_CHARS, remap)).filter(Boolean).slice(0, CLIMB_MAX_FACTS);
  if (!summary && !facts.length) return null;
  return { stageId, topic, summary, facts, sources, asOf };
}
