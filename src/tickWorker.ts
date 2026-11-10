// A background ticker for when the tab is hidden. Browsers throttle main-thread timers and stop animation frames in
// hidden tabs (a timer may fire only once a minute), but a dedicated Web Worker's timers are not throttled that way,
// so a tiny worker posts a tick every ~250 ms and the ride is stepped from it. Fails silently where workers are
// unavailable (the ride then simply pauses while hidden, as it did before).

export const TICK_MS = 250;

/** Calls `onTick` about every 250 ms from a worker thread. Returns a stop function, or null if there is no worker. */
export function startBackgroundTicker(onTick: () => void): (() => void) | null {
  try {
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return null;
    const url = URL.createObjectURL(new Blob([`setInterval(function () { postMessage(0); }, ${TICK_MS});`], { type: 'text/javascript' }));
    const worker = new Worker(url); // (the one blob URL lives as long as the page: revoking it early can stop the worker loading)
    worker.onmessage = () => onTick();
    worker.onerror = () => {}; // a worker that can't run: carry on without it
    return () => worker.terminate();
  } catch {
    return null;
  }
}
