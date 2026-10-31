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

`connectTrainer()` requests a device that advertises either FTMS or CPS, and lists both as optional services. It connects to GATT, then tries FTMS first. If FTMS isn't there, it uses CPS.

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
| 3–4 | Grade | `int16`, 0.01% | The road grade, clamped to ±20% |
| 5 | Rolling resistance coefficient | `uint8`, 0.0001 | `40` (0.0040) |
| 6 | Wind resistance coefficient | `uint8`, 0.01 kg/m | `51` (0.51) |

The coefficients are fixed for every ride. The rolling value, 0.0040, matches `crr` in `src/physics.ts`. The wind value, 0.51 kg/m, is a fixed constant and isn't derived from `cda` there.

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

`setInterval` in `src/main.ts` runs once a second. It does nothing unless the trainer can be controlled.

1. **ERG takes priority.** If a workout is running and not finished, it reads the target watts. It sends them only if they differ from the last value by at least 1 W. When ERG ends, it clears the last grade so the grade is sent again.
2. **Otherwise, grade.** The target is the road grade at the rider's distance, multiplied by the **Trainer difficulty** (0–100%) and rounded to 0.1%. It's sent only if it differs from the last value by at least 0.1%.

The loop only sends on change, so the trainer keeps the last setting. If the write itself throws, the last value is cleared, so the next tick tries again. A response timeout resolves as `false` without throwing, so it doesn't trigger a retry.

## Staleness

The frame loop treats the trainer as idle after **3 seconds** without a reading, and zeroes power and cadence. Heart rate has the same 3-second rule in `currentHr()`.

## Practical notes

- Only one app can usually control the trainer. That's why the README says to close the Wahoo app or Zwift before connecting.
- The control loop sends at most one command a second. Each write waits for its response, with a 3-second timeout, before the next one is sent.
- The app clamps grade to ±20% and power to 0–2000 W before sending.
