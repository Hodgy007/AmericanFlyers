# Getting started

This page covers what you need, how to open the app, and how to take your first ride, with or without a trainer.

## What you need

- **A computer or Android phone with Chrome or Edge** for a trainer connection. Chrome or Edge on Windows, macOS, ChromeOS or Android all work.
- **An iPhone or iPad?** Safari doesn't support Web Bluetooth, so use the free **Bluefy** browser instead.
- **Firefox and Safari** can't connect to a trainer, but the demo ride still works.
- **Bluetooth turned on** on the device running the app.
- **A smart trainer.** Wahoo KICKR, KICKR CORE and KICKR SNAP work on current firmware, and most other trainers that support the standard FTMS profile work too. A trainer that only shares power (the Cycling Power profile) still works, in read-only mode.
- **An optional heart-rate strap.** See [Connecting devices](connecting-devices.md).

Bluetooth only works on secure pages (`https://`) or on `localhost`. The live site at https://americanflyers.vercel.app is secure, so you can open it directly.

> Close the Wahoo app and Zwift before you connect. A trainer can usually take control commands from only one app at a time.

## Open the app

1. Open https://americanflyers.vercel.app in Chrome or Edge (or Bluefy on iPhone or iPad).
2. You'll see the 3D valley, the top bar of buttons and the data blocks across the top.
3. You don't need an account to ride. Your settings are kept in this browser until you sign in. To save your rides, ride with others and get on the leaderboards, sign in with Google or **Sign up with email** (a rider name, email, password and your weight; no phone number or address). See [Accounts and profile](accounts-and-profile.md).

## Set up your numbers first

Before a real ride, open **⚙ Settings** and enter your details. The app starts with these defaults:

| Setting | Default |
| --- | --- |
| Rider weight | 75 kg |
| Bike weight | 8 kg |
| FTP | 200 W |
| Max heart rate | 185 bpm |
| Units | Metric |
| Trainer difficulty | 50% |

Your weight drives the speed model. FTP sets the power zones and workout targets. See [Settings](settings.md) for every option.

## Your first ride

1. Click **Connect trainer** (or **☰ Menu → 🔌 Connect trainer**).
2. Choose your trainer from the list your browser shows. Only trainers that advertise the FTMS or Cycling Power service appear.
3. The status line at the bottom left shows your trainer's name and **resistance follows the road** when the app can control it. If it says **power only**, the app can read your power but can't change the resistance.
4. American Flyers remembers your trainer (and a heart rate strap, if you connect one) on this browser, so next time it reconnects by itself or with one tap on **Reconnect**. See [Connecting devices](connecting-devices.md#remembered-devices-you-only-join-once).
5. Start pedaling. The speed and data blocks update straight away.
6. The trainer's resistance follows the road. On a climb it gets harder; on a descent it eases. The default difficulty is 50%, so you feel half of the road's grade.
7. When you've finished, open **☰ Menu → ↺ End / reset ride**. You'll see a ride summary. If you're signed in, the ride is saved.

## Try the demo ride

No trainer? Click **Demo ride**. The rider's power comes from a slider at the top of the screen, from 0 to 600 W in steps of 5 W. You can also use the **↑** and **↓** keys to change power by 10 W.

- **Jump along the route:** click or tap the elevation profile at the bottom of the screen to go straight to that point (hover to see where). It doesn't count towards your distance, climbing or a leaderboard time. Jumping is off during races and workouts.
- Click **Stop demo** to end the demo.
- Connecting a trainer turns the demo off.
- Demo rides work in every browser, including Firefox and Safari.

## Where next

- [Connecting devices](connecting-devices.md) for the trainer, heart rate and the two control modes.
- [Riding](riding.md) for a tour of the screen.
- [Stages and routes](stages-and-routes.md) to pick a course.
- [Troubleshooting](troubleshooting.md) if something doesn't connect.
