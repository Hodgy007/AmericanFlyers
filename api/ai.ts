// Vercel function: POST /api/ai (see _lib/handler.ts for what it does).
// Environment: ANTHROPIC_API_KEY (required for the coach and rivals), AI_MODEL (optional, default
// claude-opus-5-5; claude-haiku-5-5 is a much cheaper choice), and optionally VITE_NEON_DATA_API_URL if the
// Data API isn't the default one. The Climb guide calls Perplexity Sonar through the Vercel AI Gateway: it
// needs no secret on Vercel (the function's OIDC token is used); AI_GATEWAY_API_KEY overrides it, and
// CLIMB_GUIDE_MODEL (optional, default perplexity/sonar) picks another gateway model.

import { handleAi } from './_lib/handler.js';
import { makeClient, makeRunner } from './_lib/claude.js';
import { makeRunner as makeClimbRunner, pickModel, pickToken } from './_lib/perplexity.js';
import { DEFAULT_DATA_API_URL } from './_lib/rider.js';

export default {
  async fetch(request: Request): Promise<Response> {
    const key = process.env.ANTHROPIC_API_KEY;
    const gatewayToken = pickToken(process.env, request.headers);
    return handleAi(request, {
      runner: key ? makeRunner(makeClient(key)) : null,
      model: process.env.AI_MODEL,
      perplexity: gatewayToken ? makeClimbRunner(gatewayToken) : null,
      climbModel: pickModel(process.env.CLIMB_GUIDE_MODEL),
      dataApi: { url: process.env.VITE_NEON_DATA_API_URL || process.env.NEON_DATA_API_URL || DEFAULT_DATA_API_URL, fetch },
      log: (line) => console.log(line), // Vercel runtime logs: one JSON line per call with the token counts
    });
  },
};
