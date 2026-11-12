// Rides that couldn't be saved (no connection, or the server didn't answer)
// wait here, on this device, and upload when the connection is back. Saving is
// an upsert by the ride's own id, so sending one twice never duplicates it.
//
// Each queued ride remembers whose it is: it only uploads while that rider is
// signed in. If the browser's storage is too full for a long ride's 1-second
// samples, the ride is kept without them (the summary still saves).

import type { Activity } from './cloud/sync';

export const QUEUE_KEY = 'americanflyers.rideQueue';
export const MAX_QUEUED = 20; // refuse new rides rather than discard an unsent one
export const MAX_ATTEMPTS = 12; // pause automatic retries; a manual retry keeps the ride recoverable

export interface QueuedRide {
  userId: string;
  activity: Activity;
  attempts: number; // uploads that failed while the browser said it was online
  queuedAt: string;
}

export interface FlushResult {
  uploaded: Activity[];
  failed: boolean; // stopped at an upload that failed (still queued)
  paused: Activity[]; // automatic retries paused, but the ride is still stored
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export class RideQueue {
  private flushing: Promise<FlushResult> | null = null;
  private flushingUser: string | null = null;
  private generation = 0;

  constructor(
    private readonly store: Store | null,
    private readonly upload: (a: Activity, userId: string) => Promise<void>,
    private readonly online: () => boolean = () => true,
    private readonly isCurrentUser: (userId: string) => boolean = () => true,
  ) {}

  list(): QueuedRide[] {
    try {
      const raw = this.store?.getItem(QUEUE_KEY);
      const rows = raw ? (JSON.parse(raw) as QueuedRide[]) : [];
      return Array.isArray(rows) ? rows.filter((r) => r && r.activity && typeof r.activity.id === 'string' && typeof r.userId === 'string') : [];
    } catch {
      return [];
    }
  }

  /** How many rides are waiting for this rider. */
  count(userId: string | null | undefined) {
    return userId ? this.list().filter((r) => r.userId === userId).length : 0;
  }

  private write(rows: QueuedRide[]): boolean {
    if (!this.store) return false;
    try {
      if (rows.length) this.store.setItem(QUEUE_KEY, JSON.stringify(rows));
      else this.store.removeItem(QUEUE_KEY);
      return true;
    } catch {
      return false; // storage full or blocked
    }
  }

  /**
   * Keeps a ride to upload later (replacing an earlier copy of the same ride).
   * Returns 'saved', 'trimmed' (kept without its 1-second samples to fit), or
   * 'failed' (couldn't store it at all).
   */
  add(userId: string, activity: Activity): 'saved' | 'trimmed' | 'failed' {
    const others = this.list().filter((r) => r.userId !== userId || r.activity.id !== activity.id);
    if (others.length >= MAX_QUEUED) return 'failed';
    const entry = (a: Activity): QueuedRide => ({ userId, activity: a, attempts: 0, queuedAt: new Date().toISOString() });
    const rows = [...others, entry(activity)];
    if (this.write(rows)) return 'saved';
    // Too big for the browser's storage: drop the samples of this ride, then of the others.
    const lean = (a: Activity): Activity => ({ ...a, samples: null });
    if (this.write([...others, entry(lean(activity))])) return 'trimmed';
    if (this.write([...others.map((r) => ({ ...r, activity: lean(r.activity) })), entry(lean(activity))])) return 'trimmed';
    return 'failed';
  }

  /**
   * Uploads this rider's queued rides, oldest first. Stops at the first failure
   * (the connection is probably still down) so the rest aren't charged an attempt.
   * Only one flush runs at a time.
   */
  flush(userId: string | null | undefined, retry = false): Promise<FlushResult> {
    if (!userId || !this.isCurrentUser(userId)) return Promise.resolve({ uploaded: [], failed: false, paused: [] });
    if (this.flushing) {
      if (this.flushingUser === userId) return this.flushing;
      return this.flushing.then(() => this.flush(userId, retry));
    }
    if (retry) this.write(this.list().map((r) => r.userId === userId ? { ...r, attempts: 0 } : r));
    this.flushingUser = userId;
    this.flushing = this.run(userId, this.generation).finally(() => { this.flushing = null; this.flushingUser = null; });
    return this.flushing;
  }

  /** An account transition stops the next upload, even if the same rider signs back in before this one returns. */
  stop() {
    this.generation++;
  }

  private async run(userId: string, generation: number): Promise<FlushResult> {
    const result: FlushResult = { uploaded: [], failed: false, paused: [] };
    while (generation === this.generation && this.isCurrentUser(userId)) {
      const row = this.list().find((r) => r.userId === userId && r.attempts < MAX_ATTEMPTS);
      if (!row) break;
      const snapshot = JSON.stringify(row.activity);
      const matches = (r: QueuedRide) => r.userId === userId && r.activity.id === row.activity.id && JSON.stringify(r.activity) === snapshot;
      try {
        await this.upload(row.activity, userId);
        const i = result.uploaded.findIndex((a) => a.id === row.activity.id);
        if (i < 0) result.uploaded.push(row.activity);
        else result.uploaded[i] = row.activity;
        // A newer autosave of this id may have arrived while the upload was pending.
        if (!this.write(this.list().filter((r) => !matches(r)))) break;
      } catch {
        if (generation !== this.generation || !this.isCurrentUser(userId)) break;
        result.failed = true;
        if (this.online()) {
          const attempts = row.attempts + 1;
          const rows = this.list();
          if (attempts >= MAX_ATTEMPTS && rows.some(matches)) result.paused.push(row.activity);
          this.write(rows.map((r) => (matches(r) ? { ...r, attempts } : r)));
        }
        break;
      }
    }
    return result;
  }
}
