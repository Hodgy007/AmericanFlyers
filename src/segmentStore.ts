// Your own best and latest effort on each KOM segment, kept in this browser (localStorage) so the live gap
// works signed out and offline. The account keeps them too (cloud/segmentApi.ts); the two are merged when
// a segment is approached. Every read and write is guarded: storage can be missing or full.

import type { Effort } from './segments';

export interface SegmentRecord {
  best?: Effort;
  last?: Effort;
}

type Storage_ = Pick<Storage, 'getItem' | 'setItem'>;

const KEY = 'americanflyers.segments';
const MAX_SEGMENTS = 120; // the oldest are dropped past this (uploaded routes add their own)

function valid(e: unknown): e is Effort {
  const x = e as Effort | null;
  return !!x && typeof x.t === 'number' && x.t > 0 && Array.isArray(x.s) && x.s.every((n) => typeof n === 'number') && typeof x.p === 'number' && typeof x.at === 'number';
}

export class SegmentStore {
  private data: Record<string, SegmentRecord> = {};

  constructor(private storage: Storage_ | null = defaultStorage()) {
    try {
      const raw = storage?.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, SegmentRecord>;
        for (const [id, r] of Object.entries(parsed ?? {})) {
          const rec: SegmentRecord = {};
          if (valid(r?.best)) rec.best = r.best;
          if (valid(r?.last)) rec.last = r.last;
          if (rec.best || rec.last) this.data[id] = rec;
        }
      }
    } catch { /* unreadable or blocked: start empty */ }
  }

  get(id: string): SegmentRecord {
    return this.data[id] ?? {};
  }

  /** Every segment with a stored effort. */
  ids(): string[] {
    return Object.keys(this.data);
  }

  /** Stores a finished effort as the latest, and as the best if it is faster. Returns the best you had before it (if any). */
  record(id: string, effort: Effort): { previousBest: Effort | undefined; isBest: boolean } {
    const rec = this.data[id] ?? (this.data[id] = {});
    const previousBest = rec.best;
    const isBest = !previousBest || effort.t < previousBest.t;
    if (isBest) rec.best = effort;
    rec.last = effort;
    this.save();
    return { previousBest, isBest };
  }

  /** Forgets everything (signing out: the next rider on this browser starts clean). */
  clear() {
    this.data = {};
    this.save();
  }

  /** Folds in what the account has (after signing in on another device): a faster best wins, and a newer latest. */
  merge(id: string, best: Effort | null | undefined, last: Effort | null | undefined) {
    let changed = false;
    const rec = this.data[id] ?? {};
    if (valid(best) && (!rec.best || best.t < rec.best.t)) { rec.best = best; changed = true; }
    if (valid(last) && (!rec.last || last.at > rec.last.at)) { rec.last = last; changed = true; }
    if (changed) { this.data[id] = rec; this.save(); }
    return changed;
  }

  private save() {
    const ids = Object.keys(this.data);
    if (ids.length > MAX_SEGMENTS) {
      const when = (id: string) => this.data[id].last?.at ?? this.data[id].best?.at ?? 0;
      for (const id of ids.sort((a, b) => when(a) - when(b)).slice(0, ids.length - MAX_SEGMENTS)) delete this.data[id];
    }
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.data));
    } catch { /* full or blocked: it still works for this session */ }
  }
}

let shared: SegmentStore | null = null;

/** The one store the ride, the hub and sign-out all use. */
export function sharedSegmentStore(): SegmentStore {
  return (shared ??= new SegmentStore());
}

function defaultStorage(): Storage_ | null {
  try { return localStorage; } catch { return null; }
}

// Efforts that couldn't reach the account (offline): sent the next time there's a connection.
const PENDING_KEY = 'americanflyers.segments.pending';
export interface PendingEffort { user: string; stage_id: string; segment_id: string; elapsed_s: number; avg_power: number | null; splits: number[]; at: number }

export function pendingEfforts(storage: Storage_ | null = defaultStorage()): PendingEffort[] {
  try {
    const list = JSON.parse(storage?.getItem(PENDING_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((p) => p && typeof p.segment_id === 'string' && typeof p.elapsed_s === 'number') : [];
  } catch { return []; }
}

export function setPendingEfforts(list: PendingEffort[], storage: Storage_ | null = defaultStorage()) {
  try { storage?.setItem(PENDING_KEY, JSON.stringify(list.slice(-30))); } catch { /* ignore */ }
}
