# Bluetooth and FTMS

This page documents the Bluetooth services, characteristics and opcodes the app uses, how it parses the Indoor Bike Data and Cycling Power notifications, the control point sequence, the grade and target-power commands, and the once-per-second control loop.

Source: [`src/ble/trainer.ts`](../../src/ble/trainer.ts), [`src/ble/heartRate.ts`](../../src/ble/heartRate.ts), and the control loop in [`src/main.ts`](../../src/main.ts).

## Services and characteristics

| Name | UUID | Used for |
| --- | --- | --- |
| Fitness Machine Service (FTMS) | `0x1826` | Trainer control. Preferred. |
| Indoor Bike Data | `0x2AD2` | Notifications: speed, cadence, power, heart rate. |
| FTMS Control Point | `0x2AD9` | Requests and commands. |
| Cycling Power Service (CPS) | `0x1818` | Fallback for power-only devices. |
| Cycling Power Measurement | `0x2A63` | Notifications: power, and crank data for cadence. |
| Heart Rate Service | `0x180D` | Heart-rate straps. |
| Heart Rate Measurement | `0x2A37` | Notifications: heart rate. |

`requestTrainerDevice()` asks for a device that advertises either FTMS or CPS, and lists both as optional services. `openTrainer(device, callbacks)` connects to GATT, then tries FTMS first. If FTMS isn't there, it uses CPS. (`connectTrainer()` does both.) The heart-rate strap has the same split: `requestHeartRateDevice()` and `openHeartRate()`. The split is what lets a remembered device be reopened without the chooser; `openTrainer` is safe to call again on the same `BluetoothDevice` after a drop, and each call replaces the earlier `gattserverdisconnected` listener (`onGattDrop` in `ble/remembered.ts`) so a drop is reported once.

## Remembered devices and reconnecting

Logic: [`src/ble/remembered.ts`](../../src/ble/remembered.ts) (pure helpers, unit-tested in `tests/unit/remembered.test.ts`) and [`src/devicesUi.ts`](../../src/devicesUi.ts) (the connection life cycle and the UI).

- **Storage.** `localStorage` key `americanflyers.devices`: `{ trainer?: {id, name}, hr?: {id, name} }`. Per browser, never synced (a Bluetooth `id` is meaningless elsewhere). Saved on every successful connect, removed by Forget (which also calls `device.forget()` where the browser has it).
- **On load, no chooser (feature-detected).** If `navigator.bluetooth.getDevices` exists, the remembered id is looked up in it, `watchAdvertisements()` waits for the first `advertisementreceived` (8 s timeout), then `gatt.connect()` runs (it is tried even after the timeout). Chrome exposes `getDevices` behind `chrome://flags/#enable-web-bluetooth-new-permissions-backend`; chromestatus lists shipping by default for Chrome 169. Without it nothing here runs.
- **Otherwise, one tap.** A banner and the ☰ Menu show **Reconnect *name***. The click handler calls `requestDevice({ filters: [{ name }], optionalServices })` so the chooser lists just that device (a user gesture is required, so it is wired directly to the click). A `NotFoundError` after a named request produces a "didn't find" toast; the plain **Connect trainer** button always opens the full chooser.
- **Drops.** A remembered device that fires `gattserverdisconnected` is retried on the same `BluetoothDevice` with waits of 1, 2, 4, 8 and 15 s (`RECONNECT_DELAYS_MS`, `Reconnector`), then the app gives up with a toast and leaves the Reconnect buttons. A manual Disconnect never retries. The ride is not ended: `trainerChanged(null)` zeroes live power and cadence.
- **After a reconnect.** `openTrainer()` re-subscribes to Indoor Bike Data and the Control Point and redoes Request Control / Start. `devicesUi` calls `trainerChanged(trainer)`, and `main.ts` clears `lastSentGrade` and `lastSentWatts`, so the next `controlTrainer()` tick sends the current grade (or ERG watts) again.

Tests: `tests/e2e/devices.spec.ts` replaces `navigator.bluetooth` with a mock (FTMS trainer, heart-rate strap, optional `getDevices`, simulated drops, failing connects) and covers the banner, the name-filtered request, the no-chooser path, automatic reconnection with backoff, the resend of resistance, and Forget.

## Connection sequence (FTMS)

1. Get the Indoor Bike Data characteristic, subscribe to it, and parse each notification.
2. Get the Control Point. If it's missing, the trainer is power-only.
3. Subscribe to Control Point responses.
4. Send **Request Control** (opcode `0x00`). If the response is success, the trainer grants control.
5. Send **Start or Resume** (opcode `0x07`).

Only after step 4 succeeds does the app set `canControl` to true. Until then it sends no grade or power commands.

## Control point responses

Responses arrive as a notification: byte 0 is `0x80` (response code), byte 1 is the opcode being answered, and byte 2 is the result. `0x01` is success.

The `ControlPoint` class:

- queues writes, so only one command is in flight at a time,
- writes each command with a response, and
- waits for the matching response, with a **3-second timeout**. On timeout, the command resolves as failed.

## Commands

| Command | Opcode | Payload | Used for |
| --- | --- | --- | --- |
| Request Control | `0x00` | none | Taking control at connect time. |
| Start or Resume | `0x07` | none | Starting the trainer after control is granted. |
| Set Target Power | `0x05` | `int16` watts, little-endian, 1 W resolution | ERG mode in workouts. Clamped to 0–2000 W. |
| Set Indoor Bike Simulation Parameters | `0x11` | 7 bytes, below | Grade mode. |

### Set Indoor Bike Simulation Parameters

| Byte | Field | Encoding | Value the app sends |
| --- | --- | --- | --- |
| 0 | Opcode | `0x11` | |
| 1–2 | Wind speed | `int16`, 0.001 m/s | `0` |
| 3–4 | Grade | `int16`, 0.01% | The road grade × difficulty, plus the virtual gear's offset, clamped to ±20% |
| 5 | Rolling resistance coefficient | `uint8`, 0.0001 | `40` (0.0040) |
| 6 | Wind resistance coefficient | `uint8`, 0.01 kg/m | `51` (0.51), times the draft factor |

The rolling value, 0.0040, matches `crr` in `src/physics.ts`. The wind value starts at 0.51 kg/m and is multiplied by `1 − draft saving` (rounded to steps of 5%, never below 30%), so the trainer gets lighter in someone's slipstream.

## Parsing Indoor Bike Data

`parseIndoorBikeData()` reads a `uint16` flags field, then the optional fields in the order the FTMS specification gives. Each flag bit adds bytes:

| Bit | Field | Size | App use |
| --- | --- | --- | --- |
| 0 | More Data. When **clear**, Instantaneous Speed is present. | — | Instantaneous Speed: `uint16`, 0.01 km/h. Informational. |
| 1 | Average Speed | 2 bytes | Skipped. |
| 2 | Instantaneous Cadence | 2 bytes, 0.5 rpm | Cadence. |
| 3 | Average Cadence | 2 bytes | Skipped. |
| 4 | Total Distance | 3 bytes | Skipped. |
| 5 | Resistance Level | 2 bytes | Skipped. |
| 6 | Instantaneous Power | `int16`, watts | Power. |
| 7 | Average Power | 2 bytes | Skipped. |
| 8 | Expended Energy | 5 bytes | Skipped. |
| 9 | Heart Rate | `uint8`, bpm | Heart rate, if the trainer relays it. |

The app ignores any fields after bit 9. Later fields can't change the offsets of the earlier ones.

## Parsing Cycling Power Measurement

The flags field is a `uint16`. Power is an `int16` at offset 2, after which the optional fields follow:

| Bit | Field | Size |
| --- | --- | --- |
| 0 | Pedal Power Balance | 1 byte |
| 2 | Accumulated Torque | 2 bytes |
| 4 | Wheel Revolution Data | 6 bytes |
| 5 | Crank Revolution Data | 4 bytes: `uint16` cumulative cranks, `uint16` last event time (1/1024 s) |

Cadence comes from the crank data. `CrankCadence` keeps the last count and time, and works out rpm as `revs × 1024 × 60 / time difference`, with wrap-around handled for both fields. If no new crank event arrives for 2.5 seconds, cadence is zero.

The Cycling Power fallback is read-only. `canControl` is false, and `setGrade()` and `setTargetPower()` do nothing.

## Heart-rate measurement

Flags bit 0 selects the format: when set, heart rate is a `uint16` at byte 1; otherwise it's a `uint8` at byte 1.

## The control loop

`controlTrainer()` in `src/main.ts` runs once a second, and straight away after a virtual gear change. It does nothing unless the trainer can be controlled.

1. **ERG takes priority.** If a workout is running and not finished, it reads the target watts. It sends them only if they differ from the last value by at least 1 W. When ERG ends, it clears the last grade so the grade is sent again.
2. **Otherwise, grade.** The target is the road grade at the rider's distance, multiplied by the **Trainer difficulty** (0–100%), plus the virtual gear's offset when virtual shifting is on, clamped to −10…+20% and rounded to 0.1%. It's sent with the draft's wind factor, and only if the grade differs from the last value by at least 0.1% or the wind factor has changed.

The loop only sends on change, so the trainer keeps the last setting. If the write itself throws, the last value is cleared, so the next tick tries again. A response timeout resolves as `false` without throwing, so it doesn't trigger a retry.

## Staleness

The frame loop treats the trainer as idle after **3 seconds** without a reading, and zeroes power and cadence. Heart rate has the same 3-second rule in `currentHr()`.

## Practical notes

- Only one app can usually control the trainer. That's why the README says to close the Wahoo app or Zwift before connecting.
- The control loop sends at most one command a second. Each write waits for its response, with a 3-second timeout, before the next one is sent.
- The app clamps grade to ±20% and power to 0–2000 W before sending.
