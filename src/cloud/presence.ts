// Riding together: every couple of seconds a signed-in rider sends where they
// are on the stage and gets back everyone else on that stage (see
// ride_presence() in db/schema.sql). Between updates each rider is moved on
// at their last known speed.

import type { OtherRider } from '../world/others';
import { account, onAccountChange } from './account';
import { neon } from './client';
import { parseKitString, parseKitStyle } from '../kit';
import type { BikeStyle } from '../garage/style';

/** A kit string parsed once: null when it carries no colours (the default kit). */
interface Look { jersey: string; accent: string; frame: string; style: BikeStyle | null }
interface Out extends OtherRider { hasJersey: boolean; hasAccent: boolean; hasFrame: boolean; hasStyle: boolean }

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
  /** Parsed kits, keyed by the kit string: parseKitString/parseKitStyle are regex-based, so each string is parsed once. */
  private readonly looks = new Map<string, Look | null>();
  /** Riders rebuilt when new data arrives (see riders()); their `distance` is updated in place each call. */
  private out: Out[] = [];
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

  private look(kit: string | null | undefined): Look | null | undefined {
    if (kit == null) return null;
    if (!this.looks.has(kit)) {
      const k = parseKitString(kit);
      this.looks.set(kit, k ? { jersey: k.jersey, accent: k.accent, frame: k.frame, style: parseKitStyle(kit) } : null);
    }
    return this.looks.get(kit);
  }

  /**
   * Rebuilds the rider objects from `known`, reusing the previous objects where a rider's kit is
   * unchanged. Only optional fields that really have a value are set, as riders() used to do with
   * spread: consumers that test a field with `??` or truthiness keep seeing the same thing.
   */
  private build() {
    const prev = new Map(this.out.map((o) => [o.id, o]));
    const out: Out[] = new Array(this.known.length);
    for (let i = 0; i < this.known.length; i++) {
      const k = this.known[i];
      const look = this.look(k.kit);
      const jersey = look?.jersey, accent = look?.accent, frame = look?.frame, style = look?.style ?? null;
      let o = prev.get(k.id);
      if (!o || o.hasJersey !== !!jersey || o.hasAccent !== !!accent || o.hasFrame !== !!frame || o.hasStyle !== !!style) {
        o = { id: k.id, name: k.name, distance: 0, speedMs: 0, power: 0, cadence: 0, hasJersey: false, hasAccent: false, hasFrame: false, hasStyle: false };
      }
      o.name = k.name;
      o.speedMs = k.speed;
      o.power = k.power;
      o.cadence = k.cadence;
      if (jersey) { o.jersey = jersey; o.hasJersey = true; } else if (o.hasJersey) { o.jersey = undefined; o.hasJersey = false; }
      if (accent) { o.accent = accent; o.hasAccent = true; } else if (o.hasAccent) { o.accent = undefined; o.hasAccent = false; }
      if (frame) { o.frame = frame; o.hasFrame = true; } else if (o.hasFrame) { o.frame = undefined; o.hasFrame = false; }
      if (style) { o.style = style; o.hasStyle = true; } else if (o.hasStyle) { o.style = undefined; o.hasStyle = false; }
      out[i] = o;
    }
    this.out = out;
  }

  /**
   * Everyone else on this stage, with positions predicted for now.
   *
   * The array and its rider objects are reused: the call updates `distance` in place and returns the
   * same array (a rebuilt one after tick() gets new data, or a new rider's kit first appears).
   * Consumers may read it freely for the frame, but anything kept beyond that must be copied
   * (e.g. `.slice()`) and treated as a snapshot.
   */
  riders(): OtherRider[] {
    const now = performance.now();
    const out = this.out;
    // Callers must not add to the returned array (copy it first); if one did, stop at the riders this knows about.
    if (out.length > this.known.length) out.length = this.known.length;
    for (let i = 0; i < out.length; i++) {
      const o = out[i];
      const k = this.known[i];
      const t = Math.min(MAX_EXTRAPOLATE_S, (now - k.at + k.age_ms) / 1000);
      o.distance = k.distance + k.speed * t;
    }
    return out;
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
      this.out = [];
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
      // Parse each new kit once, then keep that parse for as long as it is in use.
      for (const k of this.known) if (k.kit != null) this.look(k.kit);
      if (this.looks.size > 64) for (const kit of this.looks.keys()) if (!this.known.some((k) => k.kit === kit)) this.looks.delete(kit);
      this.build();
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
