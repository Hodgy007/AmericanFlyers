# AI coach and rivals

Two opt-in features that call Claude through one Vercel function: **Coach Marty** (ride tips, reactive tips and a post-ride debrief) and four **AI rivals** (a bot that rides with you, speaks, and remembers). The browser never holds the Anthropic key and the ride never waits on the AI.

## Pieces

| Part | Where | What |
| --- | --- | --- |
| The function | `api/ai.ts`, `api/_lib/*` | `POST /api/ai`, `{ kind, payload }` with `Authorization: Bearer <Neon JWT>`. Kinds: `coach_plan`, `coach_tip`, `coach_debrief`, `rival_pre`, `rival_post`. |
| Gate and quota | `db/schema.sql` (`ai_claim`) | The database decides: signed in, opted in, not banned, under today's quota. |
| Shared pure code | `src/ai/types.ts`, `rivals.ts`, `canned.ts`, `sanitize.ts`, `catalogue.ts`, `text.ts` | Imported by both the browser and the function (no DOM). |
| Ride logic | `src/ai/moments.ts`, `coachPlan.ts`, `rivalBot.ts`, `rivalTriggers.ts`, `story.ts`, `summary.ts`, `brief.ts` | Pure, unit-tested. |
| Controller and UI | `src/ai/aiRide.ts`, `coachUi.ts`, `rivalsUi.ts`, `consentUi.ts`, `speech.ts` | One `AiRide` per page, built by `ai/create.ts` and loaded on demand (see [Lazy loading](architecture.md#lazy-loading)); `main.ts` calls `frame()` and a few hooks as `ai?.…`, which do nothing until it has loaded. |
| Browser calls | `src/cloud/aiApi.ts`, `src/cloud/token.ts` | `askAi()`, consent, rival memory, saved debriefs. `dataApiToken()` returns the Data API JWT. |

## How a request is authenticated

1. The browser gets the rider's Neon JWT with `dataApiToken()` (`neon.auth.getSession()`; Neon's auth adapter replaces the session token with the JWT from the `set-auth-jwt` header, which is the same token the Data API client sends) and posts it to `/api/ai`.
2. `api/_lib/handler.ts` checks the shape of the header, the body size (24 kB) and validates the payload with zod (`schemas.ts`). Strings that reach a prompt are cut down to letters, digits and light punctuation.
3. It calls the Data API function `ai_claim(p_kind, p_rival)` **with the rider's own token**. The Data API verifies the JWT (an invalid, expired or anonymous token gets 401/403, which becomes our **401**). `ai_claim` returns `no_consent` (**403**), `banned` (**403**) or `quota` (**429**, friendly message), or the facts for the prompt: first name (letters only, never an email), FTP, weight, last four weeks, and for rivals the rival's memory.
4. Only then does it call Claude. No shared secret decides who the rider is.

For `rival_post` on a ride that counts, the function then calls `rival_record(p_rival, p_won, p_note)` with the same token (the note is trimmed to 140 characters, the notes list to 8).

## Claude settings (api/_lib/claude.ts)

- Model `claude-opus-5-5`, or `AI_MODEL` (for example `claude-haiku-5-5`, much cheaper).
- `output_config: { effort: "low" }`. Thinking is always on for Opus 5.5, so `thinking` is never sent (`disabled` would be a 400); no `temperature`. `max_tokens` 2000.
- Structured output: `output_config.format = zodOutputFormat(schema)` with `client.beta.messages.parse`. `parsed_output` can be null, so it is guarded; replies are then trimmed by `src/ai/sanitize.ts` (word limits, the next-session id must be a real one).
- Refusal fallback: `betas: ['server-side-fallback-2026-07-01']`, `fallbacks: 'default'`, and `stop_reason === 'refusal'` is checked before any content is read. If the whole chain refuses, or the reply is unusable, the function answers with the canned text (`source: "canned"`).
- Prompt caching: the system prompt is frozen per feature (persona, rules, schema notes, the list of suggestible sessions) with `cache_control: { type: 'ephemeral' }`. Everything per ride (numbers, memory, today's date) is in the user message. The system prompts are about 1,200 (coach) and 1,050 (rivals) tokens, which may be under the model's minimum cacheable prefix, in which case no cache is written (they are not padded). Each call logs one JSON line: `kind`, `model`, `outcome`, `ms`, `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`. No ids, names or tokens.
- Errors: SDK errors become **503** "busy"; a 20 s timeout with one retry; the client then uses canned text.

## Tokens per call (estimate)

| Kind | Input | Output (incl. low-effort thinking) |
| --- | --- | --- |
| `coach_tip` | about 1,300 (system about 1,100, user about 200) | about 150 to 400 |
| `coach_plan` | about 1,500 | about 400 to 900 |
| `coach_debrief` | about 1,600 | about 400 to 900 |
| `rival_pre` | about 1,400 (system about 1,050 with the four persona sheets) | about 500 to 1,000 |
| `rival_post` | about 1,300 | about 100 to 300 |

A typical opted-in ride: 1 plan, up to a couple of tips, 1 debrief, and with a rival 1 pre plus 1 post, so roughly 8,000 to 10,000 input and 2,000 to 4,000 output tokens (about 5 calls). Check the logged counts in Vercel and the Anthropic console for real numbers.

## Climb guide (`coach_climb`)

A web-grounded answer for a built-in stage on a real road, on the hub's route cards.

- **Request.** `{ kind: 'coach_climb', payload: { stageId, topic } }`. `stageId` is an enum of `CLIMB_IDS` and `topic` one of `history | records | conditions | visit` (`src/ai/climbs.ts`); the schema is `.strict()`, so the body can't carry a name or a question. The server builds the question itself (`api/_lib/prompts/climb.ts`) from the table's place, region, start, length and climbing, so the prompt only contains our own data. A unit test keeps the table's lengths and climbing in step with `src/stages.ts` (the table doesn't import it: it is heavy and shared with the function).
- **Gate.** The same `ai_claim()` as the other kinds. The `coach` prefix means it uses the AI coach opt-in; the limit is 8 a day.
- **Provider.** `api/_lib/perplexity.ts` POSTs a Chat Completions request to `https://ai-gateway.vercel.sh/v1/chat/completions` with `model` (`perplexity/sonar`, or `CLIMB_GUIDE_MODEL`), a system and a user message, and `max_tokens: 900`, using plain `fetch` with a 25 s timeout and no retries. The Bearer token is `AI_GATEWAY_API_KEY`, else `VERCEL_OIDC_TOKEN`, else the request's `x-vercel-oidc-token` header (`pickToken`); none means `503 not_configured` before the database is touched. The runner is injected into `handleAi` as `perplexity`, like the Claude one.
- **Reading the answer.** Text from `choices[0].message.content` (a JSON object `{summary, facts[]}` as asked, or plain text split into a paragraph and bullets). Sources, in the order the `[n]` markers count from, come from top-level `citations` (urls) with titles from `search_results`, else `search_results`, else `message.annotations` (`url_citation`); `parseGatewayResponse` also looks inside `provider_metadata`. `buildClimbRaw` keeps https sources only, dedupes by URL, caps at five, puts the cited ones first and renumbers the markers (markers with no source are dropped). `sanitizeClimbGuide` (`src/ai/sanitize.ts`) then strips markdown and HTML, caps lengths and checks the sources again; the browser runs it once more.
- **Errors.** 401/403 from the gateway: logged, `503 unavailable`, no details sent to the rider. 429: `503 unavailable`, `retryAfter` logged. Timeout: `504 unavailable`. Anything else: `503 unavailable`. An answer with nothing usable is `200` with `source: 'canned'` and the canned line (the stage's length, climbing and average grade plus "Live climb guide unavailable right now."). A call counts against the quota once the gate passes, even if the provider then fails.
- **Log.** One JSON line: `provider: 'perplexity-gateway'`, `model`, `outcome`, `sources` (where the sources were: `citations`, `search_results`, `annotations` or `none`, to confirm the real shape on a deployment), `n_sources`, `ms`, and the token counts and `cost_usd` if present. The token and the prompt are never logged.
- **Client.** `src/hub/climbGuide.ts` (loaded on the first click of 🧭 Climb guide) shows the four chips, a loading state, the answer with numbered `target=_blank rel="noopener noreferrer"` source links and the "AI-generated from web sources, may be wrong" note. Signed out: the sign-in prompt. AI coach off: an opt-in button (`set_ai_consent`) and a link to Settings. `src/ai/climbCache.ts` keeps answers in `localStorage` for 24 h per stage and topic (every access in try/catch; entries are sanitized again when read). `scripts/climb-guide-smoke.sh` makes one real gateway call and prints only the response's shape (`AI_GATEWAY_API_KEY`, or `VERCEL_OIDC_TOKEN` from `vercel env pull`).
- **Tests.** `tests/unit/climbGuide.test.ts` (request building, two recorded gateway response shapes in `tests/unit/fixtures/`, sources, sanitizer, canned line, payload validation, handler routing with a fake runner, the fetch runner), `tests/unit/climbCache.test.ts`, `tests/e2e/climbGuide.spec.ts`.

To apply the database change to an existing database, run `db/schema.sql` (safe to re-run) or:

```sql
alter table public.ai_usage drop constraint if exists ai_usage_kind_check;
alter table public.ai_usage add constraint ai_usage_kind_check check (kind in ('coach_debrief', 'coach_plan', 'coach_tip', 'coach_climb', 'rival_pre', 'rival_post'));
-- then re-create public.ai_claim_for(text, text, text) from db/schema.sql (it now accepts 'coach_climb' with a limit of 8)
```

## Database

Tables `ai_consent`, `ai_usage`, `rival_memory`, `coach_notes` (row-level security, no grants) and the functions in [Database schema](../reference/database-schema.md#ai-coach-and-rivals). Every public function is a one-line wrapper over an internal `*_for(me, ...)` version, so the logic can be tested with a made-up rider. All four tables have a text `user_id`, so `delete_my_account()` and `my_data_extras()` cover them without changes.

Quotas per UTC day (admins unlimited): `coach_debrief` 10, `coach_plan` 6, `coach_tip` 30, `coach_climb` 8, `rival_pre` 10, `rival_post` 10. A call counts when the gate passes, even if Claude then fails.

## In the app

- **Coach**: `AiRide.frame()` asks for the plan once, 5 s into a ride (`coachPlan.ts` hands out tips by distance or workout seconds, skipping ones you jumped past); `moments.ts` finds the four reactive moments with a 5-minute global gap and 10 minutes per kind; tips show in `#coach-bubble`. The debrief card is built synchronously for the summary (`debriefCard`) and filled in, or replaced with the canned debrief, when the reply arrives. After the ride is saved the debrief is kept with it (`save_coach_debrief`) and shows in the profile.
- **Rivals**: `rivalBot.ts` is a bot that uses `stepSpeed` at about your rolling average power times the rival's strength (0.97 to 1.03) with rubber-banding, plus a style: sprinter (last 300 m), climber (over 6%), wheel-sucker (sits behind you, attacks when your 10 s power falls under 65% of your 2-minute average), diesel (steady). It appears as an `OtherRider` (`speech` draws a bubble sprite in `world/others.ts`). `rivalTriggers.ts` turns the race state into the eight trigger keys; at most one line every 15 s, the finish always. Demo and `?timescale` rides send `counts: false`.

## Deploying and configuring

1. Vercel project env var **`ANTHROPIC_API_KEY`** (already set). Optional **`AI_MODEL`**; optional `VITE_NEON_DATA_API_URL` if the Data API URL is not the default.
2. `vercel.json` raises the function's `maxDuration` to 40 s.
3. `npm run build` also type-checks `api/` (`tsc -p api`).
4. Check: `curl -i -X POST https://<site>/api/ai` answers **401** without a token. Without `ANTHROPIC_API_KEY` a signed-in, opted-in request gets **503** `not_configured`.
5. The Climb guide needs no new secret on Vercel (the function's OIDC token reaches the AI Gateway); optional `AI_GATEWAY_API_KEY` and `CLIMB_GUIDE_MODEL` (see the table in the admin guide).
6. To turn the AI off for everyone, remove `ANTHROPIC_API_KEY` (riders get the built-in tips and lines).

## Testing

`tests/unit/aiLogic.test.ts` (moments, plan runner, triggers, bot, sanitizers, canned text), `tests/unit/aiApi.test.ts` (the handler with the Anthropic client and the Data API injected: auth, consent, quota, refusal, errors, prompts, request parameters), `tests/e2e/ai.spec.ts` (Playwright with `/api/ai` and Neon mocked; set `E2E_SHOTS=<dir>` to save screenshots). The real Anthropic API is never called from tests.
