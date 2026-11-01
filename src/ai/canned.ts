// Plain-text fallbacks for every AI feature, used when the rider has the AI
// off, is offline or over quota, or when Claude declines. The ride never
// waits on the AI, and these keep it friendly. Also used by the Vercel
// function when the whole model chain refuses. Pure.

import { cleanLine } from './text.js';
import { rivalById, RIVALS } from './rivals.js';
import {
  RIVAL_TRIGGERS,
  type CoachMoment, type CoachTip, type DebriefPayload, type DebriefResult, type PlanPayload, type PlanResult,
  type RivalLines, type RivalPostPayload, type RivalPostResult, type RivalTrigger,
} from './types.js';

export const CANNED_TIPS: Record<CoachMoment, string[]> = {
  low_cadence_climb: ['Spin it up a little. Lighter gear, quicker legs.', 'Cadence is low. Shift easier and keep the pedals turning.'],
  hr_drift: ['Heart rate is creeping up at the same power. Sip some water and ease a touch.', 'Your heart rate is drifting. Fuel up and keep it smooth.'],
  over_target: ['A bit over target. Ease back and let the trainer set the pace.', 'You are above the target power. Settle in.'],
  no_draft: ['Slide in right behind the rider ahead to save energy.', 'Tuck onto that wheel. Free speed is waiting.'],
};

export function cannedTip(moment: CoachMoment, rand: () => number = Math.random): string {
  const list = CANNED_TIPS[moment];
  return list[Math.floor(rand() * list.length) % list.length];
}

const km = (m: number) => (m / 1000).toFixed(m >= 10000 ? 0 : 1);

/** A plan built from the stage's features alone: no model needed. */
export function cannedPlan(p: PlanPayload): PlanResult {
  const tips: CoachTip[] = [];
  if (p.workout) {
    tips.push({ at_m: null, at_s: 5, text: 'Easy warm-up first. Smooth pedalling, loose shoulders.' });
    const hard = p.workout.steps.filter((s) => (s.pctFtp ?? 0) >= 0.85 && s.durS >= 60).slice(0, 5);
    for (const s of hard) tips.push({ at_m: null, at_s: Math.max(5, s.atS - 10), text: `${s.label}: hold the target and breathe steadily.` });
  } else {
    tips.push({ at_m: 100, at_s: null, text: 'Settle in and find an easy rhythm.' });
    for (const c of p.stage.climbs.slice(0, 4)) {
      tips.push({ at_m: Math.max(0, c.startM - 300), at_s: null, text: `Climb ahead, ${km(c.endM - c.startM)} km at ${c.avgPct.toFixed(0)}%. Stay seated and steady.` });
    }
    for (const s of p.stage.sprints.slice(0, 2)) tips.push({ at_m: Math.max(0, s.atM - 400), at_s: null, text: `${s.name} sprint soon. Pick your moment.` });
    for (const k of p.stage.koms.slice(0, 1)) tips.push({ at_m: Math.max(0, k.atM - 400), at_s: null, text: `${k.name} summit points ahead. Dig in!` });
    if (p.stage.lengthM) tips.push({ at_m: Math.max(0, p.stage.lengthM - 1000), at_s: null, text: 'Last kilometre. Empty the tank.' });
  }
  const sorted = tips.sort((a, b) => (a.at_m ?? a.at_s ?? 0) - (b.at_m ?? b.at_s ?? 0)).slice(0, 8);
  return { tips: sorted.map((t) => ({ ...t, text: cleanLine(t.text, 18) })) };
}

export function cannedDebrief(p: DebriefPayload): DebriefResult {
  const mins = Math.round(p.durationS / 60);
  const next = p.workout
    ? (p.tss ?? 0) > 80 ? 'builtin-recovery-30' : 'builtin-sweet-spot-3x10'
    : p.durationS < 1800 ? 'builtin-endurance-45'
    : p.climbedM > 400 ? 'builtin-threshold-2x15'
    : 'builtin-endurance-75';
  const nextWhy = next === 'builtin-recovery-30' ? 'An easy spin helps you absorb a hard day.'
    : next === 'builtin-sweet-spot-3x10' ? 'Steady work just under threshold builds strength.'
    : next === 'builtin-endurance-45' ? 'A bit longer in the saddle builds your base.'
    : next === 'builtin-threshold-2x15' ? 'You handled the hills. Threshold work builds on that.'
    : 'More steady miles keep the engine growing.';
  return {
    headline: p.race ? `Race done: ${p.race.place} of ${p.race.of}` : 'Nice ride, well done',
    summary: `${mins} minutes, ${p.distanceKm.toFixed(1)} km, ${p.climbedM} m climbed, averaging ${p.avgW} watts. Solid work. Turn up again soon and keep it steady.`,
    went_well: ['You showed up and turned the pedals.', p.avgHr ? 'Your effort stayed under control.' : 'Your power was steady.'],
    work_on: ['Drink a little more on longer rides.', 'Keep your cadence smooth on the climbs.'],
    next: { id: next, why: nextWhy },
  };
}

export function cannedRivalLines(rivalId: string): RivalLines {
  const r = rivalById(rivalId) ?? RIVALS[0];
  return Object.fromEntries(RIVAL_TRIGGERS.map((t) => [t, [...r.canned[t]]])) as RivalLines;
}

export function cannedRivalLine(rivalId: string, trigger: RivalTrigger, rand: () => number = Math.random): string {
  const list = (rivalById(rivalId) ?? RIVALS[0]).canned[trigger];
  return list[Math.floor(rand() * list.length) % list.length];
}

export function cannedRivalPost(p: RivalPostPayload, rand: () => number = Math.random): RivalPostResult {
  const r = rivalById(p.rival) ?? RIVALS[0];
  const list = p.result === 'won' ? r.closing.won : r.closing.lost;
  const gap = p.gapS >= 1 ? ` by ${Math.round(p.gapS)} s` : '';
  const note = p.result === 'won' ? `You beat me${gap} on ${p.stageName}.` : `I beat you${gap} on ${p.stageName}.`;
  return { line: list[Math.floor(rand() * list.length) % list.length], note: cleanLine(note, 24, 140) };
}
