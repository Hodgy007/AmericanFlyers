// Running ride statistics while the rider is moving. Averages and energy use
// exact elapsed time; normalized power, max and best minute use 1 s samples.

export class RideStats {
  seconds = 0; // moving time, exact
  work = 0; // joules
  maxPower = 0;
  maxHr = 0;
  best60 = 0; // best 60-second average power
  private cadSum = 0; // cadence × time while pedalling
  private cadTime = 0;
  private hrSum = 0;
  private hrTime = 0;
  private np4Sum = 0;
  private npN = 0;
  private readonly last30: number[] = [];
  private readonly last60: number[] = [];
  private acc = 0;
  private pAcc = 0;

  add(dt: number, power: number, cadence: number, hr: number, moving: boolean) {
    if (!moving || dt <= 0) return;
    this.seconds += dt;
    this.work += power * dt;
    if (cadence > 0) { this.cadSum += cadence * dt; this.cadTime += dt; }
    if (hr > 0) { this.hrSum += hr * dt; this.hrTime += dt; this.maxHr = Math.max(this.maxHr, hr); }
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
    this.last60.push(p);
    if (this.last60.length > 60) this.last60.shift();
    if (this.last60.length === 60) this.best60 = Math.max(this.best60, this.last60.reduce((a, b) => a + b, 0) / 60);
  }

  get avgPower() { return this.seconds ? this.work / this.seconds : 0; }
  get avgCadence() { return this.cadTime ? this.cadSum / this.cadTime : 0; }
  get avgHr() { return this.hrTime ? this.hrSum / this.hrTime : 0; }
  get np() { return this.npN ? (this.np4Sum / this.npN) ** 0.25 : this.avgPower; }

  tss(ftp: number) {
    const intensity = this.np / ftp;
    return (this.seconds / 3600) * intensity * intensity * 100;
  }
}
