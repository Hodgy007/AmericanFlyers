// POST /api/ai: the one endpoint behind the AI coach and the AI rivals.
//
// Who is asking is decided by the database, not by a secret of ours: the
// browser sends the rider's own Neon token, and this function calls the Data
// API function ai_claim() with it. The database checks that the token is real
// (the Data API validates the JWT), that the rider opted in, isn't banned and
// is under today's quota, then returns the little the prompt may say about
// them. Nothing is trusted from the request body except ride numbers.
//
// Everything outside (the Anthropic client, fetch, the clock, the logger) is
// injected so the tests run without a network.

import { PAYLOADS, Envelope } from './schemas.js';
import * as S from './schemas.js';
import { claim, recordRival, type Claim, type DataApi } from './rider.js';
import { DEFAULT_MODEL, isAnthropicError, type ClaudeOutcome, type ClaudeRunner } from './claude.js';
import { COACH_SYSTEM, debriefUser, planUser, tipUser } from './prompts/coach.js';
import { RIVAL_SYSTEM, rivalPostUser, rivalPreUser } from './prompts/rivals.js';
import { cannedClimb, cannedDebrief, cannedPlan, cannedRivalLines, cannedRivalPost, cannedTip } from '../../src/ai/canned.js';
import { sanitizeClimbGuide, sanitizeDebrief, sanitizePlan, sanitizeRivalLines, sanitizeRivalPost, sanitizeTip } from '../../src/ai/sanitize.js';
import { climbById, type ClimbTopic } from '../../src/ai/climbs.js';
import type { AiError, AiKind, AiReply, AiResults } from '../../src/ai/types.js';
import { buildClimbRaw, buildClimbRequest, classifyError, DEFAULT_MODEL as DEFAULT_CLIMB_MODEL, type PerplexityRunner } from './perplexity.js';

export const MAX_BODY_BYTES = 24_000;
// Leave time to return an error before the browser's 38 s and Vercel's 40 s deadlines.
export const AI_BUDGET_MS = 35_000;

export interface AiDeps {
  /** Null when ANTHROPIC_API_KEY isn't set. */
  runner: ClaudeRunner | null;
  model?: string;
  /** The Climb guide's web-search runner; null when there is no AI Gateway token (see api/ai.ts). */
  perplexity?: PerplexityRunner | null;

  /** CLIMB_GUIDE_MODEL, already checked (see pickModel). */
  climbModel?: string;
  dataApi: DataApi;
  now?: () => Date;
  log?: (line: string) => void;
}

const json = (status: number, body: AiReply | AiError | Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const fail = (status: number, error: AiError['error'], message: string) => json(status, { ok: false, error, message } satisfies AiError);

// ---------------------------------------------------------- rate limit ----

/**
 * Best-effort fixed-window limiter in memory: at most `limit` hits per `windowMs` per key.
 * Per instance only (Vercel may run several functions in parallel), so it complements, not
 * replaces, the database-side quota.
 */
export class WindowLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(readonly limit = 30, readonly windowMs = 60_000) {}

  /** Records a hit; returns 0 when allowed, else the seconds to wait. */
  take(key: string, now = Date.now()): number {
    const since = now - this.windowMs;
    const times = (this.hits.get(key) ?? []).filter((t) => t > since);
    if (times.length >= this.limit) {
      this.hits.set(key, times);
      return Math.max(1, Math.ceil((times[0] + this.windowMs - now) / 1000));
    }
    times.push(now);
    this.hits.set(key, times);
    if (this.hits.size > 10_000) for (const [k, ts] of this.hits) if (!ts.some((t) => t > since)) this.hits.delete(k);
    return 0;
  }
}

const limiter = new WindowLimiter();

const clientKey = (req: Request) => (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';

/** Reads the body as text, aborting (null) as soon as it would pass `cap` bytes. */
async function readCapped(req: Request, cap: number, signal: AbortSignal): Promise<string | null> {
  signal.throwIfAborted();
  if (!req.body) return '';
  const reader = req.body.getReader();
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > cap) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
    const all = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) { all.set(c, at); at += c.byteLength; }
    return new TextDecoder().decode(all);
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}


export async function handleAi(req: Request, deps: AiDeps): Promise<Response> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new DOMException('AI deadline exceeded', 'TimeoutError')), AI_BUDGET_MS);
  const signal = AbortSignal.any([req.signal, deadline.signal]);
  try {
    return await handleRequest(req, deps, signal);
  } catch (e) {
    if (signal.aborted) return fail(504, 'unavailable', 'The AI took too long. Your ride carries on with the built-in tips.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function handleRequest(req: Request, deps: AiDeps, signal: AbortSignal): Promise<Response> {
  signal.throwIfAborted();
  const log = deps.log ?? (() => {});
  const started = Date.now();
  if (req.method !== 'POST') return fail(405, 'bad_request', 'Use POST.');

  const ip = clientKey(req);
  const wait = limiter.take(ip);
  if (wait) {
    const tooMany = fail(429, 'unavailable', 'Too many requests. Try again in a minute.');
    tooMany.headers.set('retry-after', String(wait));
    return tooMany;
  }

  const auth = req.headers.get('authorization') ?? '';
  const token = /^Bearer ([A-Za-z0-9._-]{20,4096})$/.exec(auth)?.[1];
  if (!token || token.split('.').length !== 3) return fail(401, 'sign_in', 'Sign in to use the AI coach and rivals.');

  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) return fail(413, 'bad_request', 'That request is too big.');
  const text = await readCapped(req, MAX_BODY_BYTES, signal);
  if (text === null) return fail(413, 'bad_request', 'That request is too big.');

  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return fail(400, 'bad_request', 'That request wasn’t valid.'); }
  const env = Envelope.safeParse(raw);
  if (!env.success) return fail(400, 'bad_request', 'That request wasn’t valid.');
  const kind = env.data.kind;
  const parsed = PAYLOADS[kind].safeParse(env.data.payload);
  if (!parsed.success) return fail(400, 'bad_request', 'The ride details weren’t valid.');
  const payload = parsed.data as never as Record<string, any>;

  if (kind === 'coach_climb' ? !deps.perplexity : !deps.runner) return fail(503, 'not_configured', 'The AI isn’t set up on this server yet.');

  // The gate: sign-in, opt-in, ban and quota, all decided by the database with the rider's own token.
  const rival: string | null = kind === 'rival_pre' || kind === 'rival_post' ? payload.rival : null;
  const gate = await claim(deps.dataApi, token, kind, rival, signal);
  signal.throwIfAborted();
  if (gate.kind === 'sign_in') return fail(401, 'sign_in', 'Please sign in again to use the AI.');
  if (gate.kind === 'unavailable') return fail(503, 'unavailable', 'The AI is taking a break. Try again in a bit.');
  if (gate.kind === 'denied') {
    if (gate.reason === 'no_consent') return fail(403, 'no_consent', 'Turn on the AI coach or AI rivals in Settings first.');
    if (gate.reason === 'banned') return fail(403, 'banned', 'The AI isn’t available on this account.');
    return fail(429, 'quota', 'You’ve used all of today’s AI messages for this. They come back tomorrow (UTC), and your ride still has its built-in tips.');
  }
  const c = gate.claim;
  const today = (deps.now?.() ?? new Date()).toISOString().slice(0, 10);
  const model = deps.model || DEFAULT_MODEL;

  if (kind === 'coach_climb') return climbGuide(deps, payload as ClimbPayload, c, today, started, signal);

  let outcome: ClaudeOutcome<unknown>;
  try {
    outcome = await run(kind, payload, c, today, model, deps.runner as ClaudeRunner, signal);
    signal.throwIfAborted();
  } catch (e) {
    signal.throwIfAborted();
    log(JSON.stringify({ ai: true, kind, error: isAnthropicError(e) ? (e as Error).name : 'unexpected', status: (e as { status?: number }).status ?? null, ms: Date.now() - started }));
    return fail(503, 'unavailable', 'The AI is busy right now. Your ride carries on with the built-in tips.');
  }
  log(JSON.stringify({ ai: true, kind, model: outcome.model, outcome: outcome.status, ms: Date.now() - started, ...outcome.usage }));

  // Claude's answer (or the canned text if the chain refused or the reply can't be used), trimmed and checked.
  let source: 'claude' | 'canned' = 'claude';
  let data = outcome.status === 'ok' ? finish(kind, outcome.data, payload) : null;
  if (!data) { source = 'canned'; data = canned(kind, payload); }

  if (kind === 'rival_post' && payload.counts && !signal.aborted) {
    const note = (data as AiResults['rival_post']).note;
    // Memory is optional and gets at most 2 s; do not discard a completed reply if that write times out.
    const saved = await recordRival(deps.dataApi, token, payload.rival, payload.result === 'won', note, signal);
    if (!saved) log(JSON.stringify({ ai: true, kind, warning: 'rival_record failed' }));
  }
  req.signal.throwIfAborted();
  return json(200, { ok: true, kind, source, data, remaining: Math.max(0, c.limit - c.used) } as AiReply);
}

type ClimbPayload = { stageId: string; topic: ClimbTopic };

/**
 * The Climb guide: one Perplexity Sonar call (web search) through the Vercel AI Gateway. The question is built from our own stage table, so
 * the body only chooses a stage and a topic. Failures are logged without the key, the prompt or the provider's message.
 */
async function climbGuide(deps: AiDeps, p: ClimbPayload, c: Claim, today: string, started: number, signal: AbortSignal): Promise<Response> {
  const log = deps.log ?? (() => {});
  const climb = climbById(p.stageId);
  if (!climb || !deps.perplexity) return fail(400, 'bad_request', 'The ride details weren’t valid.');
  const climbModel = deps.climbModel || DEFAULT_CLIMB_MODEL;
  const remaining = Math.max(0, c.limit - c.used);
  let answer;
  try {
    answer = await deps.perplexity(buildClimbRequest(climb, p.topic, today, climbModel), signal);
    signal.throwIfAborted();
  } catch (e) {
    signal.throwIfAborted();
    const f = classifyError(e);
    log(JSON.stringify({ ai: true, kind: 'coach_climb', provider: 'perplexity-gateway', model: climbModel, error: f.kind, status: f.status, ...(f.retryAfter ? { retryAfter: f.retryAfter } : {}), ms: Date.now() - started }));
    return f.kind === 'timeout'
      ? fail(504, 'unavailable', 'The climb guide took too long. Try again in a bit.')
      : fail(503, 'unavailable', 'The climb guide is taking a break. Try again in a bit.');
  }
  const raw = buildClimbRaw(answer);
  const data = raw ? sanitizeClimbGuide(raw, p.stageId, p.topic, today) : null;
  log(JSON.stringify({ ai: true, kind: 'coach_climb', provider: 'perplexity-gateway', model: answer.model ?? climbModel, outcome: data ? 'ok' : 'unusable', sources: answer.sourcesFrom, n_sources: data?.sources.length ?? 0, ms: Date.now() - started, ...answer.usage }));
  if (!data) return json(200, { ok: true, kind: 'coach_climb', source: 'canned', data: cannedClimb(p, false, today), remaining } as AiReply);
  return json(200, { ok: true, kind: 'coach_climb', source: 'web', data, remaining } as AiReply);
}

async function run(kind: AiKind, p: Record<string, any>, c: Claim, today: string, model: string, runner: ClaudeRunner, signal: AbortSignal): Promise<ClaudeOutcome<unknown>> {
  switch (kind) {
    case 'coach_plan': return runner({ model, system: COACH_SYSTEM, user: planUser(p as never, c, today), schema: S.PlanOut, signal });
    case 'coach_tip': return runner({ model, system: COACH_SYSTEM, user: tipUser(p as never, c, today), schema: S.TipOut, signal });
    case 'coach_debrief': return runner({ model, system: COACH_SYSTEM, user: debriefUser(p as never, c, today), schema: S.DebriefOut, signal });
    case 'rival_pre': return runner({ model, system: RIVAL_SYSTEM, user: rivalPreUser(p as never, c, today), schema: S.RivalPreOut, signal });
    case 'rival_post': return runner({ model, system: RIVAL_SYSTEM, user: rivalPostUser(p as never, c, today), schema: S.RivalPostOut, signal });
    case 'coach_climb': throw new Error('coach_climb is not a Claude request');
  }
}

function finish(kind: AiKind, raw: unknown, p: Record<string, any>): AiResults[AiKind] | null {
  switch (kind) {
    case 'coach_plan': return sanitizePlan(raw, p.workout ? null : p.stage.lengthM);
    case 'coach_tip': return sanitizeTip(raw);
    case 'coach_debrief': return sanitizeDebrief(raw);
    case 'rival_pre': return sanitizeRivalLines(raw, p.rival);
    case 'rival_post': return sanitizeRivalPost(raw);
    case 'coach_climb': return null;
  }
}

function canned(kind: AiKind, p: Record<string, any>): AiResults[AiKind] {
  switch (kind) {
    case 'coach_plan': return cannedPlan(p as never);
    case 'coach_tip': return { text: cannedTip(p.moment) };
    case 'coach_debrief': return cannedDebrief(p as never);
    case 'rival_pre': return { lines: cannedRivalLines(p.rival) };
    case 'rival_post': return cannedRivalPost(p as never);
    case 'coach_climb': return cannedClimb(p as never);
  }
}

