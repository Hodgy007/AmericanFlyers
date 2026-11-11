// Bluetooth smart-trainer connection.
//
// Prefers the standard Fitness Machine Service (FTMS), which current Wahoo
// KICKR / KICKR CORE / KICKR SNAP firmware exposes: it gives power + cadence
// and lets us push the virtual road grade to the trainer as resistance.
// Falls back to the Cycling Power Service (read-only) for older firmware.

import {
  ControlPoint, OP_SET_SIM_PARAMS, OP_SET_TARGET_POWER, RESULT_NOT_SENT, TrainerControl, isControlLostStatus,
  type ControlResult, type ControlState,
} from './control';
import { CPS_SERVICE, CrankCadence, parseCyclingPower, subscribeCyclingPower } from './cyclingPower';
import { onGattDrop } from './remembered';
import { notificationView } from './notification';

export { CrankCadence, parseCyclingPower };
export type { ControlResult, ControlState };

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
  /** "ok": resistance commands are taken; "lost": another app has control or the trainer stopped answering; "unavailable": it can't be controlled. */
  readonly controlState: ControlState;
  /**
   * Grade in %, an optional wind-resistance factor (below 1 in a draft) and an optional headwind in m/s (negative: tailwind).
   * Resolves with the outcome (`ok` false when the trainer refused, didn't answer, or is being left alone while control is lost); never rejects.
   */
  setGrade(gradePercent: number, windFactor?: number, headwindMs?: number): Promise<ControlResult>;
  /** ERG mode: the trainer holds this power regardless of cadence. Resolves like `setGrade`. */
  setTargetPower(watts: number): Promise<ControlResult>;
  disconnect(): void;
}

export interface TrainerCallbacks {
  onReading(reading: TrainerReading): void;
  onDisconnect(): void;
  /** The trainer lost or regained control of its resistance (not called for the first state). */
  onControlState?(state: ControlState): void;
}

const FTMS_SERVICE = 0x1826;
const FTMS_INDOOR_BIKE_DATA = 0x2ad2;
const FTMS_CONTROL_POINT = 0x2ad9;
const FTMS_MACHINE_STATUS = 0x2ada;

export function bluetoothAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

/**
 * Asks the browser for a trainer. With no name: the full chooser (any FTMS or Cycling Power device).
 * With a name (a remembered trainer): a chooser that lists just that device. Needs a user gesture.
 */
export async function requestTrainerDevice(name?: string): Promise<BluetoothDevice> {
  if (name) return navigator.bluetooth.requestDevice({ filters: [{ name }], optionalServices: [FTMS_SERVICE, CPS_SERVICE] });
  const asked = Date.now();
  try {
    return await navigator.bluetooth.requestDevice({ filters: [{ services: [FTMS_SERVICE] }, { services: [CPS_SERVICE] }] });
  } catch (err) {
    // Rejected before a chooser could have been on screen: the browser didn't take this request
    // (iPhone Web Bluetooth browsers such as Bluefy can refuse the two-filter form that the
    // heart-rate request doesn't use). Ask again listing every nearby device, the simplest form.
    if (Date.now() - asked > CHOOSER_SHOWN_MS) throw err;
    return navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [FTMS_SERVICE, CPS_SERVICE] });
  }
}

/** A requestDevice rejection faster than this came back without showing the chooser (ms). */
export const CHOOSER_SHOWN_MS = 800;

/**
 * Connects to a trainer the browser already knows (picked just now, or allowed earlier), finds its
 * services and subscribes to its notifications. Safe to call again on the same device after a drop:
 * it sets everything up afresh. FTMS first, Cycling Power as the fallback.
 */
export async function openTrainer(device: BluetoothDevice, cb: TrainerCallbacks): Promise<Trainer> {
  const drop = onGattDrop(device, () => cb.onDisconnect());
  try {
    const server = await device.gatt!.connect();
    const ftms = await server.getPrimaryService(FTMS_SERVICE).catch(() => null);
    const trainer = ftms
      ? await connectFtms(device, ftms, cb)
      : await connectCyclingPower(device, await server.getPrimaryService(CPS_SERVICE), cb);
    drop.arm();
    return trainer;
  } catch (err) {
    try { device.gatt?.disconnect(); } catch { /* already gone */ }
    throw err;
  }
}

export async function connectTrainer(cb: TrainerCallbacks, name?: string): Promise<Trainer> {
  return openTrainer(await requestTrainerDevice(name), cb);
}

// ---------------------------------------------------------------- FTMS ----

async function connectFtms(
  device: BluetoothDevice,
  service: BluetoothRemoteGATTService,
  cb: TrainerCallbacks,
): Promise<Trainer> {
  const bikeData = await service.getCharacteristic(FTMS_INDOOR_BIKE_DATA);
  bikeData.addEventListener('characteristicvaluechanged', (event) => {
    const view = notificationView(event, bikeData);
    if (!view) return;
    let reading: TrainerReading;
    try { reading = parseIndoorBikeData(view); } catch { return; }
    cb.onReading(reading);
  });
  await bikeData.startNotifications();

  const cp = new ControlPoint(await service.getCharacteristic(FTMS_CONTROL_POINT).catch(() => null));
  const control = new TrainerControl(cp, { initial: 'unavailable', onState: (st) => cb.onControlState?.(st) });
  let canControl = false;
  if (cp.available) {
    // Taking control is a bonus: if the control point won't play (another app holds control, or the
    // browser can't write to it), keep the connection for power and cadence rather than failing it.
    try {
      await cp.start();
      canControl = await control.acquireInitially();
    } catch {
      canControl = false;
    }
  }
  if (canControl) {
    // The trainer says so at once when another app takes control (op 0xFF); don't wait for a command to fail.
    try {
      const status = await service.getCharacteristic(FTMS_MACHINE_STATUS);
      status.addEventListener('characteristicvaluechanged', (event) => {
        if (isControlLostStatus(notificationView(event, status))) control.permissionLost();
      });
      await status.startNotifications();
    } catch { /* no status characteristic: failed commands still tell us */ }
  }

  const notSent = async (): Promise<ControlResult> => ({ ok: false, code: RESULT_NOT_SENT });
  return {
    name: device.name ?? 'Smart trainer',
    canControl,
    get controlState() { return control.state; },
    async setTargetPower(watts: number) {
      if (!canControl) return notSent();
      const buf = new DataView(new ArrayBuffer(3));
      buf.setUint8(0, OP_SET_TARGET_POWER);
      buf.setInt16(1, Math.round(clamp(watts, 0, 2000)), true); // 1 W resolution
      return control.command(new Uint8Array(buf.buffer));
    },
    async setGrade(gradePercent: number, windFactor = 1, headwindMs = 0) {
      if (!canControl) return notSent();
      const buf = new DataView(new ArrayBuffer(7));
      buf.setUint8(0, OP_SET_SIM_PARAMS);
      buf.setInt16(1, Math.round(clamp(headwindMs, -30, 30) * 1000), true); // wind speed, 0.001 m/s (positive: headwind)
      buf.setInt16(3, Math.round(clamp(gradePercent, -20, 20) * 100), true); // grade, 0.01 %
      buf.setUint8(5, 40); // rolling resistance coefficient, 0.0001 → 0.004
      buf.setUint8(6, Math.round(51 * clamp(windFactor, 0.3, 1))); // wind resistance coefficient, 0.01 kg/m → 0.51 (less in a draft)
      return control.command(new Uint8Array(buf.buffer));
    },
    disconnect: () => device.gatt?.disconnect(),
  };
}

/** Parses an FTMS Indoor Bike Data notification (Bluetooth FTMS spec §4.9). A short packet gives what could be read. */
export function parseIndoorBikeData(view: DataView): TrainerReading {
  const out: TrainerReading = {};
  if (view.byteLength < 2) return out;
  const flags = view.getUint16(0, true);
  const len = view.byteLength;
  let i = 2;
  // Each field is read only if it fits; one that doesn't ends the parse (later offsets depend on it).
  // Bit 0 is "More Data": when it is CLEAR, instantaneous speed is present.
  if (!(flags & 0x0001)) { if (i + 2 > len) return out; out.speedKmh = view.getUint16(i, true) / 100; i += 2; }
  if (flags & 0x0002) i += 2; // average speed
  if (flags & 0x0004) { if (i + 2 > len) return out; out.cadence = view.getUint16(i, true) / 2; i += 2; }
  if (flags & 0x0008) i += 2; // average cadence
  if (flags & 0x0010) i += 3; // total distance
  if (flags & 0x0020) i += 2; // resistance level
  if (flags & 0x0040) { if (i + 2 > len) return out; out.power = view.getInt16(i, true); i += 2; }
  if (flags & 0x0080) i += 2; // average power
  if (flags & 0x0100) i += 5; // expended energy
  if (flags & 0x0200) { if (i + 1 > len) return out; out.heartRate = view.getUint8(i); i += 1; }
  return out;
}

// ------------------------------------------------------- Cycling Power ----

async function connectCyclingPower(
  device: BluetoothDevice,
  service: BluetoothRemoteGATTService,
  cb: TrainerCallbacks,
): Promise<Trainer> {
  await subscribeCyclingPower(service, cb.onReading);
  const notSent = async (): Promise<ControlResult> => ({ ok: false, code: RESULT_NOT_SENT });
  return {
    name: device.name ?? 'Power meter',
    canControl: false,
    controlState: 'unavailable',
    setGrade: notSent,
    setTargetPower: notSent,
    disconnect: () => device.gatt?.disconnect(),
  };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
