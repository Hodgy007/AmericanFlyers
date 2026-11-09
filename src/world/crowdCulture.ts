import type { Stage } from '../stages';
import { signStyleOf } from './milestones';

// Who stands at the roadside: a "culture" per country gives the spectators their
// shirts and flags. Pure data and lookups (no WebGL), so the choice is unit-tested;
// crowds.ts draws the shirts and crowdFlags.ts paints the flag designs.

/** France, Italy, the USA, Colorado (the Hell of the West stages), the Dutch (the Alpe's Dutch Corner) and Britain (Yorkshire). */
export type CultureId = 'fr' | 'it' | 'us' | 'co' | 'nl' | 'gb';

/** Every flag a crowd can wave, in the row order of the flag atlas (crowdFlags.ts). */
export const FLAG_DESIGNS = ['fr', 'polka', 'bretagne', 'basque', 'it', 'pink', 'us', 'colorado', 'nl', 'orange', 'gb', 'yorkshire'] as const;
export type FlagDesign = (typeof FLAG_DESIGNS)[number];

/** The shirt colour that means "white with red polka dots" (a King of the Mountains jersey); the shader draws the dots. */
export const POLKA = 'polka';

export interface Culture {
  /** Shirt colours with weights; `POLKA` is a polka-dot jersey. */
  shirts: [color: string, weight: number][];
  /** Flags to wave: a design's share is how often it appears in the list (at most MAX_DESIGNS entries, the shader's table). */
  flags: FlagDesign[];
}

export const MAX_DESIGNS = 8;

// The ordinary mixed crowd every culture starts from: bright, unmatched shirts.
const MIXED: [string, number][] = ['#e63946', '#f4c430', '#2a9d8f', '#3a86ff', '#ff7f50', '#f4f4f4', '#8338ec', '#06d6a0', '#ff006e', '#fb8500', '#2b2d42', '#70d6ff'].map((c) => [c, 1]);

export const CULTURES: Record<CultureId, Culture> = {
  // Tricolour flags, polka-dot jerseys, and the odd Breton or Basque flag.
  fr: { shirts: [...MIXED, [POLKA, 3], ['#1d3f9c', 1.5], ['#d12a2a', 1]], flags: ['fr', 'fr', 'fr', 'fr', 'polka', 'polka', 'bretagne', 'basque'] },
  // Tricolour flags and a lot of maglia rosa.
  it: { shirts: [...MIXED, ['#f08bb4', 8], ['#1f9d55', 1], ['#d12a2a', 1]], flags: ['it', 'it', 'it', 'it', 'pink', 'pink', 'pink', 'pink'] },
  // Stars and stripes, team-colour shirts.
  us: { shirts: [...MIXED, ['#c8102e', 2], ['#0a3161', 2], ['#ffffff', 1]], flags: ['us', 'us', 'us', 'us', 'us', 'us', 'us', 'us'] },
  // The Hell of the West stages: the state flag next to the national one.
  co: { shirts: [...MIXED, ['#7a1f2b', 2], ['#f2c200', 2], ['#0b3d91', 1.5]], flags: ['us', 'us', 'us', 'us', 'colorado', 'colorado', 'colorado', 'colorado'] },
  // The Dutch Corner: nearly everyone in orange.
  // Yorkshire: Union flags and the white rose of Yorkshire, the odd polka-dot jersey, tea-room greens and Dales wool colours.
  gb: { shirts: [...MIXED, [POLKA, 2], ['#ffffff', 2], ['#1c3f7a', 2], ['#c8102e', 2], ['#2f5d3a', 1.5]], flags: ['gb', 'gb', 'gb', 'yorkshire', 'yorkshire', 'yorkshire', 'polka', 'gb'] },
  nl: { shirts: [['#ff6a00', 14], ['#ff8a1f', 8], ['#f26a1b', 6], ['#ffffff', 1], ['#d4202c', 0.6], ['#1f4ea0', 0.6], ['#2b2d42', 0.4]], flags: ['nl', 'nl', 'nl', 'orange', 'orange', 'nl', 'orange', 'nl'] },
};

/** The crowd's home culture on a stage: the stage's own `culture` if it names one, else from its hairpin word (so no per-stage list): Virage is France, Tornante Italy, the Hell of the West stages and the Colorado climbs are Colorado, anything else the USA. */
export function cultureOf(stage: Pick<Stage, 'id' | 'hairpinWord' | 'finish'> & { culture?: CultureId }): CultureId {
  if (stage.culture) return stage.culture;
  const sign = signStyleOf(stage);
  if (sign !== 'us') return sign;
  return stage.id.startsWith('hotw-') || ['hell-of-the-west', 'mt-blue-sky', 'flagstaff'].includes(stage.id) ? 'co' : 'us';
}

/** A shirt colour for `r` in [0, 1): weighted by the culture's list. */
export function pickShirt(culture: CultureId, r: number): string {
  const list = CULTURES[culture].shirts;
  let total = 0;
  for (const [, w] of list) total += w;
  let t = r * total;
  for (const [color, w] of list) {
    t -= w;
    if (t < 0) return color;
  }
  return list[list.length - 1][0];
}
