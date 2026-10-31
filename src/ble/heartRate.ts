// Optional Bluetooth heart-rate strap (standard Heart Rate Service).

const HR_SERVICE = 0x180d;
const HR_MEASUREMENT = 0x2a37;

export interface HeartRateMonitor {
  readonly name: string;
  disconnect(): void;
}

export async function connectHeartRate(
  onBpm: (bpm: number) => void,
  onDisconnect: () => void,
): Promise<HeartRateMonitor> {
  const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [HR_SERVICE] }] });
  const server = await device.gatt!.connect();
  device.addEventListener('gattserverdisconnected', onDisconnect);
  const char = await (await server.getPrimaryService(HR_SERVICE)).getCharacteristic(HR_MEASUREMENT);
  char.addEventListener('characteristicvaluechanged', () => onBpm(parseHeartRate(char.value!)));
  await char.startNotifications();
  return { name: device.name ?? 'Heart rate', disconnect: () => device.gatt?.disconnect() };
}

export function parseHeartRate(view: DataView): number {
  const flags = view.getUint8(0);
  return flags & 0x01 ? view.getUint16(1, true) : view.getUint8(1);
}
