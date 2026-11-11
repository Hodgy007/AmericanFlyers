// Optional separate power meter (crank or pedals) over the Cycling Power Service. Its watts and cadence
// replace the trainer's own while it is sending (see powerSource.ts); the trainer still takes resistance.

import { CPS_SERVICE, subscribeCyclingPower } from './cyclingPower';
import { onGattDrop } from './remembered';
import type { TrainerReading } from './trainer';

export interface PowerMeter {
  readonly name: string;
  disconnect(): void;
}

/**
 * Asks the browser for a power meter. With no name: the chooser of every Cycling Power device.
 * With a name (a remembered meter): a chooser that lists just that device. Needs a user gesture.
 */
export function requestPowerMeterDevice(name?: string): Promise<BluetoothDevice> {
  return navigator.bluetooth.requestDevice(
    name ? { filters: [{ name }], optionalServices: [CPS_SERVICE] } : { filters: [{ services: [CPS_SERVICE] }] },
  );
}

/** Connects to a meter the browser already knows and subscribes to it. Safe to call again on the same device after a drop. */
export async function openPowerMeter(
  device: BluetoothDevice,
  onReading: (r: TrainerReading) => void,
  onDisconnect: () => void,
): Promise<PowerMeter> {
  const drop = onGattDrop(device, onDisconnect);
  try {
    const server = await device.gatt!.connect();
    await subscribeCyclingPower(await server.getPrimaryService(CPS_SERVICE), onReading);
    drop.arm();
    return { name: device.name ?? 'Power meter', disconnect: () => device.gatt?.disconnect() };
  } catch (err) {
    try { device.gatt?.disconnect(); } catch { /* already gone */ }
    throw err;
  }
}
