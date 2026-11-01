// The climb preview card: when a climb (over 3% for more than 500 m) starts
// within 2 km, a small card shows its length, average and steepest grade and a
// coloured profile; while you are on it, how far to the top and the average
// grade still to come. Climbs come from climb.ts.

import { currentStage, elevationAt } from './course';
import { drawProfile } from './profile';
import { findClimbs, climbStatus, type Climb } from './climb';
import type { Stage } from './stages';

const KM_PER_MI = 1.609344;
const FT_PER_M = 3.28084;
const RESCAN_EVERY = 400; // metres, on a stage with no finish

const dist = (m: number, imperial: boolean) => {
  if (imperial) return `${(m / 1000 / KM_PER_MI).toFixed(m < 1600 ? 2 : 1)} mi`;
  return m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
};
const pct = (g: number) => `${(g * 100).toFixed(1)}%`;

/**
 * Keeps the card up to date. `update` is cheap: call it a few times a second.
 * `enabled` is the Settings switch; `riding` is false at the finish.
 */
export function initClimbUi(els: { card: HTMLElement; title: HTMLElement; sub: HTMLElement; canvas: HTMLCanvasElement }) {
  let stage: Stage | null = null;
  let climbs: Climb[] = [];
  let scannedAt = -Infinity;
  let shown = false;

  const climbsFor = (d: number): Climb[] => {
    const s = currentStage();
    if (s.finish !== null) {
      if (stage !== s) { stage = s; climbs = findClimbs(elevationAt, 0, s.finish); scannedAt = 0; }
      return climbs;
    }
    // No finish line: look at the road around you.
    if (stage !== s || Math.abs(d - scannedAt) > RESCAN_EVERY) {
      stage = s;
      scannedAt = d;
      climbs = findClimbs(elevationAt, Math.max(0, d - 3000), d + 4500);
    }
    return climbs;
  };

  function hide() {
    if (shown) { els.card.hidden = true; shown = false; }
  }

  return {
    update(distance: number, enabled: boolean, riding: boolean, imperial: boolean) {
      if (!enabled || !riding) return hide();
      const status = climbStatus(climbsFor(distance), distance, elevationAt);
      if (!status) return hide();
      const c = status.climb;
      const steepest = `max ${(c.max * 100).toFixed(0)}%`;
      if (status.state === 'ahead') {
        els.title.textContent = `Next climb in ${dist(status.toStart, imperial)}`;
        els.sub.textContent = `${dist(c.length, imperial)} at ${pct(c.avg)}, ${steepest}`;
        els.card.dataset.state = 'ahead';
        els.card.hidden = false;
        shown = true;
        drawProfile(els.canvas, null, [Math.max(0, c.start - 250), c.end]);
      } else {
        const rise = elevationAt(c.end) - elevationAt(distance);
        const left = imperial ? `${Math.round(rise * FT_PER_M)} ft` : `${Math.round(rise)} m`;
        els.title.textContent = `${dist(status.toTop, imperial)} to the top`;
        els.sub.textContent = `${pct(status.avgLeft)} average from here, ${left} to climb`;
        els.card.dataset.state = 'on';
        els.card.hidden = false;
        shown = true;
        drawProfile(els.canvas, distance, [Math.max(0, Math.min(distance - 150, c.start - 100)), c.end]);
      }
    },
  };
}
