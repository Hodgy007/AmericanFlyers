# Connecting devices

This page covers connecting a smart trainer, the difference between full control and power-only trainers, ERG and grade modes, and a heart-rate strap.

## The trainer

1. Click **Connect trainer** in the top bar, or **☰ Menu → 🔌 Connect trainer**. Both do the same thing.
2. Your browser opens a device picker. Choose your trainer and confirm.
3. The button changes to **Disconnect**, the menu item changes to **Disconnect *your trainer***, and the status line shows your trainer's name.

The picker lists only devices that advertise the FTMS (Fitness Machine) or Cycling Power service. If your trainer doesn't appear, see [Troubleshooting](troubleshooting.md#trainer-not-found).

To disconnect, click **Disconnect** (or the menu item). If the trainer drops out on its own, see [If a device drops out](#if-a-device-drops-out).

## Remembered devices: you only join once

Every time a trainer or heart rate strap connects, American Flyers remembers it **on this browser** (it isn't saved to your account, because a Bluetooth device only means something to the browser that paired with it). Next time:

- **In Chrome with persistent Bluetooth permissions** (see [Browser support](#browser-support-for-automatic-reconnection)), your trainer and strap reconnect by themselves a moment after the app opens, with no picker. Wake the trainer by pedalling a few strokes if it's asleep.
- **Everywhere else**, a small banner at the bottom left says **Reconnect *your trainer*** (and the same for your strap). One tap opens the browser's list showing just that device. Tap it and you're riding. The same button is in **☰ Menu** as **🔌 Reconnect *name*** and **❤️ Reconnect *name***.

**Forget a device** with **☰ Menu → ✕ Forget *name***, or in **⚙ Settings → Remembered devices**. That removes it from this browser only; you can connect it again any time. Connecting a different trainer replaces the remembered one. The ✕ on the banner hides it for this visit.

### If a device drops out

If a remembered trainer or strap loses its connection during a ride (battery, distance, interference), the ride carries on: your power reads zero while it's away, and the ride isn't ended. American Flyers tries to reconnect by itself, waiting 1, 2, 4, 8 and then 15 seconds between tries. When it's back it subscribes again and sends the trainer the current road resistance (or target power in a workout). If it can't get through after those five tries, a message says so and **Reconnect** stays in the ☰ Menu and the banner.

If you press **Disconnect** yourself, nothing tries to reconnect.

### Browser support for automatic reconnection

Reconnecting on load without the picker needs `navigator.bluetooth.getDevices()` (and `watchAdvertisements()`), which Chrome keeps behind a flag for now. To turn it on in Chrome or Edge on Windows, macOS, Linux, ChromeOS or Android, open `chrome://flags/#enable-web-bluetooth-new-permissions-backend` (`edge://flags/...` in Edge), set it to **Enabled** and relaunch. Chrome's own status page expects it to be on by default from about Chrome 169. Without it, or in Bluefy, you get the one-tap **Reconnect** instead. Both paths remember your device the same way.

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
2. Open **☰ Menu** and click **❤️ Heart rate**, then choose the strap from the picker.
3. The menu item changes to **❤️ Disconnect *your strap*** when it's connected.
4. Click it again to disconnect.

Like the trainer, the strap is remembered on this browser and reconnects the same way (see [Remembered devices](#remembered-devices-you-only-join-once)).

If no strap is connected but your trainer relays heart rate, the app uses the trainer's reading. Heart rate older than 3 seconds counts as missing, and the heart-rate blocks show `--`.

Heart rate feeds the heart-rate zones, the average and maximum HR blocks, and the ride summary. Set your max heart rate in [Settings](settings.md) so the zones are right.

## Trainer status and data freshness

If the app hasn't had a reading from the trainer for 3 seconds, it treats power and cadence as zero. That's why the numbers drop to zero if you stop receiving data, rather than freezing at the last value.

## Connection troubleshooting

See [Troubleshooting](troubleshooting.md) for connection problems, including Bluetooth being unavailable, a trainer not appearing, or a connection error.
