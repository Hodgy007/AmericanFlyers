// What the coach may suggest as your next session after a ride: the built-in
// workouts and stages. The ids are fixed at build time, so the debrief's JSON
// schema (an enum of these ids) is the same for every rider and the prompt
// cache stays warm. Pure: only data modules.

import { BUILTIN_WORKOUTS, expand, totalDuration } from '../workouts/model.js';
import { STAGE_SUGGESTIONS } from './stageSuggestions.js';

export interface Suggestion {
  id: string;
  kind: 'workout' | 'stage';
  name: string;
  /** One short line for the prompt. */
  about: string;
}

const workouts: Suggestion[] = BUILTIN_WORKOUTS.map((w) => ({
  id: w.id,
  kind: 'workout',
  name: w.name,
  about: `${Math.round(totalDuration(expand(w.blocks)) / 60)} min. ${w.description}`.slice(0, 140),
}));

// Whole stages with a finish line, not the tour's linked stages (they have their own flow): see stageSuggestions.ts.
const stages: Suggestion[] = STAGE_SUGGESTIONS.map((s) => ({ ...s, kind: 'stage' }));

export const SUGGESTIONS: Suggestion[] = [...workouts, ...stages];
export const SUGGESTION_IDS = SUGGESTIONS.map((s) => s.id) as [string, ...string[]];
export const suggestionById = (id: string) => SUGGESTIONS.find((s) => s.id === id);
