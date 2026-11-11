// FTMS control point: writing commands, matching each response to its request, and keeping control.
//
// Another app (Zwift, the Wahoo app) can take control mid-ride, or the trainer can stop answering. The
// pieces here notice that, ask for control again with a growing wait, and report the state so the rider is told.

import { notificationView } from './notification';

export const OP_REQUEST_CONTROL = 0x00;
export const OP_SET_TARGET_POWER = 0x05;
export const OP_START_RESUME = 0x07;
export const OP_SET_SIM_PARAMS = 0x11;
const OP_RESPONSE = 0x80;

/** FTMS control point result codes (the third byte of a response). */
export const RESULT_SUCCESS = 0x01;
export const RESULT_NOT_SUPPORTED = 0x02;
export const RESULT_INVALID_PARAMETER = 0x03;
export const RESULT_FAILED = 0x04;
export const RESULT_NOT_PERMITTED = 0x05;
/** Our own codes, below the spec's range: no answer in time, the write itself failed, nothing sent (backing off or no control). */
export const RESULT_TIMEOUT = -1;
export const RESULT_WRITE_FAILED = -2;
export const RESULT_NOT_SENT = -3;

/** The FTMS Fitness Machine Status op code for "control permission lost" (another app took over). */
export const STATUS_CONTROL_LOST = 0xff;

export interface ControlResult {
  ok: boolean;
  /** The FTMS result code, or one of the negative codes above. */
  code: number;
}

/** "ok": commands are taken; "lost": they are not (another app, or the trainer went quiet); "unavailable": this trainer can't be controlled at all. */
export type ControlState = 'ok' | 'lost' | 'unavailable';

/** What the control point needs from a Bluetooth characteristic (so tests can fake one). */
export type ControlCharacteristic = Pick<BluetoothRemoteGATTCharacteristic, 'addEventListener' | 'startNotifications' | 'value'>
  & Partial<Pick<BluetoothRemoteGATTCharacteristic, 'writeValue' | 'writeValueWithResponse'>>;

/** True for a Fitness Machine Status notification that says another app took control. */
export function isControlLostStatus(view: DataView | null | undefined): boolean {
  return !!view && view.byteLength >= 1 && view.getUint8(0) === STATUS_CONTROL_LOST;
}

/** Serialises writes to the FTMS control point and waits for the response to each. */
export class ControlPoint {
  private queue: Promise<unknown> = Promise.resolve();
  private pending: { op: number; resolve: (code: number) => void } | null = null;

  constructor(private readonly char: ControlCharacteristic | null, private readonly timeoutMs = 3000) {}

  get available() { return this.char !== null; }

  async start() {
    if (!this.char) return;
    this.char.addEventListener('characteristicvaluechanged', (event) => {
      const v = notificationView(event, this.char!);
      if (!v || v.byteLength < 3 || v.getUint8(0) !== OP_RESPONSE) return;
      // Only the response to the request in flight counts: a late answer to a request that already
      // timed out must not resolve the next one.
      if (this.pending && this.pending.op === v.getUint8(1)) {
        const { resolve } = this.pending;
        this.pending = null;
        resolve(v.getUint8(2));
      }
    });
    await this.char.startNotifications();
  }

  /** Sends one command and resolves with its result. A failed write rejects; no answer in time resolves RESULT_TIMEOUT. */
  send(payload: Uint8Array<ArrayBuffer>): Promise<ControlResult> {
    const run = async (): Promise<ControlResult> => {
      const char = this.char;
      if (!char) return { ok: false, code: RESULT_NOT_SENT };
      const op = payload[0];
      let timer: ReturnType<typeof setTimeout> | undefined;
      const response = new Promise<number>((resolve) => {
        const entry = { op, resolve };
        this.pending = entry;
        timer = setTimeout(() => { if (this.pending === entry) { this.pending = null; resolve(RESULT_TIMEOUT); } }, this.timeoutMs);
      });
      try {
        // Bluefy and other iPhone Web Bluetooth browsers only have the older writeValue(), which also
        // writes with a response. Chrome has both.
        if (typeof char.writeValueWithResponse === 'function') await char.writeValueWithResponse(payload);
        else await char.writeValue!(payload);
      } catch (err) {
        clearTimeout(timer);
        this.pending = null;
        throw err;
      }
      const code = await response;
      clearTimeout(timer);
      return { ok: code === RESULT_SUCCESS, code };
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => false);
    return result;
  }
}

export interface TrainerControlOptions {
  initial: ControlState;
  onState?: (state: ControlState) => void;
  now?: () => number;
  /** Waits before each re-request of control after it is lost (ms); the last one repeats. */
  backoffMs?: number[];
  /** Consecutive failed commands (time-outs, refusals) before control is re-requested. */
  failuresBeforeRecover?: number;
}

export const CONTROL_BACKOFF_MS = [2000, 5000, 10000, 30000];

/**
 * Sends commands through a control point and keeps control of the trainer: a "control not permitted"
 * answer, or a few failures in a row, re-requests control (Request Control, then Start/Resume) and
 * resends the command once. If that fails too, control counts as lost and commands are not sent again
 * until a growing wait is over, so a trainer that won't answer isn't hammered every second.
 */
export class TrainerControl {
  private _state: ControlState;
  private failures = 0;
  private backoffIndex = 0;
  private retryAt = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly now: () => number;
  private readonly backoff: number[];
  private readonly failLimit: number;

  constructor(private readonly cp: Pick<ControlPoint, 'send'>, private readonly o: TrainerControlOptions) {
    this._state = o.initial;
    this.now = o.now ?? (() => performance.now());
    this.backoff = o.backoffMs ?? CONTROL_BACKOFF_MS;
    this.failLimit = o.failuresBeforeRecover ?? 3;
  }

  get state(): ControlState { return this._state; }

  /** Takes control: Request Control, then Start/Resume. True when the trainer granted it. */
  async acquire(): Promise<boolean> {
    const r = await this.try(new Uint8Array([OP_REQUEST_CONTROL]));
    if (!r.ok) return false;
    await this.try(new Uint8Array([OP_START_RESUME])); // best effort: some trainers are already running
    return true;
  }

  /** The first request at connect time: sets the state without telling anyone. */
  async acquireInitially(): Promise<boolean> {
    const ok = await this.acquire();
    this._state = ok ? 'ok' : 'unavailable';
    return ok;
  }

  /** Another app took control (Fitness Machine Status "control permission lost"). Commands wait for the back-off, then ask again. */
  permissionLost() {
    if (this._state === 'unavailable') return;
    this.failures = 0;
    this.backoffIndex = 0;
    this.lose();
  }

  /** Sends a command and keeps control of the trainer; see the class comment. */
  command(payload: Uint8Array<ArrayBuffer>): Promise<ControlResult> {
    const run = () => this.run(payload);
    const result = this.chain.then(run, run);
    this.chain = result.catch(() => undefined);
    return result;
  }

  private async try(payload: Uint8Array<ArrayBuffer>): Promise<ControlResult> {
    try { return await this.cp.send(payload); } catch { return { ok: false, code: RESULT_WRITE_FAILED }; }
  }

  private async run(payload: Uint8Array<ArrayBuffer>): Promise<ControlResult> {
    if (this._state === 'unavailable') return { ok: false, code: RESULT_NOT_SENT };
    if (this._state === 'lost') {
      if (this.now() < this.retryAt) return { ok: false, code: RESULT_NOT_SENT }; // still backing off
      if (!(await this.acquire())) { this.lose(); return { ok: false, code: RESULT_NOT_PERMITTED }; }
    }
    let r = await this.try(payload);
    if (r.ok) { this.recovered(); return r; }
    this.failures++;
    if (r.code === RESULT_NOT_PERMITTED || this.failures >= this.failLimit) {
      if (await this.acquire()) {
        r = await this.try(payload);
        if (r.ok) { this.recovered(); return r; }
      }
      this.lose();
    }
    return r;
  }

  private recovered() {
    this.failures = 0;
    this.backoffIndex = 0;
    this.setState('ok');
  }

  private lose() {
    this.retryAt = this.now() + this.backoff[Math.min(this.backoffIndex, this.backoff.length - 1)];
    this.backoffIndex++;
    this.setState('lost');
  }

  private setState(s: ControlState) {
    if (s === this._state) return;
    this._state = s;
    this.o.onState?.(s);
  }
}
