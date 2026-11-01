// Turns a stage into the short brief the coach and rivals are told about:
// its length, climbs, sprints and summits. Pure.

import { findClimbs } from '../climb';
import type { Stage } from '../stages';
import type { StageBrief } from './types';

export interface RaceLineLike { kind: 'sprint' | 'summit' | 'finish'; d: number; name: string }

const MAX_SCAN_M = 40000;

export function stageBrief(stage: Stage, lines: RaceLineLike[] = []): StageBrief {
  const to = Math.min(stage.finish ?? 20000, MAX_SCAN_M);
  const climbs = findClimbs((d) => stage.elevationAt(d), 0, to).slice(0, 12);
  let total = 0;
  let last = stage.elevationAt(0);
  for (let d = 20; d <= to; d += 20) {
    const e = stage.elevationAt(d);
    if (e > last) total += e - last;
    last = e;
  }
  return {
    id: stage.id,
    name: stage.name.slice(0, 80),
    lengthM: stage.finish === null ? null : Math.round(stage.finish),
    totalClimbM: Math.round(total),
    climbs: climbs.map((c) => ({ startM: Math.round(c.start), endM: Math.round(c.end), avgPct: Math.round(c.avg * 1000) / 10, gainM: Math.round(c.gain) })),
    sprints: lines.filter((l) => l.kind === 'sprint').slice(0, 6).map((l) => ({ atM: Math.round(l.d), name: l.name.slice(0, 40) })),
    koms: lines.filter((l) => l.kind === 'summit').slice(0, 6).map((l) => ({ atM: Math.round(l.d), name: l.name.slice(0, 40) })),
  };
}
