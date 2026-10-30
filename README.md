# American Flyers

An indoor cycling app that runs in your browser. Connect a Wahoo smart trainer over Bluetooth and ride a virtual bike along an endless rolling road. The trainer's resistance follows the hills.

## Features

- **Bluetooth trainer connection.** Uses the standard FTMS (Fitness Machine) profile, so it works with Wahoo KICKR, KICKR CORE and KICKR SNAP on current firmware, as well as most other smart trainers. Trainers that only expose a Cycling Power service still work in read-only mode.
- **Resistance follows the road.** The current grade is sent to the trainer once a second, scaled by a *trainer difficulty* setting (default 50%).
- **Virtual bike.** An animated rider whose legs pedal at your real cadence and whose wheels turn at your virtual speed. The scene has parallax scenery, a road that climbs and descends, and kilometre or mile signs.
- **Realistic speed.** Your watts become speed through a physics model with gravity, rolling resistance, air drag and momentum, using your weight.
- **Ride stats.** Power with a 3-second average and FTP zone, cadence, speed, heart rate, distance, moving time, grade and elevation climbed, plus a 5 km elevation profile ahead.
- **Heart-rate strap** support (optional).
- **Demo ride** mode for trying it without a trainer: set power with a slider or the ↑/↓ keys.
- Metric and imperial units. Settings are saved in the browser.

## Browser support

The trainer connection uses [Web Bluetooth](https://developer.mozilla.org/docs/Web/API/Web_Bluetooth_API):

| Platform | Works? |
| --- | --- |
| Chrome or Edge on Windows, macOS, ChromeOS, Android | ✅ |
| iPhone / iPad | Use the free **Bluefy** browser (Safari doesn't support Web Bluetooth) |
| Firefox, Safari | ❌ (demo ride still works) |

Web Bluetooth only works on `https://` pages or `http://localhost`.

> Close the Wahoo app or Zwift before connecting. A trainer can usually only take control commands from one app at a time.

## Run it locally

```bash
npm install
npm run dev
```

Open the URL it prints (http://localhost:5173) in Chrome. Click **Connect trainer**, pick your KICKR from the list, and start pedalling.

## Deploy

Pushing to `main` builds the app and deploys it to GitHub Pages through `.github/workflows/deploy.yml`. Turn this on once under **Settings → Pages → Build and deployment → Source: GitHub Actions**. (Pages on a private repo needs a paid GitHub plan.)

## Project layout

```
src/
  ble/trainer.ts    FTMS + Cycling Power connection, packet parsing, grade control
  ble/heartRate.ts  Heart-rate strap
  physics.ts        Power → speed model
  course.ts         Endless rolling road (elevation + grade)
  render.ts         Canvas scene: scenery, road and animated rider; elevation profile
  settings.ts       Saved settings
  main.ts           App loop, HUD, controls
```
