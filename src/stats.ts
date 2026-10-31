// Running ride statistics while the rider is moving. Averages and energy use
// exact elapsed time; normalized power, max and best efforts use 1 s samples.

import { HR_ZONES, POWER_ZONES, zoneIndex } from './zones';

/** Durations (seconds) tracked for best average power. */
export const BEST_WINDOWS = [5, 60, 300, 1200] as const;

export class RideStats {
  /** Time (seconds) in each heart-rate and power zone. */
  readonly hrZones = HR_ZONES.map(() => 0);
  readonly powerZones = POWER_ZONES.map(() => 0);

  /** `refs` gives the rider's current FTP and max HR, used for zones. */
  constructor(private readonly refs: () => { ftp: number; maxHr: number } = () => ({ ftp: 200, maxHr: 185 })) {}

  seconds = 0; // moving time, exact
  work = 0; // joules
  maxPower = 0;
  maxHr = 0;
  /** Best average power over each of BEST_WINDOWS (seconds → watts). */
  readonly best: Record<number, number> = Object.fromEntries(BEST_WINDOWS.map((w) => [w, 0]));
  private readonly history: number[] = []; // last 1200 one-second samples
  private readonly sums: Record<number, number> = Object.fromEntries(BEST_WINDOWS.map((w) => [w, 0]));
  private cadSum = 0; // cadence × time while pedalling
  private cadTime = 0;
  private hrSum = 0;
  private hrTime = 0;
  private np4Sum = 0;
  private npN = 0;
  private readonly last30: number[] = [];
  private acc = 0;
  private pAcc = 0;

  add(dt: number, power: number, cadence: number, hr: number, moving: boolean) {
    if (!moving || dt <= 0) return;
    this.seconds += dt;
    this.work += power * dt;
    if (cadence > 0) { this.cadSum += cadence * dt; this.cadTime += dt; }
    const { ftp, maxHr } = this.refs();
    if (hr > 0) {
      this.hrSum += hr * dt; this.hrTime += dt; this.maxHr = Math.max(this.maxHr, hr);
      if (maxHr > 0) this.hrZones[zoneIndex(HR_ZONES, hr / maxHr)] += dt;
    }
    if (ftp > 0) this.powerZones[zoneIndex(POWER_ZONES, power / ftp)] += dt;
    this.acc += dt;
    this.pAcc += power * dt;
    if (this.acc >= 1) {
      // Close a 1 s sample. Any overshoot past 1 s carries into the next one.
      const p = this.pAcc / this.acc;
      const over = this.acc - 1;
      this.acc = over;
      this.pAcc = power * over;
      this.second(p);
    }
  }

  private second(p: number) {
    this.maxPower = Math.max(this.maxPower, p);
    this.last30.push(p);
    if (this.last30.length > 30) this.last30.shift();
    if (this.last30.length === 30) {
      // Normalized power: 4th-power mean of the 30 s rolling average.
      const avg30 = this.last30.reduce((a, b) => a + b, 0) / 30;
      this.np4Sum += avg30 ** 4;
      this.npN++;
    }
    // Rolling sums for each best-effort window.
    this.history.push(p);
    const n = this.history.length;
    for (const w of BEST_WINDOWS) {
      this.sums[w] += p;
      if (n > w) this.sums[w] -= this.history[n - 1 - w];
      if (n >= w) this.best[w] = Math.max(this.best[w], this.sums[w] / w);
    }
    if (n > BEST_WINDOWS[BEST_WINDOWS.length - 1]) this.history.shift();
  }

  /** Best one-minute average power. */
  get best60() { return this.best[60]; }

  get avgPower() { return this.seconds ? this.work / this.seconds : 0; }
  get avgCadence() { return this.cadTime ? this.cadSum / this.cadTime : 0; }
  get avgHr() { return this.hrTime ? this.hrSum / this.hrTime : 0; }
  get np() { return this.npN ? (this.np4Sum / this.npN) ** 0.25 : this.avgPower; }

  tss(ftp: number) {
    const intensity = this.np / ftp;
    return (this.seconds / 3600) * intensity * intensity * 100;
  }
}
