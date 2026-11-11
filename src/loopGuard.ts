// Keeps the ride loop alive when one frame throws. The caller wraps each part of a frame in `guard`; an exception is
// reported (rate-limited, so a bug that fires every frame doesn't flood the console or Sentry) and the loop carries on.
// After many failures in a row the rider is told once.

export const REPORT_EVERY_MS = 5000;
export const TOAST_AFTER_FAILURES = 120; // consecutive failures of one part (about two seconds of frames)

export interface GuardOutput {
  /** Log and send to monitoring. */
  report(part: string, error: unknown): void;
  /** One toast for the rider. */
  notify(): void;
}

export class LoopGuard {
  private readonly lastReport = new Map<string, number>();
  private readonly streak = new Map<string, number>();
  private toasted = false;

  constructor(private readonly out: GuardOutput, private readonly now: () => number = () => Date.now()) {}

  /** Runs `fn`; an exception is handled here. Returns whether it ran without one. */
  run(part: string, fn: () => void): boolean {
    try {
      fn();
      this.streak.delete(part);
      return true;
    } catch (e) {
      this.failed(part, e);
      return false;
    }
  }

  private failed(part: string, e: unknown) {
    const n = (this.streak.get(part) ?? 0) + 1;
    this.streak.set(part, n);
    const key = `${part}:${e instanceof Error ? e.message : String(e)}`;
    const t = this.now();
    const last = this.lastReport.get(key);
    if (last === undefined || t - last >= REPORT_EVERY_MS) {
      this.lastReport.set(key, t);
      if (this.lastReport.size > 50) this.lastReport.clear(); // errors with ever-changing text must not grow this forever
      try { this.out.report(part, e); } catch { /* reporting must never break the loop */ }
    }
    if (n >= TOAST_AFTER_FAILURES && !this.toasted) {
      this.toasted = true;
      try { this.out.notify(); } catch { /* ditto */ }
    }
  }
}
