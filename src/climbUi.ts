// The climb preview card: when a climb (over 3% for more than 500 m) starts
// within 2 km, a small card shows its length, average and steepest grade and a
// coloured profile; while you are on it, how far to the top and the average
// grade still to come. Climbs come from climb.ts.

import { currentStage, elevationAt } from './course';
import { drawProfile } from './profile';
import { findClimbs, climbStatus, distText, pctText, type Climb } from './climb';
import type { Stage } from './stages';
import { layoutCards, registerCard } from './cardDock';

const FT_PER_M = 3.28084;
const RESCAN_EVERY = 400; // metres, on a stage with no finish


/**
 * Keeps the card up to date. `update` is cheap: call it a few times a second.
 * `enabled` is the Settings switch; `riding` is false at the finish.
 */
export function initClimbUi(els: { card: HTMLElement; title: HTMLElement; sub: HTMLElement; canvas: HTMLCanvasElement }) {
  let stage: Stage | null = null;
  let climbs: Climb[] = [];
  let scannedAt = -Infinity;
  let shown = false;
  let seen = ''; // which climb and state the card last showed: a change opens the card for a few seconds
  const chip = document.getElementById('cc-chip')!;
  const dock = registerCard('climb', els.card, document.getElementById('cc-toggle') as HTMLButtonElement, 112);

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
    if (shown) { els.card.hidden = true; shown = false; seen = ''; dock.gone(); }
  }

  return {
    update(distance: number, enabled: boolean, riding: boolean, imperial: boolean) {
      if (!enabled || !riding) return hide();
      const status = climbStatus(climbsFor(distance), distance, elevationAt);
      if (!status) return hide();
      const c = status.climb;
      const steepest = `max ${(c.max * 100).toFixed(0)}%`;
      const key = `${c.start}|${status.state}`;
      const fresh = key !== seen;
      if (status.state === 'ahead') {
        els.title.textContent = `Next climb in ${distText(status.toStart, imperial)}`;
        els.sub.textContent = `${distText(c.length, imperial)} at ${pctText(c.avg)}, ${steepest}`;
        chip.textContent = `⛰ Climb in ${distText(status.toStart, imperial)} · ${pctText(c.avg)}`;
        els.card.dataset.state = 'ahead';
        els.card.hidden = false;
        shown = true;
        drawProfile(els.canvas, null, [Math.max(0, c.start - 250), c.end]);
      } else {
        const rise = elevationAt(c.end) - elevationAt(distance);
        const left = imperial ? `${Math.round(rise * FT_PER_M)} ft` : `${Math.round(rise)} m`;
        els.title.textContent = `${distText(status.toTop, imperial)} to the top`;
        els.sub.textContent = `${pctText(status.avgLeft)} average from here, ${left} to climb`;
        chip.textContent = `⛰ ${distText(status.toTop, imperial)} to the top · ${pctText(status.avgLeft)}`;
        els.card.dataset.state = 'on';
        els.card.hidden = false;
        shown = true;
        drawProfile(els.canvas, distance, [Math.max(0, Math.min(distance - 150, c.start - 100)), c.end]);
      }
      if (fresh) { seen = key; dock.notify(); }
      layoutCards();
    },
  };
}
