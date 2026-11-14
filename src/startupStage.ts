// The stage the app opens on. A built-in stage's road loads on demand (src/stages.ts), and the world is built on the current stage's
// road, so the one in the page's `?stage=` is fetched before main.ts runs (src/boot.ts calls this, then loads main.ts: the rest of the
// app downloads in parallel). With no `?stage=` (the usual visit) it is Heartland, which is part of the app, and nothing waits.
// If the fetch fails (offline, a stage never ridden before) the app opens on Heartland and says so (`startupStageFailed`).
import { loadStage, stageById, type Stage } from './stages';

export let startupStage: Stage = stageById(null);
/** The stage that was asked for but whose road couldn't be fetched, if any. */
export let startupStageFailed: Stage | null = null;

export async function chooseStartupStage(): Promise<void> {
  const asked = stageById(new URLSearchParams(location.search).get('stage'));
  try {
    await loadStage(asked);
    startupStage = asked;
  } catch {
    startupStageFailed = asked;
  }
}
