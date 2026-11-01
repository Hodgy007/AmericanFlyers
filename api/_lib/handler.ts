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
import { cannedDebrief, cannedPlan, cannedRivalLines, cannedRivalPost, cannedTip } from '../../src/ai/canned.js';
import { sanitizeDebrief, sanitizePlan, sanitizeRivalLines, sanitizeRivalPost, sanitizeTip } from '../../src/ai/sanitize.js';
import type { AiError, AiKind, AiReply, AiResults } from '../../src/ai/types.js';

export const MAX_BODY_BYTES = 24_000;

export interface AiDeps {
  /** Null when ANTHROPIC_API_KEY isn't set. */
  runner: ClaudeRunner | null;
  model?: string;
  dataApi: DataApi;
  now?: () => Date;
  log?: (line: string) => void;
}

const json = (status: number, body: AiReply | AiError | Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const fail = (status: number, error: AiError['error'], message: string) => json(status, { ok: false, error, message } satisfies AiError);


export async function handleAi(req: Request, deps: AiDeps): Promise<Response> {
  const log = deps.log ?? (() => {});
  const started = Date.now();
  if (req.method !== 'POST') return fail(405, 'bad_request', 'Use POST.');

  const auth = req.headers.get('authorization') ?? '';
  const token = /^Bearer ([A-Za-z0-9._-]{20,4096})$/.exec(auth)?.[1];
  if (!token || token.split('.').length !== 3) return fail(401, 'sign_in', 'Sign in to use the AI coach and rivals.');

  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) return fail(413, 'bad_request', 'That request is too big.');
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return fail(413, 'bad_request', 'That request is too big.');

  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return fail(400, 'bad_request', 'That request wasn’t valid.'); }
  const env = Envelope.safeParse(raw);
  if (!env.success) return fail(400, 'bad_request', 'That request wasn’t valid.');
  const kind = env.data.kind;
  const parsed = PAYLOADS[kind].safeParse(env.data.payload);
  if (!parsed.success) return fail(400, 'bad_request', 'The ride details weren’t valid.');
  const payload = parsed.data as never as Record<string, any>;

  if (!deps.runner) return fail(503, 'not_configured', 'The AI isn’t set up on this server yet.');

  // The gate: sign-in, opt-in, ban and quota, all decided by the database with the rider's own token.
  const rival: string | null = kind === 'rival_pre' || kind === 'rival_post' ? payload.rival : null;
  const gate = await claim(deps.dataApi, token, kind, rival);
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

  let outcome: ClaudeOutcome<unknown>;
  try {
    outcome = await run(kind, payload, c, today, model, deps.runner);
  } catch (e) {
    log(JSON.stringify({ ai: true, kind, error: isAnthropicError(e) ? (e as Error).name : 'unexpected', status: (e as { status?: number }).status ?? null, ms: Date.now() - started }));
    return fail(503, 'unavailable', 'The AI is busy right now. Your ride carries on with the built-in tips.');
  }
  log(JSON.stringify({ ai: true, kind, model: outcome.model, outcome: outcome.status, ms: Date.now() - started, ...outcome.usage }));

  // Claude's answer (or the canned text if the chain refused or the reply can't be used), trimmed and checked.
  let source: 'claude' | 'canned' = 'claude';
  let data = outcome.status === 'ok' ? finish(kind, outcome.data, payload) : null;
  if (!data) { source = 'canned'; data = canned(kind, payload); }

  if (kind === 'rival_post' && payload.counts) {
    const note = (data as AiResults['rival_post']).note;
    const saved = await recordRival(deps.dataApi, token, payload.rival, payload.result === 'won', note);
    if (!saved) log(JSON.stringify({ ai: true, kind, warning: 'rival_record failed' }));
  }
  return json(200, { ok: true, kind, source, data, remaining: Math.max(0, c.limit - c.used) } as AiReply);
}

async function run(kind: AiKind, p: Record<string, any>, c: Claim, today: string, model: string, runner: ClaudeRunner): Promise<ClaudeOutcome<unknown>> {
  switch (kind) {
    case 'coach_plan': return runner({ model, system: COACH_SYSTEM, user: planUser(p as never, c, today), schema: S.PlanOut });
    case 'coach_tip': return runner({ model, system: COACH_SYSTEM, user: tipUser(p as never, c, today), schema: S.TipOut });
    case 'coach_debrief': return runner({ model, system: COACH_SYSTEM, user: debriefUser(p as never, c, today), schema: S.DebriefOut });
    case 'rival_pre': return runner({ model, system: RIVAL_SYSTEM, user: rivalPreUser(p as never, c, today), schema: S.RivalPreOut });
    case 'rival_post': return runner({ model, system: RIVAL_SYSTEM, user: rivalPostUser(p as never, c, today), schema: S.RivalPostOut });
  }
}

function finish(kind: AiKind, raw: unknown, p: Record<string, any>): AiResults[AiKind] | null {
  switch (kind) {
    case 'coach_plan': return sanitizePlan(raw, p.workout ? null : p.stage.lengthM);
    case 'coach_tip': return sanitizeTip(raw);
    case 'coach_debrief': return sanitizeDebrief(raw);
    case 'rival_pre': return sanitizeRivalLines(raw, p.rival);
    case 'rival_post': return sanitizeRivalPost(raw);
  }
}

function canned(kind: AiKind, p: Record<string, any>): AiResults[AiKind] {
  switch (kind) {
    case 'coach_plan': return cannedPlan(p as never);
    case 'coach_tip': return { text: cannedTip(p.moment) };
    case 'coach_debrief': return cannedDebrief(p as never);
    case 'rival_pre': return { lines: cannedRivalLines(p.rival) };
    case 'rival_post': return cannedRivalPost(p as never);
  }
}

