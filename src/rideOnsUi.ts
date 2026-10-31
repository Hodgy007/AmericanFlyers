// Ride-ons in the app: sending one (from the 👥 list, or R for the rider you're
// drafting), showing the ones you get (a toast and an emoji floating over the
// sender), and the pro team riders who give you one back now and then.

import { EMOTES, type RideOn, type RideOns } from './cloud/rideOns';
import { BIKE_LENGTH } from './draft';
import type { OtherRider } from './world/others';

const COOLDOWN_MS = 20000; // same as the server's limit per rider
const REPLY_CHANCE = 0.6;

interface Options {
  rideOns: RideOns;
  /** Everyone on the road now: live riders and pro teams. */
  riders: () => OtherRider[];
  myDistance: () => number;
  /** Floats an emoji over a rider; false if they aren't drawn. */
  showEmote: (id: string, emoji: string) => boolean;
  toast: (msg: string, ms?: number) => void;
}

export function initRideOnsUi(o: Options) {
  const lastSent = new Map<string, number>();

  o.rideOns.onReceive = (r: RideOn) => {
    o.showEmote(r.fromId, r.emote);
    o.toast(`${r.name} sent you ${r.emote}`, 3500);
  };

  /** Sends `emote` to a rider (by the id in the riders list). */
  function send(id: string, name: string, emote: string) {
    const now = performance.now();
    if (now - (lastSent.get(id) ?? -Infinity) < COOLDOWN_MS) {
      o.toast(`You just sent ${name || 'them'} one. Give it a few seconds.`);
      return;
    }
    if (id.startsWith('team-')) {
      // Pro riders live in your browser: no server involved.
      lastSent.set(id, now);
      o.showEmote(id, emote);
      o.toast(`Sent ${emote} to ${name}`);
      if (Math.random() < REPLY_CHANCE) {
        const reply = EMOTES[Math.floor(Math.random() * EMOTES.length)];
        window.setTimeout(() => {
          o.showEmote(id, reply);
          o.toast(`${name} sent you ${reply}`);
        }, 3000 + Math.random() * 5000);
      }
      return;
    }
    lastSent.set(id, now); // set first so a double click can't send twice
    o.rideOns.send(id, emote as (typeof EMOTES)[number]).then(
      () => {
        o.showEmote(id, emote);
        o.toast(`Sent ${emote} to ${name}`);
      },
      (e: Error) => {
        lastSent.delete(id);
        o.toast(e.message);
      },
    );
  }

  /** R: a 👍 for the rider just ahead of you, the one whose draft you're in or closing on. */
  function thumbsUpAhead() {
    const mine = o.myDistance();
    let best: OtherRider | null = null;
    let bestGap = Infinity;
    for (const r of o.riders()) {
      if (r.ghost) continue;
      const gap = r.distance - mine - BIKE_LENGTH;
      if (gap < -3 || gap > 60 || gap >= bestGap) continue; // a bit alongside counts too
      best = r;
      bestGap = gap;
    }
    if (!best) {
      o.toast('Nobody close ahead to give a 👍 to.');
      return;
    }
    send(best.id, best.name, '👍');
  }

  return { send, thumbsUpAhead };
}
