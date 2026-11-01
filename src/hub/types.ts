// The shapes shared by the hub's controller (hub.ts), its header and its sections.

import type { EventRow } from '../cloud/events';
import type { Garage } from '../garage/garage';
import type { Wallet } from '../garage/progression';
import type { Settings } from '../settings';
import type { Stage } from '../stages';
import type { Choice, Summary } from './data';

/** What changed, so a section only redraws when it must. */
export type Topic = 'choice' | 'summary' | 'wallet' | 'account' | 'plan' | 'local' | 'units';

export type SectionId = 'route' | 'training' | 'plan' | 'achievements' | 'garage' | 'stats' | 'events';

export type ProfileTab = 'stats' | 'achievements' | 'activities';

/** Everything the hub needs from the rest of the app. main.ts supplies it. */
export interface HubDeps {
  settings(): Settings;
  garage: Garage;
  /** The stage the app has loaded now (from ?stage= or the last ride). */
  currentStageId(): string;
  /** The hub opened or closed (main turns the world's slow orbit on and off). */
  onVisibility(open: boolean): void;
  /** Leave the hub and ride this. */
  start(choice: Choice): void;
  /** Leave the hub and race the pro teams over a stage. */
  race(stage: Stage): void;
  /** Join a scheduled event; resolves once you are on the line (the hub closes itself then). */
  joinEvent(row: EventRow): Promise<void>;
  /** Start following a training plan. */
  startPlan(id: string): void;
  openProfile(tab: ProfileTab, rideId?: string): void;
  openSignIn(why: string): void;
  openGarage(tab?: 'week'): void;
  /** The existing dialogs, opened over the hub. */
  dialogs: {
    workouts(): void;
    newWorkout(): void;
    plans(): void;
    tour(): void;
    events(): void;
    settings(): void;
    stages(): void;
    kit(): void;
    account(): void;
  };
  /** 0..1 darkness for the garage preview's glow. */
  night(): number;
  toast(msg: string, ms?: number): void;
}

export type IdentityState = 'guest' | 'pending' | 'in';

/** What a section can see and do. */
export interface HubCtx {
  deps: HubDeps;
  choice(): Choice;
  pick(c: Choice): void;
  identity(): { state: IdentityState; name: string };
  /** Signed in, or about to be (the last visit was signed in and the session is still being checked). */
  signedIn(): boolean;
  summary(): Summary | null;
  summaryStatus(): 'idle' | 'loading' | 'ready' | 'error';
  wallet(): Wallet | null;
  imperial(): boolean;
  /** Fetches the rides again (after a ride is saved). */
  reloadSummary(): void;
  /** Says something to screen readers. */
  announce(msg: string): void;
  /** Starts the ride you have chosen. */
  go(): void;
  /** Sets what Ride starts and goes straight there. */
  goWith(c: Choice): void;
}

export interface SectionView {
  refresh(topic: Topic): void;
  /** The section is on screen (or not): start and stop timers and previews. */
  setActive?(active: boolean): void;
  dispose?(): void;
}

export type SectionMount = (root: HTMLElement, ctx: HubCtx) => SectionView;
