// Optional Bluetooth heart-rate strap (standard Heart Rate Service).

import { onGattDrop } from './remembered';

const HR_SERVICE = 0x180d;
const HR_MEASUREMENT = 0x2a37;

export interface HeartRateMonitor {
  readonly name: string;
  disconnect(): void;
}

/**
 * Asks the browser for a strap. With no name: the chooser of every heart-rate device. With a name
 * (a remembered strap): a chooser that lists just that device. Needs a user gesture.
 */
export function requestHeartRateDevice(name?: string): Promise<BluetoothDevice> {
  return navigator.bluetooth.requestDevice(
    name ? { filters: [{ name }], optionalServices: [HR_SERVICE] } : { filters: [{ services: [HR_SERVICE] }] },
  );
}

/** Connects to a strap the browser already knows and subscribes to it. Safe to call again on the same device after a drop. */
export async function openHeartRate(
  device: BluetoothDevice,
  onBpm: (bpm: number) => void,
  onDisconnect: () => void,
): Promise<HeartRateMonitor> {
  const drop = onGattDrop(device, onDisconnect);
  try {
    const server = await device.gatt!.connect();
    const char = await (await server.getPrimaryService(HR_SERVICE)).getCharacteristic(HR_MEASUREMENT);
    char.addEventListener('characteristicvaluechanged', () => onBpm(parseHeartRate(char.value!)));
    await char.startNotifications();
    drop.arm();
    return { name: device.name ?? 'Heart rate', disconnect: () => device.gatt?.disconnect() };
  } catch (err) {
    try { device.gatt?.disconnect(); } catch { /* already gone */ }
    throw err;
  }
}

export async function connectHeartRate(
  onBpm: (bpm: number) => void,
  onDisconnect: () => void,
  name?: string,
): Promise<HeartRateMonitor> {
  return openHeartRate(await requestHeartRateDevice(name), onBpm, onDisconnect);
}

export function parseHeartRate(view: DataView): number {
  const flags = view.getUint8(0);
  return flags & 0x01 ? view.getUint16(1, true) : view.getUint8(1);
}
