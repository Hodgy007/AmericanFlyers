// What you can do with a catalogue item right now, given your wallet. Pure,
// so the screens and the tests share it. The server enforces the same rules in buy_item().

import { itemById, type Loadout, type Slot, type StoreItem, STARTER_IDS } from './catalogue';
import type { Wallet } from './progression';

export type ItemState =
  | { kind: 'owned' }
  | { kind: 'claim' } // a free unlock whose rule you've met (the Tron bike)
  | { kind: 'buy' }
  | { kind: 'poor'; short: number } // met the requirements but not enough credits
  | { kind: 'locked'; reason: string };

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/** Where an item stands for a rider; with no wallet (signed out) only starters are owned. */
export function itemState(it: StoreItem, w: Wallet | null): ItemState {
  const owned = STARTER_IDS.has(it.id) || !!w?.owned.includes(it.id);
  if (owned) return { kind: 'owned' };
  if (!w) return { kind: 'locked', reason: 'Sign in to earn credits and unlock this' };
  if (it.unlock?.climbed_m && w.climbedM < it.unlock.climbed_m) {
    return { kind: 'locked', reason: `Climb ${fmt(it.unlock.climbed_m)} m in total (${fmt(w.climbedM)} m so far)` };
  }
  if (it.unlock?.km && w.km < it.unlock.km) {
    return { kind: 'locked', reason: `Ride ${fmt(it.unlock.km)} km in total (${fmt(w.km)} km so far)` };
  }
  if (w.level < it.level) return { kind: 'locked', reason: `Reach level ${it.level}` };
  if (it.price === 0) return { kind: 'claim' };
  if (w.balance < it.price) return { kind: 'poor', short: it.price - w.balance };
  return { kind: 'buy' };
}

/** Free unlocks the rider has earned and not yet taken: they're claimed for them automatically. */
export function claimable(items: readonly StoreItem[], w: Wallet): StoreItem[] {
  return items.filter((i) => !i.starter && itemState(i, w).kind === 'claim');
}

/** Can the item be equipped with this loadout (disc wheels need the time-trial bike)? */
export function fitsLoadout(it: StoreItem, l: Loadout): boolean {
  return !it.needsFrame || itemById(l.frame)?.look === it.needsFrame;
}

/** The loadout with `it` put on; switching to a bike that disc wheels don't fit puts the starter wheels back. */
export function equip(l: Loadout, it: StoreItem, starterWheels: string): Loadout {
  const next: Loadout = { ...l, [it.slot as Slot]: it.id };
  if (it.slot === 'frame') {
    const wheels = itemById(next.wheels);
    if (wheels?.needsFrame && it.look !== wheels.needsFrame) next.wheels = starterWheels;
  }
  return next;
}
