// Whether the first-ride guide has been done. Kept apart from the guide itself
// (onboarding.ts) so the home page can ask without loading the whole dialog.

const DONE_KEY = 'americanflyers.onboarded';

/** True once the guide has been done or skipped, or for anyone who has ridden here before (has saved settings). */
export function onboarded() {
  try { return localStorage.getItem(DONE_KEY) === '1' || localStorage.getItem('americanflyers.settings') !== null; } catch { return true; }
}

export function markDone() {
  try { localStorage.setItem(DONE_KEY, '1'); } catch { /* shows again next time */ }
}
