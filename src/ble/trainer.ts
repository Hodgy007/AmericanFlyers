// Bluetooth smart-trainer connection.
//
// Prefers the standard Fitness Machine Service (FTMS), which current Wahoo
// KICKR / KICKR CORE / KICKR SNAP firmware exposes: it gives power + cadence
// and lets us push the virtual road grade to the trainer as resistance.
// Falls back to the Cycling Power Service (read-only) for older firmware.

export interface TrainerReading {
  power?: number; // watts
  cadence?: number; // rpm
  speedKmh?: number; // trainer-reported speed (informational only)
  heartRate?: number; // bpm, if the trainer relays a strap
}

export interface Trainer {
  readonly name: string;
  /** True when the trainer accepts resistance (grade) commands. */
  readonly canControl: boolean;
  setGrade(gradePercent: number): Promise<void>;
  /** ERG mode: the trainer holds this power regardless of cadence. */
  setTargetPower(watts: number): Promise<void>;
  disconnect(): void;
}

export interface TrainerCallbacks {
  onReading(reading: TrainerReading): void;
  onDisconnect(): void;
}

const FTMS_SERVICE = 0x1826;
const FTMS_INDOOR_BIKE_DATA = 0x2ad2;
const FTMS_CONTROL_POINT = 0x2ad9;
const CPS_SERVICE = 0x1818;
const CPS_MEASUREMENT = 0x2a63;

const OP_REQUEST_CONTROL = 0x00;
const OP_START_RESUME = 0x07;
const OP_SET_TARGET_POWER = 0x05;
const OP_SET_SIM_PARAMS = 0x11;
const OP_RESPONSE = 0x80;
const RESULT_SUCCESS = 0x01;

export function bluetoothAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

export async function connectTrainer(cb: TrainerCallbacks): Promise<Trainer> {
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [FTMS_SERVICE] }, { services: [CPS_SERVICE] }],
    optionalServices: [FTMS_SERVICE, CPS_SERVICE],
  });
  const server = await device.gatt!.connect();
  device.addEventListener('gattserverdisconnected', () => cb.onDisconnect());

  const ftms = await server.getPrimaryService(FTMS_SERVICE).catch(() => null);
  if (ftms) return connectFtms(device, ftms, cb);

  const cps = await server.getPrimaryService(CPS_SERVICE);
  return connectCyclingPower(device, cps, cb);
}

// ---------------------------------------------------------------- FTMS ----

async function connectFtms(
  device: BluetoothDevice,
  service: BluetoothRemoteGATTService,
  cb: TrainerCallbacks,
): Promise<Trainer> {
  const bikeData = await service.getCharacteristic(FTMS_INDOOR_BIKE_DATA);
  bikeData.addEventListener('characteristicvaluechanged', () => {
    cb.onReading(parseIndoorBikeData(bikeData.value!));
  });
  await bikeData.startNotifications();

  const control = new ControlPoint(await service.getCharacteristic(FTMS_CONTROL_POINT).catch(() => null));
  let canControl = false;
  if (control.available) {
    await control.start();
    canControl = await control.send(new Uint8Array([OP_REQUEST_CONTROL]));
    if (canControl) await control.send(new Uint8Array([OP_START_RESUME]));
  }

  return {
    name: device.name ?? 'Smart trainer',
    canControl,
    async setTargetPower(watts: number) {
      if (!canControl) return;
      const buf = new DataView(new ArrayBuffer(3));
      buf.setUint8(0, OP_SET_TARGET_POWER);
      buf.setInt16(1, Math.round(clamp(watts, 0, 2000)), true); // 1 W resolution
      await control.send(new Uint8Array(buf.buffer));
    },
    async setGrade(gradePercent: number) {
      if (!canControl) return;
      const buf = new DataView(new ArrayBuffer(7));
      buf.setUint8(0, OP_SET_SIM_PARAMS);
      buf.setInt16(1, 0, true); // wind speed, 0.001 m/s
      buf.setInt16(3, Math.round(clamp(gradePercent, -20, 20) * 100), true); // grade, 0.01 %
      buf.setUint8(5, 40); // rolling resistance coefficient, 0.0001 → 0.004
      buf.setUint8(6, 51); // wind resistance coefficient, 0.01 kg/m → 0.51
      await control.send(new Uint8Array(buf.buffer));
    },
    disconnect: () => device.gatt?.disconnect(),
  };
}

/** Parses an FTMS Indoor Bike Data notification (Bluetooth FTMS spec §4.9). */
export function parseIndoorBikeData(view: DataView): TrainerReading {
  const flags = view.getUint16(0, true);
  const out: TrainerReading = {};
  let i = 2;
  // Bit 0 is "More Data": when it is CLEAR, instantaneous speed is present.
  if (!(flags & 0x0001)) { out.speedKmh = view.getUint16(i, true) / 100; i += 2; }
  if (flags & 0x0002) i += 2; // average speed
  if (flags & 0x0004) { out.cadence = view.getUint16(i, true) / 2; i += 2; }
  if (flags & 0x0008) i += 2; // average cadence
  if (flags & 0x0010) i += 3; // total distance
  if (flags & 0x0020) i += 2; // resistance level
  if (flags & 0x0040) { out.power = view.getInt16(i, true); i += 2; }
  if (flags & 0x0080) i += 2; // average power
  if (flags & 0x0100) i += 5; // expended energy
  if (flags & 0x0200) { out.heartRate = view.getUint8(i); i += 1; }
  return out;
}

/** Serialises writes to the FTMS control point and waits for each response. */
class ControlPoint {
  private queue: Promise<unknown> = Promise.resolve();
  private pending: ((ok: boolean) => void) | null = null;

  constructor(private readonly char: BluetoothRemoteGATTCharacteristic | null) {}

  get available() { return this.char !== null; }

  async start() {
    if (!this.char) return;
    this.char.addEventListener('characteristicvaluechanged', () => {
      const v = this.char!.value!;
      if (v.byteLength >= 3 && v.getUint8(0) === OP_RESPONSE) {
        this.pending?.(v.getUint8(2) === RESULT_SUCCESS);
        this.pending = null;
      }
    });
    await this.char.startNotifications();
  }

  send(payload: Uint8Array<ArrayBuffer>): Promise<boolean> {
    const run = async () => {
      if (!this.char) return false;
      const response = new Promise<boolean>((resolve) => {
        this.pending = resolve;
        setTimeout(() => { if (this.pending === resolve) { this.pending = null; resolve(false); } }, 3000);
      });
      await this.char.writeValueWithResponse(payload);
      return response;
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => false);
    return result;
  }
}

// ------------------------------------------------------- Cycling Power ----

async function connectCyclingPower(
  device: BluetoothDevice,
  service: BluetoothRemoteGATTService,
  cb: TrainerCallbacks,
): Promise<Trainer> {
  const measurement = await service.getCharacteristic(CPS_MEASUREMENT);
  const cadence = new CrankCadence();
  measurement.addEventListener('characteristicvaluechanged', () => {
    cb.onReading(parseCyclingPower(measurement.value!, cadence));
  });
  await measurement.startNotifications();

  return {
    name: device.name ?? 'Power meter',
    canControl: false,
    setGrade: async () => {},
    setTargetPower: async () => {},
    disconnect: () => device.gatt?.disconnect(),
  };
}

/** Parses a Cycling Power Measurement notification; derives cadence from crank events. */
export function parseCyclingPower(view: DataView, cadence: CrankCadence): TrainerReading {
  const flags = view.getUint16(0, true);
  const out: TrainerReading = { power: view.getInt16(2, true) };
  let i = 4;
  if (flags & 0x0001) i += 1; // pedal power balance
  if (flags & 0x0004) i += 2; // accumulated torque
  if (flags & 0x0010) i += 6; // wheel revolution data
  if (flags & 0x0020) {
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

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
