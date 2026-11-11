// One place that talks to Perplexity's Sonar model for the Climb guide, through the Vercel AI Gateway
// (POST https://ai-gateway.vercel.sh/v1/chat/completions, the OpenAI-compatible Chat Completions format).
// Decisions:
//  - plain `fetch` with a 25 s timeout and no retries; no SDK;
//  - model "perplexity/sonar" unless CLIMB_GUIDE_MODEL says otherwise; `max_tokens` bounds the answer;
//  - auth is a Bearer token chosen in api/ai.ts: AI_GATEWAY_API_KEY, else the request's x-vercel-oidc-token header
//    (Vercel sets a fresh one on every function invocation), else VERCEL_OIDC_TOKEN (e.g. from `vercel env pull`),
//    the same order as @vercel/oidc. It is never logged;
//  - the answer is `choices[0].message.content`. Sonar searches the web itself and the gateway returns its sources;
//    where they sit is read defensively (top-level `citations` / `search_results`, `message.annotations`,
//    `provider_metadata`). The [n] markers in the text are 1-based positions in that source list.

import type { Climb, ClimbTopic } from '../../src/ai/climbs.js';
import { CLIMB_MAX_SOURCES } from '../../src/ai/sanitize.js';
import { CLIMB_SYSTEM, climbQuestion } from './prompts/climb.js';

export const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/chat/completions';
export const DEFAULT_MODEL = 'perplexity/sonar';
export const MAX_TOKENS = 900;
export const CALL_TIMEOUT_MS = 25_000;

/** A gateway model id like `perplexity/sonar`; anything else falls back to the default. */
export function pickModel(env: string | undefined): string {
  const v = (env ?? '').trim();
  return /^[a-z0-9][a-z0-9._-]{0,40}\/[A-Za-z0-9][A-Za-z0-9._:-]{0,60}$/.test(v) ? v : DEFAULT_MODEL;
}

/**
 * The first non-empty of: AI_GATEWAY_API_KEY, the request's x-vercel-oidc-token header (fresh per invocation), VERCEL_OIDC_TOKEN.
 * The header is only honoured on Vercel (which sets VERCEL in production); elsewhere it would be client-supplied.
 */
export function pickToken(env: Record<string, string | undefined>, headers: Headers): string | null {
  const fromHeader = env.VERCEL ? headers.get('x-vercel-oidc-token')?.trim() : null;
  return env.AI_GATEWAY_API_KEY?.trim() || fromHeader || env.VERCEL_OIDC_TOKEN?.trim() || null;
}

export interface GatewayRequest {
  model: string;
  messages: { role: 'system' | 'user'; content: string }[];
  max_tokens: number;
}

/** The request for one stage and topic. Only our own table data and the fixed topic text go into it. */
export function buildClimbRequest(climb: Climb, topic: ClimbTopic, today: string, model: string = DEFAULT_MODEL): GatewayRequest {
  return {
    model,
    messages: [
      { role: 'system', content: CLIMB_SYSTEM },
      { role: 'user', content: climbQuestion(climb, topic, today) },
    ],
    max_tokens: MAX_TOKENS,
  };
}

// ------------------------------------------------------------ response ----

export interface SearchHit { id: number | null; url: string; title: string }

export interface PerplexityAnswer {
  /** The answer text (a JSON string, as asked). */
  text: string;
  /** Every source the model had, in order; `id` is the 1-based position the [n] markers refer to. */
  results: SearchHit[];
  /** Sources named by url_citation annotations. */
  cited: SearchHit[];
  model: string | null;
  /** Where the gateway put the sources: for the log, to confirm the real shape. */
  sourcesFrom: 'citations' | 'search_results' | 'annotations' | 'none';
  usage: { input_tokens?: number; output_tokens?: number; total_tokens?: number; cost_usd?: number };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const numOrU = (v: unknown) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

const hitFrom = (v: unknown, id: number | null): SearchHit | null => {
  if (typeof v === 'string') return { id, url: v, title: '' };
  if (!isObj(v)) return null;
  const inner = isObj(v.url_citation) ? v.url_citation : v;
  return typeof inner.url === 'string' ? { id, url: inner.url, title: str(inner.title) } : null;
};

/** Finds a field in the places the gateway may put it: the roots, their provider_metadata, and one level below that. */
function findAll(roots: Record<string, unknown>[], key: string): unknown[] {
  const found: unknown[] = [];
  const seen = new Set<unknown>();
  const visit = (o: Record<string, unknown>, depth: number) => {
    if (seen.has(o)) return;
    seen.add(o);
    if (key in o) found.push(o[key]);
    if (depth > 0) for (const k of ['provider_metadata', 'perplexity', 'gateway']) if (isObj(o[k])) visit(o[k], depth - 1);
  };
  for (const r of roots) visit(r, 2);
  return found;
}

/** Reads a gateway Chat Completions response (the raw JSON body). */
export function parseGatewayResponse(raw: unknown): PerplexityAnswer {
  const r = isObj(raw) ? raw : {};
  const choice = Array.isArray(r.choices) && isObj(r.choices[0]) ? r.choices[0] : {};
  const message = isObj(choice.message) ? choice.message : {};
  let text = '';
  if (typeof message.content === 'string') text = message.content;
  else if (Array.isArray(message.content)) text = message.content.map((p) => (isObj(p) ? str(p.text) : '')).join('');
  const roots = [r, message];

  // `citations` (urls) and `search_results` (url + title) are both in the order the [n] markers count from.
  const titles = new Map<string, string>();
  let results: SearchHit[] = [];
  let sourcesFrom: PerplexityAnswer['sourcesFrom'] = 'none';
  const asHits = (list: unknown[]) => list.map((v, i) => hitFrom(v, i + 1) ?? { id: i + 1, url: '', title: '' });
  for (const list of findAll(roots, 'search_results')) {
    if (!Array.isArray(list)) continue;
    const hits = asHits(list);
    for (const h of hits) if (h.title && !titles.has(h.url)) titles.set(h.url, h.title);
    if (!results.length && hits.length) { results = hits; sourcesFrom = 'search_results'; }
  }
  for (const list of findAll(roots, 'citations')) {
    if (!Array.isArray(list) || !list.length) continue;
    results = asHits(list);
    sourcesFrom = 'citations';
    break;
  }
  results = results.map((h) => ({ ...h, title: h.title || titles.get(h.url) || '' }));

  const cited: SearchHit[] = [];
  for (const list of findAll(roots, 'annotations')) {
    if (!Array.isArray(list)) continue;
    for (const a of list) {
      if (!isObj(a) || (a.type !== undefined && a.type !== 'url_citation')) continue;
      const hit = hitFrom(a, null);
      if (hit) cited.push({ ...hit, title: hit.title || titles.get(hit.url) || '' });
    }
  }

  if (sourcesFrom === 'none' && cited.length) sourcesFrom = 'annotations';

  const u = isObj(r.usage) ? r.usage : {};
  const gw = findAll([message, r], 'gateway').find(isObj);
  const cost = numOrU(u.cost) ?? numOrU(isObj(u.cost) ? u.cost.total_cost : undefined) ?? numOrU(gw?.cost) ?? numOrU(gw?.marketCost);
  return {
    text,
    results,
    cited,
    model: str(r.model) || null,
    sourcesFrom,
    usage: {
      input_tokens: numOrU(u.prompt_tokens) ?? numOrU(u.input_tokens),
      output_tokens: numOrU(u.completion_tokens) ?? numOrU(u.output_tokens),
      total_tokens: numOrU(u.total_tokens),
      cost_usd: cost,
    },
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
 * sources. Markers in the text are renumbered to match; markers that match no source are removed.
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
    super(`climb guide ${kind}`);
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

export type PerplexityRunner = (req: GatewayRequest, signal?: AbortSignal) => Promise<PerplexityAnswer>;

/** Calls the gateway with plain fetch. Failures are thrown as PerplexityFailure (kind, status, Retry-After), never with the response text. */
export function makeRunner(token: string, fetcher: typeof fetch = fetch, url: string = GATEWAY_URL): PerplexityRunner {
  return async (req, signal) => {
    const requestSignal = AbortSignal.any([AbortSignal.timeout(CALL_TIMEOUT_MS), ...(signal ? [signal] : [])]);
    let res: Response;
    try {
      requestSignal.throwIfAborted();
      res = await fetcher(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(req),
        signal: requestSignal,
      });
    } catch (e) {
      throw classifyError(e);
    }
    if (!res.ok) throw classifyError({ status: res.status, headers: res.headers });
    let body: unknown;
    try {
      body = await res.json();
    } catch (e) {
      throw classifyError(e);
    }
    return parseGatewayResponse(body);
  };
}
