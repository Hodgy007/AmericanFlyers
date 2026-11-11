// Cycling Power Service (0x1818): the parsing and subscription shared by a trainer that only offers
// power (trainer.ts) and a separate power meter (powerMeter.ts).

import type { TrainerReading } from './trainer';
import { notificationView } from './notification';

export const CPS_SERVICE = 0x1818;
export const CPS_MEASUREMENT = 0x2a63;

/**
 * Subscribes to Cycling Power Measurement on a connected service and reports each parsed reading.
 * A short or malformed packet is skipped rather than thrown from the notification handler.
 */
export async function subscribeCyclingPower(service: BluetoothRemoteGATTService, onReading: (r: TrainerReading) => void): Promise<void> {
  const measurement = await service.getCharacteristic(CPS_MEASUREMENT);
  const cadence = new CrankCadence();
  measurement.addEventListener('characteristicvaluechanged', (event) => {
    const v = notificationView(event, measurement);
    if (!v) return;
    let r: TrainerReading;
    try { r = parseCyclingPower(v, cadence); } catch { return; }
    if (r.power !== undefined) onReading(r);
  });
  await measurement.startNotifications();
}

/** Parses a Cycling Power Measurement notification; derives cadence from crank events. Short packets give what could be read. */
export function parseCyclingPower(view: DataView, cadence: CrankCadence): TrainerReading {
  const out: TrainerReading = {};
  if (view.byteLength < 4) return out; // flags + power
  const flags = view.getUint16(0, true);
  out.power = view.getInt16(2, true);
  let i = 4;
  if (flags & 0x0001) i += 1; // pedal power balance
  if (flags & 0x0004) i += 2; // accumulated torque
  if (flags & 0x0010) i += 6; // wheel revolution data
  if (flags & 0x0020 && i + 4 <= view.byteLength) {
    out.cadence = cadence.update(view.getUint16(i, true), view.getUint16(i + 2, true));
  }
  return out;
}

/** Turns cumulative crank revolutions + event time (1/1024 s) into rpm. */
export class CrankCadence {
  private lastRevs = -1;
  private lastTime = 0;
  private lastChange = 0;
  private rpm = 0;

  update(revs: number, eventTime: number, now = performance.now()): number {
    if (this.lastRevs >= 0) {
      const dRevs = (revs - this.lastRevs + 0x10000) & 0xffff;
      const dTime = (eventTime - this.lastTime + 0x10000) & 0xffff;
      if (dRevs > 0 && dTime > 0) {
        this.rpm = (dRevs * 1024 * 60) / dTime;
        this.lastChange = now;
      } else if (now - this.lastChange > 2500) {
        this.rpm = 0; // no new crank event for a while: stopped pedalling
      }
    }
    this.lastRevs = revs;
    this.lastTime = eventTime;
    return Math.round(this.rpm);
  }
}
