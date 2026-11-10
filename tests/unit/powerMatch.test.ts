import { describe, expect, it } from 'vitest';
import { MAX_CORRECTION, PowerMatch } from '../../src/ble/powerMatch';

/** A trainer whose own power reading is `bias` times the meter's: holding S on the trainer gives the meter S / bias. */
function simulate(match: PowerMatch, target: number, bias: number, seconds: number, pedalling = true) {
  let sent = target;
  let meter = target / bias;
  for (let i = 0; i < seconds; i++) {
    meter = sent / bias; // the rider's legs settle on what the trainer holds
    sent = match.update({ target, meterWatts: meter, pedalling, dt: 1 });
  }
  return { sent, meter };
}

describe('PowerMatch', () => {
  it('sends the target itself until a correction builds up', () => {
    const m = new PowerMatch();
    expect(m.update({ target: 200, meterWatts: 200, pedalling: true, dt: 1 })).toBe(200);
  });

  it('converges so the meter sits on the target when the trainer reads 5 % high', () => {
    const m = new PowerMatch();
    const { sent, meter } = simulate(m, 200, 1.05, 150);
    expect(meter).toBeGreaterThan(199);
    expect(meter).toBeLessThan(201);
    expect(sent).toBeCloseTo(210, 0); // asked for ~5 % more on the trainer
  });

  it('converges the other way when the trainer reads low', () => {
    const { meter } = simulate(new PowerMatch(), 200, 0.96, 150);
    expect(meter).toBeGreaterThan(199);
    expect(meter).toBeLessThan(201);
  });

  it('is slow: not a jump in the first second or two', () => {
    const m = new PowerMatch();
    const { sent } = simulate(m, 200, 1.05, 2);
    expect(Math.abs(sent - 200)).toBeLessThan(2);
  });

  it('never corrects by more than 10 % of the target', () => {
    const m = new PowerMatch();
    const { sent } = simulate(m, 200, 1.4, 600); // an absurd 40 % difference
    expect(sent).toBeLessThanOrEqual(200 * (1 + MAX_CORRECTION) + 1e-9);
    expect(m.correction).toBeCloseTo(20, 5);
  });

  it('resets on a step change, but not on a ramp', () => {
    const m = new PowerMatch();
    simulate(m, 200, 1.05, 60);
    expect(m.correction).toBeGreaterThan(5);
    // A ramp moves the target a watt at a time: the correction carries on.
    m.update({ target: 201, meterWatts: 190, pedalling: true, dt: 1 });
    expect(m.correction).toBeGreaterThan(5);
    // A new step 100 W up starts again from the plain target.
    expect(m.update({ target: 300, meterWatts: 200, pedalling: true, dt: 1 })).toBeCloseTo(300, 0);
    expect(Math.abs(m.correction)).toBeLessThan(1);
  });

  it('holds the correction while not pedalling', () => {
    const m = new PowerMatch();
    simulate(m, 200, 1.05, 60);
    const before = m.correction;
    for (let i = 0; i < 30; i++) m.update({ target: 200, meterWatts: 0, pedalling: false, dt: 1 });
    expect(m.correction).toBe(before);
  });

  it('reset() forgets the correction', () => {
    const m = new PowerMatch();
    simulate(m, 200, 1.05, 60);
    m.reset();
    expect(m.correction).toBe(0);
  });
});
