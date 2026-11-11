// A free list of built things (here: other riders' models) so that something leaving the shown
// set can be handed to the next arrival instead of being disposed and rebuilt. Kept separate
// from three so the bookkeeping is testable with plain objects.

export interface PoolStats {
  /** Items built by the factory. */
  created: number;
  /** Acquires served from the free list. */
  reused: number;
  /** Items handed to `dispose` (surplus over the cap, idle trims and `clear()`). */
  disposed: number;
}

export interface PoolOptions<T, A> {
  make(key: string, arg: A): T;
  dispose(item: T): void;
  /** Most free items kept per key (a number or a function of the key); a surplus release is disposed. 0 keeps none (every acquire builds). */
  cap: number | ((key: string) => number);
  /** Free items older than this (ms since the last acquire for that key) are disposed by `trim()`. */
  idleMs?: number;
}

export class Pool<T, A = undefined> {
  private readonly free = new Map<string, T[]>();
  private readonly lastUse = new Map<string, number>();
  readonly stats: PoolStats = { created: 0, reused: 0, disposed: 0 };

  constructor(private readonly opts: PoolOptions<T, A>) {}

  /** A free item for `key` if there is one (the caller re-skins it), else one freshly built by `make(key, arg)` (so `arg` can carry what a new item should start as). */
  acquire(key: string, now: number, arg: A): T {
    this.lastUse.set(key, now);
    const item = this.free.get(key)?.pop();
    if (item !== undefined) { this.stats.reused++; return item; }
    this.stats.created++;
    return this.opts.make(key, arg);
  }

  /** Takes an item back; disposes it if the free list for its key is full. */
  release(key: string, item: T) {
    let list = this.free.get(key);
    if (!list) this.free.set(key, (list = []));
    if (list.length >= (typeof this.opts.cap === 'number' ? this.opts.cap : this.opts.cap(key))) { this.stats.disposed++; this.opts.dispose(item); return; }
    list.push(item);
  }

  /** Disposes free items of any key that hasn't been acquired for `idleMs`. Call now and then. */
  trim(now: number) {
    const idle = this.opts.idleMs;
    if (idle === undefined) return;
    for (const [key, list] of this.free) {
      if (!list.length || now - (this.lastUse.get(key) ?? 0) < idle) continue;
      for (const item of list) { this.stats.disposed++; this.opts.dispose(item); }
      list.length = 0;
    }
  }

  /** Disposes every free item. */
  clear() {
    for (const list of this.free.values()) {
      for (const item of list) { this.stats.disposed++; this.opts.dispose(item); }
      list.length = 0;
    }
  }

  freeCount(key?: string) {
    if (key !== undefined) return this.free.get(key)?.length ?? 0;
    let n = 0;
    for (const list of this.free.values()) n += list.length;
    return n;
  }
}
