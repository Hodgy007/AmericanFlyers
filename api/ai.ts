// Vercel function: POST /api/ai (see _lib/handler.ts for what it does).
// Environment: ANTHROPIC_API_KEY (required for the coach and rivals), AI_MODEL (optional, default
// claude-opus-5-5; claude-haiku-5-5 is a much cheaper choice), PERPLEXITY_API_KEY (required for the
// Climb guide, which answers from web search), PERPLEXITY_EFFORT (optional, default "low"), and
// optionally VITE_NEON_DATA_API_URL if the Data API isn't the default one.

import { handleAi } from './_lib/handler.js';
import { makeClient, makeRunner } from './_lib/claude.js';
import { makeClient as makePerplexityClient, makeRunner as makePerplexityRunner, pickEffort } from './_lib/perplexity.js';
import { DEFAULT_DATA_API_URL } from './_lib/rider.js';

export default {
  async fetch(request: Request): Promise<Response> {
    const key = process.env.ANTHROPIC_API_KEY;
    const pplx = process.env.PERPLEXITY_API_KEY;
    return handleAi(request, {
      runner: key ? makeRunner(makeClient(key)) : null,
      model: process.env.AI_MODEL,
      perplexity: pplx ? makePerplexityRunner(makePerplexityClient(pplx)) : null,
      effort: pickEffort(process.env.PERPLEXITY_EFFORT),
      dataApi: { url: process.env.VITE_NEON_DATA_API_URL || process.env.NEON_DATA_API_URL || DEFAULT_DATA_API_URL, fetch },
      log: (line) => console.log(line), // Vercel runtime logs: one JSON line per call with the token counts
    });
  },
};
