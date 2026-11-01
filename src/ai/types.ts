// The shapes shared by the browser and the Vercel function (api/ai.ts):
// what the browser sends for each kind of AI request, and what comes back.
// Pure types and constants: no DOM, no Three.js, no SDK, so both sides can import it.

export const AI_KINDS = ['coach_debrief', 'coach_plan', 'coach_tip', 'rival_pre', 'rival_post'] as const;
export type AiKind = (typeof AI_KINDS)[number];

/** The reactive moments the browser spots while you ride (src/ai/moments.ts). */
export const COACH_MOMENTS = ['low_cadence_climb', 'hr_drift', 'over_target', 'no_draft'] as const;
export type CoachMoment = (typeof COACH_MOMENTS)[number];

/** The moments a rival can react to (src/ai/rivalTriggers.ts). */
export const RIVAL_TRIGGERS = ['start', 'you_pass', 'they_attack', 'they_drop_you', 'you_drop_them', 'last_km', 'they_win', 'you_win'] as const;
export type RivalTrigger = (typeof RIVAL_TRIGGERS)[number];

/** What happened between you and a rival, for the memory note after a ride. */
export const RIVAL_MOMENTS = ['cracked_on_climb', 'won_sprint', 'lost_sprint', 'dropped_rival', 'was_dropped', 'stayed_close', 'solo_win', 'solo_loss'] as const;
export type RivalMoment = (typeof RIVAL_MOMENTS)[number];

// ------------------------------------------------------------- payloads ----

export interface StageBrief {
  id: string;
  name: string;
  /** Metres to the finish line, or null for an endless road. */
  lengthM: number | null;
  totalClimbM: number;
  climbs: { startM: number; endM: number; avgPct: number; gainM: number }[];
  sprints: { atM: number; name: string }[];
  koms: { atM: number; name: string }[];
}

export interface PlanPayload {
  stage: StageBrief;
  mode: 'ride' | 'race' | 'workout';
  workout: null | {
    name: string;
    minutes: number;
    steps: { atS: number; durS: number; label: string; pctFtp: number | null }[];
  };
}

export interface TipPayload {
  moment: CoachMoment;
  stageName: string;
  gradePct: number;
  watts: number;
  targetW: number | null;
  cadence: number;
  hr: number;
  hrDriftPct: number | null;
  gapM: number | null;
  seconds: number;
}

export interface DebriefPayload {
  title: string;
  mode: 'ride' | 'race' | 'workout';
  durationS: number;
  distanceKm: number;
  climbedM: number;
  avgW: number;
  npW: number;
  /** Seconds in each of the six power zones, and each of the five heart-rate zones. */
  powerZoneS: number[];
  hrZoneS: number[];
  avgHr: number | null;
  maxHr: number | null;
  avgCadence: number | null;
  tss: number | null;
  workout: null | { name: string; compliancePct: number | null };
  race: null | { place: number; of: number };
  plan: null | { name: string; done: number; total: number };
}

export interface RivalPrePayload {
  rival: string;
  stage: StageBrief;
  mode: 'ride' | 'race';
}

export interface RivalPostPayload {
  rival: string;
  result: 'won' | 'lost';
  /** Seconds between you and the rival at the end (always positive). */
  gapS: number;
  stageName: string;
  lengthKm: number | null;
  moments: RivalMoment[];
  /** False for demo and sped-up rides: they get a closing line but aren't added to the record. */
  counts: boolean;
}

export type AiPayloads = {
  coach_plan: PlanPayload;
  coach_tip: TipPayload;
  coach_debrief: DebriefPayload;
  rival_pre: RivalPrePayload;
  rival_post: RivalPostPayload;
};

// ------------------------------------------------------------- results ----

export interface CoachTip { at_m: number | null; at_s: number | null; text: string }
export interface PlanResult { tips: CoachTip[] }
export interface TipResult { text: string }
export interface DebriefResult {
  headline: string;
  summary: string;
  went_well: string[];
  work_on: string[];
  next: { id: string; why: string };
}
export type RivalLines = Record<RivalTrigger, string[]>;
export interface RivalPreResult { lines: RivalLines }
export interface RivalPostResult { line: string; note: string }

export type AiResults = {
  coach_plan: PlanResult;
  coach_tip: TipResult;
  coach_debrief: DebriefResult;
  rival_pre: RivalPreResult;
  rival_post: RivalPostResult;
};

/** The function's reply. `source` says whether Claude wrote it or the canned text was used (refusal). */
export interface AiReply<K extends AiKind = AiKind> {
  ok: true;
  kind: K;
  source: 'claude' | 'canned';
  data: AiResults[K];
}

export interface AiError {
  ok: false;
  error: 'sign_in' | 'no_consent' | 'banned' | 'quota' | 'bad_request' | 'unavailable' | 'not_configured';
  message: string;
}
