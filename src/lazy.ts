// Code that isn't needed for the first frame loads on first use. Each dialog or
// feature wraps its module in a `lazy(() => import('./thing'))`; `use()` runs
// something with it as soon as it has arrived (showing a small busy state on the
// button meanwhile), and `prefetchWhenIdle()` fetches the likely ones quietly
// after the first frame, so by the time someone taps they are usually cached.
// See docs/developer-guide/architecture.md ("Lazy loading").

export interface Lazy<T> {
  /** Loads it (once); every caller gets the same promise. A failed load can be tried again. */
  get(): Promise<T>;
  /** The loaded value, or null while it hasn't arrived. */
  peek(): T | null;
  /** Starts loading without waiting or complaining. */
  prefetch(): void;
}

export function lazy<T>(load: () => Promise<T>): Lazy<T> {
  let value: T | null = null;
  let pending: Promise<T> | null = null;
  const self: Lazy<T> = {
    get() {
      pending ??= load().then(
        (v) => (value = v),
        (e) => { pending = null; throw e; },
      );
      return pending;
    },
    peek: () => value,
    prefetch() { self.get().catch(() => {}); },
  };
  return self;
}

let reportError: (msg: string) => void = () => {};
/** Where "couldn't load" messages go (main.ts passes its toast). */
export function onLazyError(fn: (msg: string) => void) {
  reportError = fn;
}

let frameShown: () => void = () => {};
/** Settles once the 3D world has drawn its first frame; things that can wait (hero videos, prefetching) hang off it. */
export const firstFrame: Promise<void> = new Promise((resolve) => { frameShown = resolve; });
export function markFirstFrame() { frameShown(); }

const BUSY_DELAY_MS = 150; // loads that finish faster than this show nothing

/**
 * Runs `fn` with the module once it has loaded. While it loads (and only if that
 * takes a moment) `busy` gets the `lazy-busy` class and `aria-busy`.
 */
export function use<T>(l: Lazy<T>, fn: (m: T) => void | Promise<void>, busy?: Element | null): Promise<void> {
  const ready = l.peek();
  if (ready) return Promise.resolve(fn(ready));
  const timer = window.setTimeout(() => { busy?.classList.add('lazy-busy'); busy?.setAttribute('aria-busy', 'true'); }, BUSY_DELAY_MS);
  return l.get().then(
    (m) => { clearBusy(timer, busy); return fn(m); },
    () => { clearBusy(timer, busy); reportError('Couldn’t load that. Check your connection and try again.'); },
  );
}

function clearBusy(timer: number, busy?: Element | null) {
  window.clearTimeout(timer);
  busy?.classList.remove('lazy-busy');
  busy?.removeAttribute('aria-busy');
}

/**
 * For a module that wires its own click handler onto a button when it is built
 * (the Events and Leaderboard dialogs): the first click loads the module, which
 * adds the real handler, and then the click is replayed so it does its job.
 */
export function loadOnClick(button: HTMLElement | null, l: Lazy<unknown>) {
  if (!button) return;
  const stub = () => {
    button.removeEventListener('click', stub);
    if (l.peek()) return; // already built (prefetched): its own handler runs next in this same click
    use(l, () => button.click(), button).then(() => {
      // A failed load: put the stub back so the next click tries again.
      if (!l.peek()) button.addEventListener('click', stub);
    });
  };
  button.addEventListener('click', stub);
}

type Idle = (cb: () => void, timeout: number) => void;
const whenIdle: Idle = (cb, timeout) => {
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(cb, { timeout });
  else window.setTimeout(cb, Math.min(timeout, 1500));
};

/** True on a metered or slow connection, where guessing at what the rider will open next would cost them. */
function saveData() {
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return !!c && (c.saveData === true || /(^|-)2g$/.test(c.effectiveType ?? ''));
}

/**
 * Fetches these modules one at a time, each in a spare moment, starting `after`
 * ms from now (call it once the first frame is on screen). Skipped on data saver.
 */
export function prefetchWhenIdle(items: Lazy<unknown>[], after = 1500) {
  if (saveData()) return;
  const queue = [...items];
  const next = () => {
    const l = queue.shift();
    if (!l) return;
    l.prefetch();
    whenIdle(next, 3000);
  };
  window.setTimeout(() => whenIdle(next, 3000), after);
}
