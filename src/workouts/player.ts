// Runs a workout against the clock: current target, step, time left, and
// skip / pause / intensity controls.

import { expand, stepAt, targetAt, totalDuration, type Step, type Workout } from './model';

export class WorkoutPlayer {
  readonly steps: Step[];
  readonly duration: number;
  elapsed = 0;
  paused = false;
  intensity = 1; // multiplier the rider can nudge (±5 % steps)
  readonly trace: { t: number; ratio: number }[] = [];
  private traceAcc = 0;

  constructor(readonly workout: Workout, private readonly ftp: number) {
    this.steps = expand(workout.blocks);
    this.duration = totalDuration(this.steps);
  }

  get done() {
    return this.elapsed >= this.duration;
  }

  /** Advances the clock while the rider is pedalling and not paused. */
  tick(dt: number, pedalling: boolean, power: number) {
    if (this.paused || this.done || !pedalling) return;
    this.elapsed = Math.min(this.duration, this.elapsed + dt);
    this.traceAcc += dt;
    if (this.traceAcc >= 2) {
      this.traceAcc = 0;
      this.trace.push({ t: this.elapsed, ratio: power / this.ftp });
    }
  }

  get step(): Step | undefined {
    return stepAt(this.steps, this.elapsed);
  }

  get next(): Step | undefined {
    const s = this.step;
    return s ? this.steps[this.steps.indexOf(s) + 1] : undefined;
  }

  /** Target watts now, or null in free ride / after the end. */
  targetWatts(): number | null {
    const r = targetAt(this.steps, this.elapsed);
    return r === null ? null : Math.round(r * this.ftp * this.intensity);
  }

  stepWatts(s: Step) {
    return s.free ? null : Math.round(((s.start + s.end) / 2) * this.ftp * this.intensity);
  }

  stepRemaining() {
    const s = this.step;
    return s ? s.at + s.duration - this.elapsed : 0;
  }

  skip() {
    const s = this.step;
    if (s) this.elapsed = Math.min(this.duration, s.at + s.duration);
  }

  nudge(delta: number) {
    this.intensity = Math.max(0.5, Math.min(1.5, Math.round((this.intensity + delta) * 100) / 100));
  }
}
