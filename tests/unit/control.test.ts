import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ControlPoint, OP_REQUEST_CONTROL, OP_SET_TARGET_POWER, OP_START_RESUME, RESULT_INVALID_PARAMETER, RESULT_NOT_PERMITTED,
  RESULT_NOT_SENT, RESULT_SUCCESS, RESULT_TIMEOUT, TrainerControl, isControlLostStatus, type ControlState,
} from '../../src/ble/control';

/** A fake FTMS control point characteristic: records writes, and answers each one the way `reply` says. */
function fakeChar(reply: (op: number, n: number) => number | null | 'late') {
  const listeners: (() => void)[] = [];
  const writes: number[][] = [];
  const char = {
    value: null as DataView | null,
    addEventListener: (_t: string, fn: () => void) => { listeners.push(fn); },
    startNotifications: async () => char,
    writeValueWithResponse: async (buf: BufferSource) => {
      const bytes = [...new Uint8Array(buf as ArrayBuffer)];
      writes.push(bytes);
      const r = reply(bytes[0], writes.length);
      if (r === null || r === 'late') return;
      emit([0x80, bytes[0], r]);
    },
  };
  const emit = (bytes: number[]) => { char.value = new DataView(new Uint8Array(bytes).buffer); listeners.forEach((l) => l()); };
  return { char: char as unknown as ConstructorParameters<typeof ControlPoint>[0], writes, emit };
}

const power = (w: number) => new Uint8Array([OP_SET_TARGET_POWER, w & 0xff, w >> 8]);

describe('ControlPoint', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('resolves with the result code of the matching response', async () => {
    const f = fakeChar(() => RESULT_SUCCESS);
    const cp = new ControlPoint(f.char);
    await cp.start();
    expect(await cp.send(power(200))).toEqual({ ok: true, code: RESULT_SUCCESS });
    expect(f.writes).toEqual([[OP_SET_TARGET_POWER, 200, 0]]);
  });

  it('reports a refusal with its code', async () => {
    const f = fakeChar(() => RESULT_INVALID_PARAMETER);
    const cp = new ControlPoint(f.char);
    await cp.start();
    expect(await cp.send(power(200))).toEqual({ ok: false, code: RESULT_INVALID_PARAMETER });
  });

  it('ignores a response to a different op code, and times out after 3 s', async () => {
    const f = fakeChar(() => null);
    const cp = new ControlPoint(f.char);
    await cp.start();
    const p = cp.send(power(200));
    await vi.advanceTimersByTimeAsync(10);
    f.emit([0x80, OP_REQUEST_CONTROL, RESULT_SUCCESS]); // a late answer to something else
    await vi.advanceTimersByTimeAsync(2000);
    let done = false;
    void p.then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1100);
    expect(await p).toEqual({ ok: false, code: RESULT_TIMEOUT });
  });

  it('a late response to a timed-out request does not resolve the next one', async () => {
    let n = 0;
    const f = fakeChar(() => (++n === 1 ? null : null));
    const cp = new ControlPoint(f.char);
    await cp.start();
    const first = cp.send(new Uint8Array([OP_REQUEST_CONTROL]));
    await vi.advanceTimersByTimeAsync(3100);
    expect((await first).code).toBe(RESULT_TIMEOUT);
    const second = cp.send(power(150));
    await vi.advanceTimersByTimeAsync(10);
    f.emit([0x80, OP_REQUEST_CONTROL, RESULT_SUCCESS]); // the first request's answer finally arrives
    await vi.advanceTimersByTimeAsync(3100);
    expect((await second).code).toBe(RESULT_TIMEOUT); // still waiting for its own
  });
});

describe('isControlLostStatus', () => {
  it('is true only for op 0xFF', () => {
    expect(isControlLostStatus(new DataView(new Uint8Array([0xff]).buffer))).toBe(true);
    expect(isControlLostStatus(new DataView(new Uint8Array([0x02]).buffer))).toBe(false);
    expect(isControlLostStatus(new DataView(new ArrayBuffer(0)))).toBe(false);
    expect(isControlLostStatus(null)).toBe(false);
  });
});

/** A scripted control point for TrainerControl: each send is answered from a queue (or a function). */
function scripted(answer: (op: number, i: number) => number) {
  const sent: number[][] = [];
  return {
    sent,
    cp: { send: async (p: Uint8Array) => { sent.push([...p]); const code = answer(p[0], sent.length); return { ok: code === RESULT_SUCCESS, code }; } },
  };
}

describe('TrainerControl', () => {
  let t = 0;
  const now = () => t;
  const states: ControlState[] = [];
  const make = (cp: ReturnType<typeof scripted>['cp'], initial: ControlState = 'ok') => {
    states.length = 0;
    t = 0;
    return new TrainerControl(cp, { initial, now, onState: (s) => states.push(s), backoffMs: [2000, 5000, 10000] });
  };

  it('passes a successful command through', async () => {
    const s = scripted(() => RESULT_SUCCESS);
    const c = make(s.cp);
    expect((await c.command(power(200))).ok).toBe(true);
    expect(s.sent).toEqual([[OP_SET_TARGET_POWER, 200, 0]]);
    expect(states).toEqual([]);
  });

  it('on "control not permitted" re-requests control, then resends', async () => {
    let denied = true;
    const s = scripted((op) => (op === OP_SET_TARGET_POWER && denied ? ((denied = false), RESULT_NOT_PERMITTED) : RESULT_SUCCESS));
    const c = make(s.cp);
    const r = await c.command(power(200));
    expect(r.ok).toBe(true);
    expect(s.sent.map((p) => p[0])).toEqual([OP_SET_TARGET_POWER, OP_REQUEST_CONTROL, OP_START_RESUME, OP_SET_TARGET_POWER]);
    expect(c.state).toBe('ok');
    expect(states).toEqual([]); // recovered quietly
  });

  it('goes to "lost" when control cannot be won back, and then backs off instead of sending every second', async () => {
    const s = scripted(() => RESULT_NOT_PERMITTED);
    const c = make(s.cp);
    expect((await c.command(power(200))).ok).toBe(false);
    expect(c.state).toBe('lost');
    expect(states).toEqual(['lost']);
    const sentSoFar = s.sent.length;
    t = 1000; // a second later: still inside the 2 s wait
    expect((await c.command(power(210)))).toEqual({ ok: false, code: RESULT_NOT_SENT });
    expect(s.sent.length).toBe(sentSoFar);
    t = 2100; // wait is over: one request-control attempt, which fails; the wait grows to 5 s
    expect((await c.command(power(210))).ok).toBe(false);
    expect(s.sent.slice(sentSoFar).map((p) => p[0])).toEqual([OP_REQUEST_CONTROL]);
    const after = s.sent.length;
    t = 6000; // only 3.9 s since: inside the grown wait
    await c.command(power(210));
    expect(s.sent.length).toBe(after);
    t = 7200;
    await c.command(power(210));
    expect(s.sent.length).toBe(after + 1);
    expect(states).toEqual(['lost']); // told once
  });

  it('comes back to "ok" once the trainer takes commands again, and resends the command', async () => {
    let open = false;
    const s = scripted(() => (open ? RESULT_SUCCESS : RESULT_NOT_PERMITTED));
    const c = make(s.cp);
    await c.command(power(200));
    expect(c.state).toBe('lost');
    open = true;
    t = 2500;
    const r = await c.command(power(220));
    expect(r.ok).toBe(true);
    expect(c.state).toBe('ok');
    expect(states).toEqual(['lost', 'ok']);
    expect(s.sent.at(-1)).toEqual([OP_SET_TARGET_POWER, 220, 0]);
  });

  it('treats repeated time-outs as lost control, but one time-out only as a failed command', async () => {
    const s = scripted((op) => (op === OP_SET_TARGET_POWER ? RESULT_TIMEOUT : RESULT_NOT_PERMITTED));
    const c = make(s.cp);
    expect((await c.command(power(200))).code).toBe(RESULT_TIMEOUT);
    expect(c.state).toBe('ok');
    await c.command(power(200));
    expect(c.state).toBe('ok');
    await c.command(power(200)); // third in a row: control is re-requested (and refused)
    expect(s.sent.some((p) => p[0] === OP_REQUEST_CONTROL)).toBe(true);
    expect(c.state).toBe('lost');
  });

  it('Fitness Machine Status 0xFF (permissionLost) marks control lost at once, then recovers after the wait', async () => {
    const s = scripted(() => RESULT_SUCCESS);
    const c = make(s.cp);
    c.permissionLost();
    expect(c.state).toBe('lost');
    expect(states).toEqual(['lost']);
    expect((await c.command(power(200))).code).toBe(RESULT_NOT_SENT);
    expect(s.sent).toEqual([]);
    t = 2100;
    expect((await c.command(power(200))).ok).toBe(true);
    expect(s.sent.map((p) => p[0])).toEqual([OP_REQUEST_CONTROL, OP_START_RESUME, OP_SET_TARGET_POWER]);
    expect(states).toEqual(['lost', 'ok']);
  });

  it('sends nothing when the trainer cannot be controlled, and a failed write counts as a failed command', async () => {
    const s = scripted(() => RESULT_SUCCESS);
    const c = make(s.cp, 'unavailable');
    expect((await c.command(power(200))).ok).toBe(false);
    expect(s.sent).toEqual([]);
    const thrower = new TrainerControl({ send: async () => { throw new Error('GATT'); } }, { initial: 'ok', now });
    expect((await thrower.command(power(200))).ok).toBe(false);
  });
});
