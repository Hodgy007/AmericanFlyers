// Keeps the screen awake while a ride is on screen (a trainer ride is long and nobody touches the screen).
// The browser releases the lock by itself whenever the tab is hidden, so it is asked for again when the tab is shown.
// Where there is no Screen Wake Lock API, or the request is refused, it fails silently and the screen may dim as usual.

export interface WakeLockSentinelLike {
  released?: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

export interface WakeLockHost {
  wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
}

export class WakeLockKeeper {
  private wanted = false;
  private sentinel: WakeLockSentinelLike | null = null;
  private requesting = false;
  private generation = 0;

  constructor(private readonly host: WakeLockHost | undefined, private readonly visible: () => boolean) {}

  /** Whether the screen is being held right now. */
  get held() {
    return this.sentinel !== null;
  }

  /** The ride is on screen (true) or not: the hub or the home page is showing (false). */
  setWanted(on: boolean) {
    this.wanted = on;
    this.sync();
  }

  /** The tab's visibility changed: the browser dropped the lock if it was hidden, so take it again once it's shown. */
  visibilityChanged() {
    this.sync();
  }

  private sync() {
    if (!this.wanted) {
      this.generation++; // an in-flight request that finishes after this is released at once
      const s = this.sentinel;
      this.sentinel = null;
      if (s) s.release().catch(() => {});
      return;
    }
    if (this.sentinel || this.requesting || !this.visible() || !this.host?.wakeLock) return;
    this.requesting = true;
    const gen = this.generation;
    this.host.wakeLock.request('screen').then(
      (s) => {
        this.requesting = false;
        if (gen !== this.generation || !this.wanted) {
          s.release().catch(() => {});
          this.sync(); // wanted again meanwhile? ask afresh
          return;
        }
        this.sentinel = s;
        s.addEventListener('release', () => { if (this.sentinel === s) this.sentinel = null; }); // hidden tab, low battery: it's gone
      },
      () => { this.requesting = false; }, // refused (battery saver, no permission): carry on without
    );
  }
}
