// Riding together: every couple of seconds a signed-in rider sends where they
// are on the stage and gets back everyone else on that stage (see
// ride_presence() in db/schema.sql). Between updates each rider is moved on
// at their last known speed.

import type { OtherRider } from '../world/others';
import { account, onAccountChange } from './account';
import { neon } from './client';
import { parseKitString, parseKitStyle } from '../kit';

const INTERVAL_MS = 2000;
const MAX_EXTRAPOLATE_S = 6;

export interface MyPosition {
  stageId: string;
  distance: number;
  speedMs: number;
  power: number;
  cadence: number;
  /** Your kit as "#jersey,#accent,#frame", or null for the default. */
  kit?: string | null;
}

interface Row { id: string; name: string; distance: number; speed: number; power: number; cadence: number; age_ms: number; kit?: string | null }
interface Known extends Row { at: number } // performance.now() when received

export class Presence {
  private known: Known[] = [];
  private stageId = '';
  private busy = false;
  private failures = 0;
  private timer = 0;
  /** Called when the list of riders on this stage changes (joins and leaves). */
  onChange: (riders: { id: string; name: string }[]) => void = () => {};

  constructor(private readonly position: () => MyPosition | null, private readonly visible: () => boolean) {
    this.timer = window.setInterval(() => this.tick(), INTERVAL_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.leave();
      else this.tick();
    });
    window.addEventListener('pagehide', () => this.leave());
    onAccountChange((a) => {
      if (!a) this.clear();
      else this.tick();
    });
  }

  /** Everyone else on this stage, with positions predicted for now. */
  riders(): OtherRider[] {
    const now = performance.now();
    return this.known.map((k) => {
      const t = Math.min(MAX_EXTRAPOLATE_S, (now - k.at + k.age_ms) / 1000);
      // Their kit, if they've designed one (colours only from a valid kit string).
      const kit = parseKitString(k.kit);
      const style = parseKitStyle(k.kit); // their bike and clothes, after the colours
      return {
        id: k.id, name: k.name, distance: k.distance + k.speed * t, speedMs: k.speed, power: k.power, cadence: k.cadence,
        ...(kit ? { jersey: kit.jersey, accent: kit.accent, frame: kit.frame } : {}),
        ...(style ? { style } : {}),
      };
    });
  }

  get count() {
    return this.known.length;
  }

  /** Call when the stage changes, so riders from the old stage vanish at once. */
  restage() {
    this.clear();
    this.tick();
  }

  private clear() {
    if (this.known.length) {
      this.known = [];
      this.onChange([]);
    }
  }

  private async tick() {
    const me = this.position();
    if (!account() || !me || document.visibilityState !== 'visible' || this.busy) return;
    // Back off a little after errors (offline, Data API waking up).
    if (this.failures > 2 && Math.random() < 0.6) return;
    this.busy = true;
    try {
      if (me.stageId !== this.stageId) {
        this.stageId = me.stageId;
        this.clear();
      }
      const { data, error } = await neon.rpc('ride_presence', {
        p_stage: me.stageId,
        p_distance: Math.round(me.distance * 10) / 10,
        p_speed: Math.round(me.speedMs * 100) / 100,
        p_power: Math.round(me.power),
        p_cadence: Math.round(me.cadence),
        p_visible: this.visible(),
        p_kit: me.kit ?? null,
      });
      if (error) throw new Error(error.message);
      if (me.stageId !== this.position()?.stageId) return; // changed stage while waiting
      const at = performance.now();
      const before = this.known.map((k) => k.id).join();
      this.known = ((data ?? []) as Row[]).map((r) => ({ ...r, at }));
      if (this.known.map((k) => k.id).join() !== before) this.onChange(this.known.map(({ id, name }) => ({ id, name })));
      this.failures = 0;
    } catch (e) {
      this.failures++;
      if (this.failures === 3) console.warn('Riding together: lost touch with the server', e);
    } finally {
      this.busy = false;
    }
  }

  /** Tells the server we've gone (best effort; the row expires anyway). */
  leave() {
    if (!account()) return;
    neon.rpc('leave_ride').then(() => {}, () => {});
  }

  stop() {
    clearInterval(this.timer);
    this.leave();
  }
}
