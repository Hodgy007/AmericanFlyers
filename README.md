# American Flyers

An indoor cycling app that runs in your browser. Connect a Wahoo smart trainer over Bluetooth and ride a 3D bike through an endless, winding valley. The trainer's resistance follows the hills.

## Documentation

The full documentation library is in [`docs/`](docs/README.md). Start with the [user guide](docs/user-guide/getting-started.md) if you ride, the [admin guide](docs/admin-guide/admin-dashboard.md) if you run the site and its database, or the [developer guide](docs/developer-guide/architecture.md) if you work on the code.

## Features

- **Bluetooth trainer connection.** Uses the standard FTMS (Fitness Machine) profile, so it works with Wahoo KICKR, KICKR CORE and KICKR SNAP on current firmware, as well as most other smart trainers. Trainers that only expose a Cycling Power service still work in read-only mode.
- **Resistance follows the road.** The current grade is sent to the trainer once a second, scaled by a *trainer difficulty* setting (default 50%).
- **Stages** (🏁 button):
  - *Heartland Rollers*: endless farmland, free ride.
  - *Route 66 Flats*: 25 km time trial.
  - *Alpe d'Huez*: 14 km at 8% from Le Bourg-d'Oisans with real per-kilometre gradients (swi-cycling.com) and all 21 numbered hairpins.
  - *Stelvio Pass*: 24.5 km at 7.5% from Prato allo Stelvio to 2758 m through 48 numbered hairpins. Totals match published figures; the per-kilometre shape is approximated.
  - *Hell of the West*: the final stage from the film *American Flyers*, 20.8 km from Idaho Springs up Chicago Creek to the sprint at Echo Lake (3,235 m), where it was filmed.
  - *Mont Ventoux* (21.4 km at 7.5% from Bédoin), *Col du Tourmalet* (19 km at 7.4% from Luz-Saint-Sauveur) and *Monte Zoncolan* (10.1 km at 11.9% from Ovaro). Totals match published figures; the per-kilometre shapes are approximated.

  - *Your routes*: upload a `.gpx` file (from Strava, Komoot, RideWithGPS, Garmin…) in the stage picker to practise it. The road follows its bends and its smoothed elevation profile (gradients capped at 25 %), with scenery scaled to the route: farmland for flat routes, forests, rock and snow at their real altitudes for mountain ones. Routes are saved in the browser.

  Stages with a finish line count down the distance, show the next hairpin, and end at a checkered line under the arch with your time, average power and speed.
- **3D world (Three.js).** A winding road through low-poly hills, forests, fields and distant mountains, with sunlight, shadows, haze and clouds. The terrain is generated on the fly as you ride, so the road never ends.
- **3D rider.** A rigged rider model (generated with Higgsfield) posed on the bike every frame: legs follow the pedals at your real cadence, hands on the hoods, head up. The wheels turn at your virtual speed.
- **Roadside landmarks:** a start/finish arch, red barn, farmhouse, windmill, retro diner and water tower, generated with Higgsfield (image → 3D) and placed along the route. See `public/models/README.md` to add or swap models.
- **Three camera views:** chase, side-on and the rider's own view. Switch with the 🎥 button or the **C** key.
- **Realistic speed.** Your watts become speed through a physics model with gravity, rolling resistance, air drag and momentum, using your weight.
- **Data blocks** (✎ next to the numbers): choose which of 24 fields to show (power, 1 s power, W/kg, average, normalized and max power, workout target, interval and workout time left, cadence, speed, heart rate, distance, km to go, time, grade, climbing, elevation, energy, TSS) and their order. The first one is shown large. Saved in the browser.
- **Workouts** (🏋 button): ride structured workouts in ERG mode, where the trainer holds the target power. Built-ins include Endurance, Sweet Spot, VO2 max, Over-Unders and a Ramp FTP test that estimates your FTP. Upload Zwift `.zwo`, `.erg` or `.mrc` files. While riding: pause, skip, ±5 % intensity, a workout graph with your power trace, and a summary (avg/normalized power, TSS, kJ) at the end.
- **Workout creator**: build workouts from steady, ramp, interval and free-ride blocks with a live preview, TSS estimate and watts at your FTP; save them to your library or export as `.zwo`.
- **Heart-rate strap** support (optional).
- **Demo ride** mode for trying it without a trainer: set power with a slider or the ↑/↓ keys.
- Metric and imperial units. Settings are saved in the browser (and in your account when signed in).
- **Accounts** (👤 button): sign in with Google or Apple. Your settings, workouts and routes sync to your account, and every ride over a minute is saved (when you finish a stage or workout, press Reset, or every 5 minutes on long rides).
- **Profile:**
  - *Stats*: totals, personal bests (5 s, 1, 5 and 20 min power), distance per week, FTP progress, and time in heart-rate and power zones across all rides.
  - *Achievements*: badges for finishing the stages, distance and climbing milestones, streaks, power targets, ramp tests and FTP gains.
  - *Rides*: every saved ride with power and heart-rate graphs, zones, best efforts, `.tcx` export (for Strava, TrainingPeaks, Garmin Connect) and delete.
- **Heart-rate and power zones** after every ride, based on your max HR (5 zones) and FTP (6 zones), both set in ⚙ Settings.
- **FTP history**: every change (by hand, from a ramp test, or at sign-up) is recorded and charted.
- **Feedback** (💬 button): riders send ideas and bug reports and see the status and any reply.
- **Riding together** (👥 button): signed-in riders on the same stage see each other on the road, with name tags, a *Riding now* list with gaps, and *Ride with* to join someone. Switch it off in Settings.
- **Leaderboards and ghosts** (☰ Menu → 🏆): fastest whole-stage rides this week and all time, and see-through ghosts of your best ride or anyone's on the board.
- **Training plans** (📅 in Workouts): Get Started, FTP Builder and Hell of the West, with sessions that tick off as you ride.
- **Sound**: wind, tyre hum, freewheel, crowds on the hairpins, interval beeps and a finish fanfare (☰ Menu or **M**).
- **Virtual shifting** (Settings): 24 virtual gears with on-screen −/+ buttons and keys; harder gears push back harder.
- **First-ride setup**, **install as an app** (⬇ Install app, or Add to Home Screen), full screen (**F**), and bigger numbers on TVs.
- **Tidy top bar**: Stage, Workouts, 👥, Connect trainer and your account stay in view; everything else is in the **☰ Menu**. The data blocks can sit across the top or in a column on the left or right (✎ → Position).
- **Admin dashboard** (☰ Menu → 🛠, admins only): registered and active riders, rides, hours, distance, signups and rides per day, top stages and workouts, the rider list with ban/unban, and the feedback inbox (status, replies, delete). Admin access is checked in the database.

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

To pick a stage or start partway along it, add `?stage=` and `?start=` (km), e.g. http://localhost:5173/?stage=alpe-dhuez&start=6 drops you halfway up the Alpe.

## Deploy

Vercel (project `americanflyers`) builds and deploys `main` on every push.

## Backend (Neon)

Accounts and data live in Neon (project `americanflyers`, eu-west-2):

- **Neon Auth** handles sign-in with Google and Apple. Add each site URL under *Auth → Trusted domains*. Apple needs your own Apple Developer credentials (Services ID, Team ID, Key ID and the `.p8` key) under *Auth → OAuth providers*, with the return URL `…/neondb/auth/callback/apple`.
- The **Data API** lets the browser read and write the tables directly; row-level security limits each rider to their own rows, and admin functions check `public.is_admin()`.
- The schema is in `db/schema.sql`. Admins are listed in `public.admins` (by email).
- The endpoints default to the production project; override with `VITE_NEON_AUTH_URL` and `VITE_NEON_DATA_API_URL`.

## Project layout

```
src/
  ble/trainer.ts     FTMS + Cycling Power connection, packet parsing, grade control
  ble/heartRate.ts   Heart-rate strap
  physics.ts         Power → speed model
  stats.ts           Ride statistics (averages, normalized power, TSS, best efforts, zones)
  zones.ts           Heart-rate and power zones, zone breakdown bars
  cloud/             Neon client, sign-in, sync, ride recorder + .tcx export, achievements,
                     charts, and the profile / feedback / admin UI
  hud.ts             Data blocks and the data-block chooser
  workouts/          Workout model, built-ins, .zwo/.erg/.mrc import + .zwo export,
                     library (browser storage), player, graph, library + creator UI
  stages.ts          Stage definitions: profiles, bends, scenery, landmarks, signs
  routes/            GPX parsing, route → stage conversion, saved routes
  course.ts          The current stage's road: elevation, grade, heading, centreline
  world/world.ts     Three.js renderer, lighting, cameras; places the rider each frame
  world/terrain.ts   Hills and forests built in tiles around the rider
  world/road.ts      Road surface, marker posts and distance signs
  world/rider.ts     3D bike and rider with pedalling animation
  world/sky.ts       Sky dome, distant mountains, clouds
  world/noise.ts     Deterministic noise helpers
  profile.ts         Elevation profile strip
  settings.ts        Saved settings
  main.ts            App loop, HUD, controls
```
