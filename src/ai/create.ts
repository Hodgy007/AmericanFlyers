// The one door into the AI controller. main.ts loads this file on demand
// (`lazy(() => import('./ai/create'))`, see "Lazy loading" in the architecture
// guide), so none of src/ai/ or cloud/aiApi.ts is in the entry chunk. It takes
// the ride's state from main.ts and adds the parts that need the AI code
// (the stage brief), so main.ts never imports them.

import type { Stage } from '../stages';
import { AiRide, type AiHost } from './aiRide';
import { stageBrief, type RaceLineLike } from './brief';

/** What main.ts supplies: the host the controller needs, with the stage brief left for us to build. */
export type AiHostBase = Omit<AiHost, 'stageBrief'> & {
  stage(): Stage;
  /** Sprint and summit lines on the current course. */
  stageLines(): RaceLineLike[];
  /** Changes when the stage or race course does, so the brief is rebuilt (it scans the whole stage). */
  briefKey(): string;
};

export function createAi(base: AiHostBase): AiRide {
  let cache: { key: string; brief: ReturnType<typeof stageBrief> } | null = null;
  return new AiRide({
    ...base,
    stageBrief: () => {
      const key = base.briefKey();
      if (cache?.key !== key) cache = { key, brief: stageBrief(base.stage(), base.stageLines()) };
      return cache.brief;
    },
  });
}
