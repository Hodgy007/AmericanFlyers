// One place that talks to Perplexity's Agent API (POST https://api.perplexity.ai/v1/agent) for the Climb guide.
// Decisions:
//  - official SDK `@perplexity-ai/perplexity_ai`, `client.responses.create`;
//  - `effort` (fast | low | medium | high | xhigh | ultra) picks the model, search and tools. Default "low", which
//    already includes web_search (docs: Agent API > Effort), so no `tools` are passed. PERPLEXITY_EFFORT overrides it;
//  - `max_output_tokens` bounds the answer (the docs allow overriding it under an effort), `store: false` keeps the
//    response out of retrieval, and a 25 s timeout with no retries bounds the wait;
//  - `response_format` json_schema asks for {summary, facts[]}. The docs warn that the first request with a new schema
//    can take 10 to 30 s to prepare, so a first call may time out; an answer that isn't JSON is still read as text;
//  - the answer is read from either the SDK object (`output_text`) or the raw JSON (`output[]`): message items'
//    output_text content, url_citation annotations, and search_results items (whose `id`s the [n] markers refer to);
//  - the key is read by api/ai.ts only and never logged.

import Perplexity from '@perplexity-ai/perplexity_ai';
import type { Climb, ClimbTopic } from '../../src/ai/climbs.js';
import { CLIMB_MAX_SOURCES } from '../../src/ai/sanitize.js';
import { CLIMB_SYSTEM, climbQuestion } from './prompts/climb.js';

export const DEFAULT_EFFORT = 'low';
export const MAX_OUTPUT_TOKENS = 900;
export const CALL_TIMEOUT_MS = 25_000;
export const SCHEMA_NAME = 'climb_guide';

export const CLIMB_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    facts: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'facts'],
  additionalProperties: false,
} as const;

/** An effort name, optionally pinned like `low@2026-10-16.0`. Anything else falls back to the default. */
export function pickEffort(env: string | undefined): string {
  const v = (env ?? '').trim();
  return /^(fast|low|medium|high|xhigh|ultra)(@[A-Za-z0-9._-]{1,40})?$/.test(v) ? v : DEFAULT_EFFORT;
}

export interface PerplexityRequest {
  effort: string;
  instructions: string;
  input: string;
  max_output_tokens: number;
  store: false;
  response_format: { type: 'json_schema'; json_schema: { name: string; schema: typeof CLIMB_SCHEMA } };
}

/** The request for one stage and topic. Only our own table data and the fixed topic text go into it. */
export function buildClimbRequest(climb: Climb, topic: ClimbTopic, today: string, effort: string = DEFAULT_EFFORT): PerplexityRequest {
  return {
    effort,
    instructions: CLIMB_SYSTEM,
    input: climbQuestion(climb, topic, today),
    max_output_tokens: MAX_OUTPUT_TOKENS,
    store: false,
    response_format: { type: 'json_schema', json_schema: { name: SCHEMA_NAME, schema: CLIMB_SCHEMA } },
  };
}

// ------------------------------------------------------------ response ----

export interface SearchHit { id: number | null; url: string; title: string }

export interface PerplexityAnswer {
  /** The answer text (the JSON string when a schema was used). */
  text: string;
  /** Every web result the model saw, in order, with the ids the [n] markers refer to. */
  results: SearchHit[];
  /** Sources named by url_citation annotations. */
  cited: SearchHit[];
  model: string | null;
  effort: string | null;
  usage: { input_tokens?: number; output_tokens?: number; total_tokens?: number; cost_usd?: number };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const numOrU = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Reads a Perplexity Agent API response, whether it is the SDK's object (with `output_text`) or the raw JSON body. */
export function parseAgentResponse(raw: unknown): PerplexityAnswer {
  const r = isObj(raw) ? raw : {};
  const output = Array.isArray(r.output) ? r.output : [];
  const results: SearchHit[] = [];
  const cited: SearchHit[] = [];
  let walked = '';
  for (const item of output) {
    if (!isObj(item)) continue;
    if (item.type === 'search_results' && Array.isArray(item.results)) {
      for (const hit of item.results) {
        if (!isObj(hit) || typeof hit.url !== 'string') continue;
        results.push({ id: typeof hit.id === 'number' ? hit.id : null, url: hit.url, title: str(hit.title) });
      }
    } else if (item.type === 'message' && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (!isObj(part) || part.type !== 'output_text') continue;
        walked += str(part.text);
        for (const a of Array.isArray(part.annotations) ? part.annotations : []) {
          if (isObj(a) && a.type === 'url_citation' && typeof a.url === 'string') cited.push({ id: null, url: a.url, title: str(a.title) });
        }
      }
    }
  }
  const text = typeof r.output_text === 'string' && r.output_text ? r.output_text : walked;
  const u = isObj(r.usage) ? r.usage : {};
  const cost = isObj(u.cost) ? numOrU(u.cost.total_cost) : undefined;
  return {
    text,
    results,
    cited,
    model: str(r.model) || null,
    effort: str(r.effort) || null,
    usage: { input_tokens: numOrU(u.input_tokens), output_tokens: numOrU(u.output_tokens), total_tokens: numOrU(u.total_tokens), cost_usd: cost },
  };
}

const MARKER = /\[(?:web:)?(\d{1,3})\]/g;
const urlKey = (u: string) => u.replace(/#.*$/, '');
const isHttps = (u: string) => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };
const hostOf = (u: string) => new URL(u).hostname.replace(/^www\./, '').toLowerCase();

export interface ClimbRaw {
  summary: string;
  facts: string[];
  sources: { n: number; title: string; host: string; url: string }[];
}

/** {summary, facts} from the model's text: the JSON object we asked for, else the plain text split into a paragraph and bullets. */
export function readSummaryFacts(text: string): { summary: string; facts: string[] } | null {
  const t = text.trim();
  if (!t) return null;
  const unfenced = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const j: unknown = JSON.parse(unfenced);
    if (isObj(j)) {
      const facts = Array.isArray(j.facts) ? j.facts.filter((f): f is string => typeof f === 'string') : [];
      return { summary: str(j.summary), facts };
    }
  } catch { /* not JSON: read it as text */ }
  const facts: string[] = [];
  const prose: string[] = [];
  for (const line of t.split(/\r?\n/)) {
    const bullet = /^\s*(?:[-•*]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) facts.push(bullet[1]);
    else if (line.trim() && !/^\s*#/.test(line)) prose.push(line.trim());
  }
  return { summary: prose.join(' '), facts };
}

/**
 * Turns an answer into {summary, facts, sources}: up to five https sources, deduplicated by URL and numbered 1 to 5,
 * those the text cites with [n] markers first (in order of first mention), then url_citation annotations, then the other
 * search results. Markers in the text are renumbered to match; markers that match no result are removed.
 */
export function buildClimbRaw(a: PerplexityAnswer): ClimbRaw | null {
  const sf = readSummaryFacts(a.text);
  if (!sf) return null;
  const sources: ClimbRaw['sources'] = [];
  const byUrl = new Map<string, number>();
  const idToN = new Map<number, number>();
  const add = (hit: SearchHit): number | null => {
    if (!isHttps(hit.url)) return null;
    const key = urlKey(hit.url);
    let n = byUrl.get(key);
    if (n === undefined) {
      if (sources.length >= CLIMB_MAX_SOURCES) return null;
      n = sources.length + 1;
      byUrl.set(key, n);
      sources.push({ n, title: hit.title.trim(), host: hostOf(hit.url), url: hit.url });
    }
    return n;
  };
  const byId = new Map<number, SearchHit>();
  for (const hit of a.results) if (hit.id !== null && !byId.has(hit.id)) byId.set(hit.id, hit);
  for (const m of [sf.summary, ...sf.facts].join(' ').matchAll(MARKER)) {
    const id = Number(m[1]);
    const hit = byId.get(id);
    if (!hit || idToN.has(id)) continue;
    const n = add(hit);
    if (n !== null) idToN.set(id, n);
  }
  for (const hit of a.cited) add(hit);
  for (const hit of a.results) add(hit);
  const renumber = (s: string) => s.replace(MARKER, (_m, id: string) => { const n = idToN.get(Number(id)); return n ? `[${n}]` : ''; });
  return { summary: renumber(sf.summary), facts: sf.facts.map(renumber), sources };
}

// -------------------------------------------------------------- errors ----

export type FailKind = 'auth' | 'rate_limit' | 'timeout' | 'other';

/** What went wrong with a call, without the message (it can carry request details): the kind, the HTTP status and Retry-After. */
export class PerplexityFailure extends Error {
  constructor(readonly kind: FailKind, readonly status: number | null, readonly retryAfter: string | null) {
    super(`perplexity ${kind}`);
    this.name = 'PerplexityFailure';
  }
}

export function classifyError(e: unknown): PerplexityFailure {
  if (e instanceof PerplexityFailure) return e;
  const err = (isObj(e) || e instanceof Error ? e : {}) as { status?: unknown; name?: unknown; headers?: unknown };
  const status = typeof err.status === 'number' ? err.status : null;
  let retryAfter: string | null = null;
  const h = err.headers as { get?: (k: string) => string | null } | Record<string, string> | undefined;
  if (h && typeof (h as { get?: unknown }).get === 'function') retryAfter = (h as { get: (k: string) => string | null }).get('retry-after');
  else if (isObj(h)) retryAfter = str((h as Record<string, unknown>)['retry-after']) || null;
  const name = str(err.name);
  if (status === 401 || status === 403) return new PerplexityFailure('auth', status, null);
  if (status === 429) return new PerplexityFailure('rate_limit', status, retryAfter);
  if (/Timeout|AbortError/.test(name)) return new PerplexityFailure('timeout', status, null);
  return new PerplexityFailure('other', status, null);
}

// -------------------------------------------------------------- runner ----

export type PerplexityRunner = (req: PerplexityRequest) => Promise<PerplexityAnswer>;

export function makeClient(apiKey: string) {
  return new Perplexity({ apiKey, timeout: CALL_TIMEOUT_MS, maxRetries: 0 });
}

export function makeRunner(client: Perplexity): PerplexityRunner {
  return async (req) => {
    try {
      const response = await client.responses.create(req, { timeout: CALL_TIMEOUT_MS, maxRetries: 0 });
      return parseAgentResponse(response);
    } catch (e) {
      throw classifyError(e);
    }
  };
}
