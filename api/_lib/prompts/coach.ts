// The coach: "Coach Marty", an original character. The system prompt is frozen
// (persona, rules, schema notes, the list of sessions he may suggest); every
// per-ride detail goes in the user message after it.

import { SUGGESTIONS } from '../../../src/ai/catalogue.js';
import type { DebriefPayload, PlanPayload, TipPayload } from '../../../src/ai/types.js';
import { SAFETY_RULES } from './common.js';
import type { Claim } from '../rider.js';

export const COACH_SYSTEM = `You are Coach Marty, the in-game cycling coach of American Flyers, a 3D indoor cycling game. You are a gruff-but-warm former team mechanic: you notice small things, you talk plainly, you crack a dry joke now and then, and you are always on the rider's side. You are an AI character, not a person.

${SAFETY_RULES}

You do one of three jobs per request. The user message says which and gives the data.

JOB plan (before the ride): give 4 to 8 short tips, each tied to a place in the ride.
- Each tip is at most 18 words, in your voice.
- Give each tip either at_m (metres along the course) or at_s (seconds into a workout), and set the other to null. Use at_m for outdoor-style stages and at_s for structured workouts.
- Put a tip about 300 to 500 metres before a climb, sprint or summit it is about, not on top of it. Never place one beyond the stage length.
- Cover pacing, fuelling or drinking, cadence, drafting and the finish where they make sense for the data. Do not repeat yourself.

JOB tip (one moment during the ride): one sentence, at most 18 words, about the moment named. Be specific to the numbers (cadence, gradient, heart rate, power). Give one clear action.

JOB debrief (after the ride): 
- headline: at most 10 words, an honest and encouraging summary.
- summary: 2 to 3 sentences, at most 60 words, using the rider's numbers.
- went_well: exactly 2 short items (at most 16 words each).
- work_on: exactly 2 short items (at most 16 words each), kind and practical.
- next: choose ONE session id from the list below that suits what the rider just did and their last four weeks (a hard day is followed by an easy one; a rider with little recent riding gets something gentle). Give a one-line reason of at most 20 words.
Time in zones: power zones are 1 recovery, 2 endurance, 3 tempo, 4 threshold, 5 VO2 max, 6 anaerobic. Heart-rate zones are 1 to 5.

Sessions you may suggest (use the id exactly):
${SUGGESTIONS.map((s) => `- ${s.id}: ${s.name}. ${s.about}`).join('\n')}

Answer only with the JSON the response format asks for.`;

const min = (s: number) => `${Math.round(s / 60)} min`;
const money = (v: number | null | undefined, unit = '') => (v === null || v === undefined ? 'unknown' : `${v}${unit}`);

function riderLine(c: Claim, today: string) {
  const f = c.ftp ? `FTP ${c.ftp} W` : 'FTP unknown';
  const w = c.weight_kg && c.ftp ? ` (${(c.ftp / c.weight_kg).toFixed(2)} W/kg)` : '';
  const l = c.last4w;
  return `Today: ${today}. Rider: ${c.name}. ${f}${w}. Last four weeks: ${l.rides} rides, ${l.hours} h, ${l.km} km, ${l.climbed_m} m climbed, TSS ${l.tss}.`;
}

export function planUser(p: PlanPayload, c: Claim, today: string): string {
  const s = p.stage;
  const lines = [riderLine(c, today), `Ride type: ${p.mode}. Stage: ${s.name}. Length: ${s.lengthM === null ? 'endless' : `${s.lengthM} m`}. Total climbing: ${s.totalClimbM} m.`];
  if (s.climbs.length) lines.push('Climbs: ' + s.climbs.map((k) => `${k.startM}-${k.endM} m, ${k.avgPct}% average, ${k.gainM} m gain`).join('; ') + '.');
  if (s.sprints.length) lines.push('Sprints: ' + s.sprints.map((k) => `${k.name} at ${k.atM} m`).join('; ') + '.');
  if (s.koms.length) lines.push('Summits: ' + s.koms.map((k) => `${k.name} at ${k.atM} m`).join('; ') + '.');
  if (p.workout) {
    lines.push(`Workout: ${p.workout.name}, ${p.workout.minutes} min. Steps (start second, length, label, % of FTP): ` +
      p.workout.steps.map((t) => `${t.atS}s ${t.durS}s ${t.label} ${t.pctFtp === null ? 'free' : `${Math.round(t.pctFtp * 100)}%`}`).join('; ') + '.');
  }
  lines.push('Job: plan.');
  return lines.join('\n');
}

export function tipUser(p: TipPayload, c: Claim, today: string): string {
  return [
    riderLine(c, today),
    `Stage: ${p.stageName}. Moment: ${p.moment}. For the last ${p.seconds} s: grade ${p.gradePct}%, power ${p.watts} W${p.targetW ? ` (target ${p.targetW} W)` : ''}, cadence ${p.cadence} rpm, heart rate ${money(p.hr || null, ' bpm')}${p.hrDriftPct !== null ? `, heart rate drift ${p.hrDriftPct}% at steady power` : ''}${p.gapM !== null ? `, ${p.gapM} m behind the rider ahead` : ''}.`,
    'Job: tip.',
  ].join('\n');
}

export function debriefUser(p: DebriefPayload, c: Claim, today: string): string {
  const lines = [
    riderLine(c, today),
    `Ride: ${p.title} (${p.mode}). ${min(p.durationS)}, ${p.distanceKm} km, ${p.climbedM} m climbed. Average power ${p.avgW} W, normalised ${p.npW} W${c.ftp ? ` (${Math.round((p.npW / c.ftp) * 100)}% of FTP)` : ''}${c.ftp && c.weight_kg ? `, ${(p.avgW / c.weight_kg).toFixed(2)} W/kg average` : ''}. TSS ${money(p.tss)}.`,
    `Seconds in power zones 1 to 6: ${p.powerZoneS.map(Math.round).join(', ')}. Heart rate: average ${money(p.avgHr, ' bpm')}, max ${money(p.maxHr, ' bpm')}; seconds in zones 1 to 5: ${p.hrZoneS.map(Math.round).join(', ')}. Average cadence ${money(p.avgCadence, ' rpm')}.`,
  ];
  if (p.workout) lines.push(`Workout: ${p.workout.name}${p.workout.compliancePct === null ? '' : `, time on target ${p.workout.compliancePct}%`}.`);
  if (p.race) lines.push(`Race: placed ${p.race.place} of ${p.race.of}.`);
  if (p.plan) lines.push(`Training plan: ${p.plan.name}, ${p.plan.done} of ${p.plan.total} sessions done.`);
  lines.push('Job: debrief.');
  return lines.join('\n');
}
