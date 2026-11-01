// The "📤 Share" buttons (finish card, a ride on your profile). The card itself
// (shareUi.ts and shareCard.ts) is loaded when a button is pressed.

import { lazy, use } from '../lazy';
import type { ShareRide } from './shareUi';

const shareUi = lazy(() => import('./shareUi'));

/** Builds and shares the card for a ride. */
export function shareRide(ride: ShareRide, toast: (m: string, ms?: number) => void, busy?: Element | null) {
  return use(shareUi, (m) => m.runShare(m.shareDataFromRide(ride), toast), busy);
}

/** Adds a "📤 Share" button to a row of actions; the ride's numbers are built when it's pressed. */
export function attachShare(parent: HTMLElement, ride: () => ShareRide, toast: (m: string, ms?: number) => void, where: 'start' | 'end' = 'end') {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = '📤 Share';
  b.title = 'Make a picture of this ride to share';
  b.addEventListener('click', () => { b.disabled = true; shareRide(ride(), toast, b).finally(() => { b.disabled = false; }); });
  if (where === 'start') parent.prepend(b);
  else parent.append(b);
  return b;
}
