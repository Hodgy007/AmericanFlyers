// The garage's brain: your wallet (level, credits, owned items), your loadout
// (what you ride and wear, checked against what you own), what that does to the
// physics, and the "you earned…" moment after a ride. The screens are in garageUi.ts.

import { account } from '../cloud/account';
import { setPlayerStyle } from '../kit';
import { buyItem, fetchWallet } from './api';
import { cleanLoadout, equipmentEffects, ITEMS, itemById, styleOf, STARTER_IDS, type EquipmentEffects, type Loadout } from './catalogue';
import { levelTitle, type Wallet } from './progression';
import { claimable } from './store';

export interface GarageOptions {
  /** The saved loadout (settings.loadout). */
  saved: () => Partial<Loadout> | null;
  /** Saves a new loadout to the settings (and the account). */
  save: (l: Loadout) => void;
  toast: (msg: string, ms?: number) => void;
}

/** What a saved ride earned, for the message after it. */
export interface RideReward {
  credits: number;
  xp: number;
  levelBefore: number;
  levelAfter: number;
  unlocked: string[];
}

export class Garage {
  wallet: Wallet | null = null;
  private fetching: Promise<Wallet | null> | null = null;
  private readonly listeners: (() => void)[] = [];

  constructor(private readonly o: GarageOptions) {
    this.apply();
  }

  /** What you actually ride and wear: the saved choices you still own. */
  loadout(): Loadout {
    // Signed in but the wallet hasn't arrived yet: trust the saved choice for now.
    const owned = this.wallet ? new Set(this.wallet.owned) : account() ? null : STARTER_IDS;
    return cleanLoadout(this.o.saved(), owned);
  }

  /** What it does to the physics: mass added, drag factor, rolling resistance added. */
  effects(): EquipmentEffects {
    return equipmentEffects(this.loadout());
  }

  /** Puts the current loadout on your rider (and, through the kit string, on other riders' screens). */
  apply() {
    setPlayerStyle(styleOf(this.loadout()));
    for (const fn of this.listeners) fn();
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  equip(l: Loadout) {
    this.o.save(l);
    this.apply();
  }

  /** Reads the wallet from the server, takes any free unlocks you've earned, and refreshes what you wear. Null if signed out or offline. */
  refresh(): Promise<Wallet | null> {
    if (!account()) {
      this.wallet = null;
      this.apply();
      return Promise.resolve(null);
    }
    this.fetching ??= this.load().finally(() => { this.fetching = null; });
    return this.fetching;
  }

  private async load(): Promise<Wallet | null> {
    try {
      let w = await fetchWallet();
      // Free unlocks (the Tron bike): once you've climbed enough they're yours.
      for (const it of claimable(ITEMS, w)) {
        try {
          w = await buyItem(it.id);
          this.o.toast(`🎉 Unlocked: ${it.name}! Find it in ☰ Menu → Garage & store.`, 8000);
        } catch { /* try again next time */ }
      }
      this.wallet = w;
    } catch {
      // Offline or the garage isn't set up on the server: carry on with what we know.
    }
    this.apply();
    return this.wallet;
  }

  /** After a ride is saved: what it earned. */
  async afterRide(): Promise<RideReward | null> {
    const before = this.wallet;
    const after = await this.refresh();
    if (!after || !before) return null;
    const credits = after.creditsEarned - before.creditsEarned;
    const xp = after.xp - before.xp;
    if (credits <= 0 && after.level === before.level) return null;
    const unlocked = after.owned.filter((id) => !before.owned.includes(id)).map((id) => itemById(id)?.name ?? id);
    return { credits: Math.max(0, credits), xp: Math.max(0, xp), levelBefore: before.level, levelAfter: after.level, unlocked };
  }
}

/** "+42 credits · level 6: Climber!" */
export function rewardText(r: RideReward): string {
  const parts: string[] = [];
  if (r.credits > 0) parts.push(`+${r.credits.toLocaleString('en-US')} credits`);
  if (r.levelAfter > r.levelBefore) parts.push(`level ${r.levelAfter}: ${levelTitle(r.levelAfter)}!`);
  return parts.join(' · ');
}
