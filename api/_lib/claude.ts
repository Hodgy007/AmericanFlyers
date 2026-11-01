// One place that talks to Claude. Decisions (see the round-4 plan):
//  - model: claude-opus-5-5 unless AI_MODEL says otherwise (claude-haiku-5-5 is much cheaper);
//  - output_config.effort "low": the outputs are a sentence or a short JSON object;
//  - no `thinking` and no `temperature` (Opus 5.5 always thinks; sampling knobs are not for this model);
//  - structured JSON through output_config.format built from a zod schema, parsed with beta.messages.parse;
//  - refusal fallback: the server-side `fallbacks: "default"` (beta header server-side-fallback-2026-07-01),
//    and stop_reason "refusal" is checked before any content is read;
//  - prompt caching: the frozen system prompt carries cache_control, everything per ride is in the user message.

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';

export const DEFAULT_MODEL = 'claude-opus-5-5';
export const MAX_TOKENS = 2000; // replies are short, but thinking tokens count too
export const CALL_TIMEOUT_MS = 20_000;
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export interface ClaudeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export type ClaudeOutcome<T> =
  | { status: 'ok'; data: T; usage: ClaudeUsage; model: string }
  | { status: 'refused'; usage: ClaudeUsage; model: string }
  | { status: 'unusable'; usage: ClaudeUsage; model: string };

export interface ClaudeRequest<T> {
  model: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
}

export type ClaudeRunner = <T>(req: ClaudeRequest<T>) => Promise<ClaudeOutcome<T>>;

export function makeClient(apiKey: string) {
  // One retry on top of the 20 s timeout keeps the worst case well inside the function's time limit.
  return new Anthropic({ apiKey, timeout: CALL_TIMEOUT_MS, maxRetries: 1 });
}

export function makeRunner(client: Anthropic): ClaudeRunner {
  return async <T>(req: ClaudeRequest<T>): Promise<ClaudeOutcome<T>> => {
    let message;
    try {
      message = await client.beta.messages.parse({
      model: req.model,
      max_tokens: MAX_TOKENS,
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      output_config: { effort: 'low', format: zodOutputFormat(req.schema) },
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: req.user }],
      });
    } catch (e) {
      // A reply that isn't valid JSON (e.g. cut off) throws a plain AnthropicError; API and network errors are APIErrors and go up.
      if (e instanceof Anthropic.AnthropicError && !(e instanceof Anthropic.APIError)) {
        return { status: 'unusable', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, model: req.model };
      }
      throw e;
    }
    const u = message.usage;
    const usage: ClaudeUsage = {
      input_tokens: u?.input_tokens ?? 0,
      output_tokens: u?.output_tokens ?? 0,
      cache_read_input_tokens: u?.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: u?.cache_creation_input_tokens ?? 0,
    };
    const model = message.model ?? req.model;
    // Refusal first: if the whole fallback chain declined there is nothing to read.
    if (message.stop_reason === 'refusal') return { status: 'refused', usage, model };
    const data = message.parsed_output; // can be null (cut off at max_tokens, or not valid JSON)
    if (data === null || data === undefined) return { status: 'unusable', usage, model };
    return { status: 'ok', data: data as T, usage, model };
  };
}

/** True for the SDK's errors (rate limit, overloaded, timeout, connection...). */
export function isAnthropicError(e: unknown): boolean {
  return e instanceof Anthropic.APIError || e instanceof Anthropic.AnthropicError;
}
