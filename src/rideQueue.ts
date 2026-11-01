// Rides that couldn't be saved (no connection, or the server didn't answer)
// wait here, on this device, and upload when the connection is back. Saving is
// an upsert by the ride's own id, so sending one twice never duplicates it.
//
// Each queued ride remembers whose it is: it only uploads while that rider is
// signed in. If the browser's storage is too full for a long ride's 1-second
// samples, the ride is kept without them (the summary still saves).

import type { Activity } from './cloud/sync';

export const QUEUE_KEY = 'americanflyers.rideQueue';
export const MAX_QUEUED = 20; // oldest dropped beyond this
export const MAX_ATTEMPTS = 12; // failed uploads while online before a ride is given up on

export interface QueuedRide {
  userId: string;
  activity: Activity;
  attempts: number; // uploads that failed while the browser said it was online
  queuedAt: string;
}

export interface FlushResult {
  uploaded: Activity[];
  failed: boolean; // stopped at an upload that failed (still queued)
  givenUp: Activity[]; // failed too many times while online: removed
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export class RideQueue {
  private flushing: Promise<FlushResult> | null = null;

  constructor(
    private readonly store: Store | null,
    private readonly upload: (a: Activity) => Promise<void>,
    private readonly online: () => boolean = () => true,
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
    const others = this.list().filter((r) => r.activity.id !== activity.id);
    const entry = (a: Activity): QueuedRide => ({ userId, activity: a, attempts: 0, queuedAt: new Date().toISOString() });
    const rows = [...others, entry(activity)].slice(-MAX_QUEUED);
    if (this.write(rows)) return 'saved';
    // Too big for the browser's storage: drop the samples of this ride, then of the others.
    const lean = (a: Activity): Activity => ({ ...a, samples: null });
    if (this.write([...others, entry(lean(activity))].slice(-MAX_QUEUED))) return 'trimmed';
    if (this.write([...others.map((r) => ({ ...r, activity: lean(r.activity) })), entry(lean(activity))].slice(-MAX_QUEUED))) return 'trimmed';
    return 'failed';
  }

  /**
   * Uploads this rider's queued rides, oldest first. Stops at the first failure
   * (the connection is probably still down) so the rest aren't charged an attempt.
   * Only one flush runs at a time.
   */
  flush(userId: string | null | undefined): Promise<FlushResult> {
    if (!userId) return Promise.resolve({ uploaded: [], failed: false, givenUp: [] });
    this.flushing ??= this.run(userId).finally(() => { this.flushing = null; });
    return this.flushing;
  }

  private async run(userId: string): Promise<FlushResult> {
    const result: FlushResult = { uploaded: [], failed: false, givenUp: [] };
    for (const row of this.list().filter((r) => r.userId === userId)) {
      try {
        await this.upload(row.activity);
        result.uploaded.push(row.activity);
        this.write(this.list().filter((r) => r.activity.id !== row.activity.id));
      } catch {
        result.failed = true;
        if (this.online()) {
          // Online but it still failed: count it, and stop trying after MAX_ATTEMPTS.
          const attempts = row.attempts + 1;
          const rows = this.list();
          if (attempts >= MAX_ATTEMPTS) {
            result.givenUp.push(row.activity);
            this.write(rows.filter((r) => r.activity.id !== row.activity.id));
          } else {
            this.write(rows.map((r) => (r.activity.id === row.activity.id ? { ...r, attempts } : r)));
          }
        }
        break;
      }
    }
    return result;
  }
}
