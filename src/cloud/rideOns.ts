// Ride-ons: a quick 👍 🔥 💪 👋 sent to another rider on the road (no free-text
// chat). send_ride_on() and my_ride_ons() are in db/schema.sql. Riders are
// named by the same hashed id that ride_presence() returns. We poll for ones
// sent to us every few seconds while signed in and the page is visible.

import { account } from './account';
import { neon } from './client';

export const EMOTES = ['👍', '🔥', '💪', '👋'] as const;
export type Emote = (typeof EMOTES)[number];

const POLL_MS = 4000;

export interface RideOn {
  id: number;
  fromId: string; // hashed id, as in ride_presence()
  name: string;
  emote: string;
}

interface Row { id: number | string; from_id: string; name: string; emote: string; created_at: string }

export class RideOns {
  /** Called for each new ride-on sent to us. */
  onReceive: (r: RideOn) => void = () => {};
  private since = '';
  private seen = new Set<number>();
  private busy = false;
  private failures = 0;
  private timer = 0;

  /** `active` says whether we should be listening (riding, not on the home page). */
  constructor(private readonly active: () => boolean) {
    this.timer = window.setInterval(() => this.poll(), POLL_MS);
  }

  private async poll() {
    if (!account() || !this.active() || document.visibilityState !== 'visible' || this.busy) return;
    if (this.failures > 2 && Math.random() < 0.6) return;
    this.busy = true;
    try {
      // First poll: anything from the last minute. After that, only newer than the last one seen.
      const { data, error } = await neon.rpc('my_ride_ons', this.since ? { p_since: this.since } : {});
      if (error) throw new Error(error.message);
      for (const r of (data ?? []) as Row[]) {
        const id = Number(r.id);
        this.since = r.created_at;
        if (this.seen.has(id)) continue;
        this.seen.add(id);
        if (this.seen.size > 200) this.seen.delete(this.seen.values().next().value as number);
        this.onReceive({ id, fromId: r.from_id, name: r.name, emote: r.emote });
      }
      this.failures = 0;
    } catch (e) {
      this.failures++;
      if (this.failures === 3) console.warn('Ride-ons: lost touch with the server', e);
    } finally {
      this.busy = false;
    }
  }

  /** Sends a ride-on to a live rider (their hashed id). Throws with a friendly message if refused. */
  async send(toId: string, emote: Emote) {
    if (!account()) throw new Error('Sign in to send ride-ons');
    const { error } = await neon.rpc('send_ride_on', { p_to: toId, p_emote: emote });
    if (error) throw new Error(error.message);
  }

  stop() {
    clearInterval(this.timer);
  }
}
