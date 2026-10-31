# Connecting devices

This page covers connecting a smart trainer, the difference between full control and power-only trainers, ERG and grade modes, and a heart-rate strap.

## The trainer

1. Click **Connect trainer**.
2. Your browser opens a device picker. Choose your trainer and confirm.
3. The button changes to **Disconnect**, and the status line shows your trainer's name.

The picker lists only devices that advertise the FTMS (Fitness Machine) or Cycling Power service. If your trainer doesn't appear, see [Troubleshooting](troubleshooting.md#trainer-not-found).

To disconnect, click **Disconnect**. If the trainer drops out on its own, the status line changes to **Trainer disconnected**.

### Full control or power only

The app prefers the standard **FTMS** profile, which current Wahoo KICKR, KICKR CORE and KICKR SNAP firmware exposes. With FTMS the app can:

- read power, cadence and (if the trainer relays it) heart rate,
- set the resistance to follow the road grade, and
- hold a target power in workouts (ERG mode).

If the app can't take control, or the trainer only offers the **Cycling Power** profile, it runs in **power-only** mode. You still see power and cadence, and the speed model still works, but the trainer's resistance won't change. The status line says **power only (no resistance control)**.

### Grade mode and ERG mode

The app uses two ways to control the trainer:

| Mode | When | What the trainer does |
| --- | --- | --- |
| **Grade** (resistance follows the road) | Normal riding | Simulates the road's grade, scaled by **Trainer difficulty** in Settings. Sent once a second when it changes. |
| **ERG** (hold a target) | Riding a workout | Holds the workout's target watts, whatever your cadence. |

When a workout ends or you stop it, the trainer goes back to grade mode. See [Workouts](workouts.md) for ERG details, and [Settings](settings.md) for trainer difficulty.

Grade values are limited to between −20% and +20%.

## Heart-rate strap

A heart-rate strap is optional.

1. Put the strap on and make sure it's transmitting.
2. Click **Heart rate**, then choose the strap from the picker.
3. The button changes to **HR ✓** when it's connected.
4. Click **HR ✓** to disconnect.

If no strap is connected but your trainer relays heart rate, the app uses the trainer's reading. Heart rate older than 3 seconds counts as missing, and the heart-rate blocks show `--`.

Heart rate feeds the heart-rate zones, the average and maximum HR blocks, and the ride summary. Set your max heart rate in [Settings](settings.md) so the zones are right.

## Trainer status and data freshness

If the app hasn't had a reading from the trainer for 3 seconds, it treats power and cadence as zero. That's why the numbers drop to zero if you stop receiving data, rather than freezing at the last value.

## Connection troubleshooting

See [Troubleshooting](troubleshooting.md) for connection problems, including Bluetooth being unavailable, a trainer not appearing, or a connection error.
