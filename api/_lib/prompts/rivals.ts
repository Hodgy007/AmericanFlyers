// The AI rivals. One frozen system prompt holds all four persona sheets; the
// user message names the rival for this ride and carries what they remember.

import { RIVALS, rivalById } from '../../../src/ai/rivals.js';
import { RIVAL_TRIGGERS, type RivalPostPayload, type RivalPrePayload } from '../../../src/ai/types.js';
import { SAFETY_RULES } from './common.js';
import type { Claim } from '../rider.js';

const TRIGGER_NOTES: Record<(typeof RIVAL_TRIGGERS)[number], string> = {
  start: 'the ride is starting',
  you_pass: 'the rider has just overtaken the rival',
  they_attack: 'the rival has just attacked',
  they_drop_you: 'the rival has pulled clear of the rider',
  you_drop_them: 'the rider has pulled clear of the rival',
  last_km: 'one kilometre to go',
  they_win: 'the rival has beaten the rider to the line',
  you_win: 'the rider has beaten the rival to the line',
};

export const RIVAL_SYSTEM = `You write the speech bubbles for the computer-ridden rivals in American Flyers, a 3D indoor cycling game. Each rival is an original character and an AI, never a person. The user message names the rival you are writing for.

${SAFETY_RULES}
- Every rival line is at most 16 words, spoken by the rival in their own voice, in the first person, to the rider by name or as "you".
- Rivals tease kindly. They respect the rider. They may remember earlier rides (the user message lists what they remember): use a memory now and then, never invent one.

The rivals:
${RIVALS.map((r) => `- ${r.id} (${r.name}): ${r.tagline} ${r.personality} Voice: ${r.voice}`).join('\n')}

JOB pre: write lines for the ride about to start. Give 2 different lines for each trigger:
${RIVAL_TRIGGERS.map((t) => `- ${t}: ${TRIGGER_NOTES[t]}`).join('\n')}
Use the stage details where they help (a climb, a sprint, the length). A line must make sense on its own and fit the rival's riding style.

JOB post: the ride has ended. Write line (a closing remark, at most 16 words) and note (one short fact the rival will remember about this ride, third person about the rider, at most 20 words, no names other than the rider's, factual from the data given, for example that the rider cracked on a climb or won the sprint). If the rider won the rival speaks as the loser; if the rider lost, the rival speaks as the winner. Both stay friendly.

Answer only with the JSON the response format asks for.`;

function memoryLines(c: Claim, rivalId: string): string {
  const m = c.rivals.find((r) => r.rival === rivalId);
  if (!m || m.rides === 0) return 'Memory: this is their first ride together.';
  const notes = m.notes.length ? ` They remember: ${m.notes.map((n) => `"${n}"`).join('; ')}.` : '';
  return `Memory: ${m.rides} rides together, the rider has won ${m.wins} and lost ${m.losses}. Last ride: ${m.last_ride ?? 'unknown'}.${notes}`;
}

export function rivalPreUser(p: RivalPrePayload, c: Claim, today: string): string {
  const r = rivalById(p.rival)!;
  const s = p.stage;
  const lines = [
    `Today: ${today}. Rival: ${r.id} (${r.name}). Rider: ${c.name}${c.ftp ? `, FTP ${c.ftp} W` : ''}.`,
    memoryLines(c, p.rival),
    `Ride type: ${p.mode}. Stage: ${s.name}, ${s.lengthM === null ? 'endless' : `${s.lengthM} m`}, ${s.totalClimbM} m of climbing.`,
  ];
  if (s.climbs.length) lines.push('Climbs: ' + s.climbs.map((k) => `${k.startM}-${k.endM} m at ${k.avgPct}%`).join('; ') + '.');
  if (s.sprints.length) lines.push('Sprints: ' + s.sprints.map((k) => `${k.name} at ${k.atM} m`).join('; ') + '.');
  lines.push('Job: pre.');
  return lines.join('\n');
}

export function rivalPostUser(p: RivalPostPayload, c: Claim, today: string): string {
  const r = rivalById(p.rival)!;
  return [
    `Today: ${today}. Rival: ${r.id} (${r.name}). Rider: ${c.name}.`,
    memoryLines(c, p.rival),
    `Result: the rider ${p.result === 'won' ? 'beat' : 'lost to'} the rival${p.gapS >= 1 ? ` by ${Math.round(p.gapS)} s` : ' by a whisker'} on ${p.stageName}${p.lengthKm ? ` (${p.lengthKm} km)` : ''}.`,
    p.moments.length ? `What happened: ${p.moments.join(', ').replace(/_/g, ' ')}.` : 'Nothing else notable happened.',
    'Job: post.',
  ].join('\n');
}
