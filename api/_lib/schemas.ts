// Request validation (what the browser may send) and the JSON shapes Claude
// must answer with. Strings that end up in a prompt are cut down to plain
// letters, digits and light punctuation: a route name from an uploaded GPX
// file can't carry instructions into the prompt.

import { z } from 'zod';
import { AI_KINDS, COACH_MOMENTS, RIVAL_MOMENTS, RIVAL_TRIGGERS } from '../../src/ai/types.js';
import { RIVAL_IDS } from '../../src/ai/rivals.js';
import { SUGGESTION_IDS } from '../../src/ai/catalogue.js';

const safeText = (max: number) =>
  z.string().max(400).transform((s) => s.replace(/[^\p{L}\p{N} .,'’&()·:\-–/%]/gu, '').replace(/\s+/g, ' ').trim().slice(0, max));
const n = (min: number, max: number) => z.number().min(min).max(max);

export const Envelope = z.object({ kind: z.enum(AI_KINDS), payload: z.unknown() });

const Stage = z.object({
  id: safeText(60),
  name: safeText(80),
  lengthM: n(0, 1e6).nullable(),
  totalClimbM: n(0, 20000),
  climbs: z.array(z.object({ startM: n(0, 1e6), endM: n(0, 1e6), avgPct: n(0, 40), gainM: n(0, 5000) })).max(12),
  sprints: z.array(z.object({ atM: n(0, 1e6), name: safeText(40) })).max(6),
  koms: z.array(z.object({ atM: n(0, 1e6), name: safeText(40) })).max(6),
});

export const PlanPayload = z.object({
  stage: Stage,
  mode: z.enum(['ride', 'race', 'workout']),
  workout: z.object({
    name: safeText(60),
    minutes: n(0, 600),
    steps: z.array(z.object({ atS: n(0, 40000), durS: n(0, 40000), label: safeText(30), pctFtp: n(0, 4).nullable() })).max(40),
  }).nullable(),
});

export const TipPayload = z.object({
  moment: z.enum(COACH_MOMENTS),
  stageName: safeText(80),
  gradePct: n(-30, 40),
  watts: n(0, 3000),
  targetW: n(0, 3000).nullable(),
  cadence: n(0, 250),
  hr: n(0, 250),
  hrDriftPct: n(-50, 100).nullable(),
  gapM: n(0, 1000).nullable(),
  seconds: n(0, 100000),
});

export const DebriefPayload = z.object({
  title: safeText(80),
  mode: z.enum(['ride', 'race', 'workout']),
  durationS: n(0, 200000),
  distanceKm: n(0, 3000),
  climbedM: n(0, 20000),
  avgW: n(0, 3000),
  npW: n(0, 3000),
  powerZoneS: z.array(n(0, 200000)).length(6),
  hrZoneS: z.array(n(0, 200000)).length(5),
  avgHr: n(0, 250).nullable(),
  maxHr: n(0, 250).nullable(),
  avgCadence: n(0, 250).nullable(),
  tss: n(0, 2000).nullable(),
  workout: z.object({ name: safeText(60), compliancePct: n(0, 300).nullable() }).nullable(),
  race: z.object({ place: n(1, 500), of: n(1, 500) }).nullable(),
  plan: z.object({ name: safeText(60), done: n(0, 1000), total: n(0, 1000) }).nullable(),
});

const RivalId = z.enum(RIVAL_IDS as [string, ...string[]]);
export const RivalPrePayload = z.object({ rival: RivalId, stage: Stage, mode: z.enum(['ride', 'race']) });
export const RivalPostPayload = z.object({
  rival: RivalId,
  result: z.enum(['won', 'lost']),
  gapS: n(0, 100000),
  stageName: safeText(80),
  lengthKm: n(0, 3000).nullable(),
  moments: z.array(z.enum(RIVAL_MOMENTS)).max(6),
  counts: z.boolean(),
});

export const PAYLOADS = {
  coach_plan: PlanPayload,
  coach_tip: TipPayload,
  coach_debrief: DebriefPayload,
  rival_pre: RivalPrePayload,
  rival_post: RivalPostPayload,
} as const;

// What Claude answers with. Deliberately loose (no length limits): the replies
// are trimmed afterwards by src/ai/sanitize.ts, so a long line never fails a call.
export const PlanOut = z.object({ tips: z.array(z.object({ at_m: z.number().nullable(), at_s: z.number().nullable(), text: z.string() })) });
export const TipOut = z.object({ text: z.string() });
export const DebriefOut = z.object({
  headline: z.string(),
  summary: z.string(),
  went_well: z.array(z.string()),
  work_on: z.array(z.string()),
  next: z.object({ id: z.enum(SUGGESTION_IDS), why: z.string() }),
});
export const RivalPreOut = z.object({
  lines: z.object(Object.fromEntries(RIVAL_TRIGGERS.map((t) => [t, z.array(z.string())])) as Record<(typeof RIVAL_TRIGGERS)[number], z.ZodArray<z.ZodString>>),
});
export const RivalPostOut = z.object({ line: z.string(), note: z.string() });
