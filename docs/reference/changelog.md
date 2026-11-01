# Changelog

This page is the history of merged work on `main`, grouped into releases by the pull request that merged them. Dates and subjects come from `git log --reverse --format='%h %ad %s' --date=short origin/main`.

The repository has no tags, so each group is named for the pull request that merged it.

## Unreleased

### Steadier rider, real freewheel sound, jump along the route in demo rides

- **Less wobble.** The bike's side-to-side rock with each pedal stroke is now at most about 1° (it was up to 3.4° on climbs and at low cadence), for you and the other riders. `MAX_ROCK` in `src/drivetrain.ts`.
- **Freewheel sound.** Rebuilt from a square-wave beep into a synthesised hub ratchet (`src/freewheel.ts`): a pre-rendered metallic pawl tick (six variants) played at the real ratchet rate, 36 engagement points × how much faster the wheel turns than the cassette. Coasting at 30 km/h that's about 140 ticks a second, a buzz that builds as the cranks spin down and slows to clicks as you stop. Ticks are scheduled ahead on the audio clock so the rate stays accurate at any frame rate.
- **Jump along the route (demo rides).** Click or tap the elevation profile to go to that point. It doesn't count as distance or climbing, and moves the ride's start, so no leaderboard time. Off during races and workouts.

### Rotating home hero

- The home page hero rotates between the pit bull chase and the original rider, crossfading every 10 seconds while the home page is open, and starts on the other one each visit. The second hero is only downloaded once the first has been up for a few seconds. Riders who prefer reduced motion or have data saver on get the still image, alternating per visit. `?hero=dog` or `?hero=rider` pins one.

### Wind and echelons, mini-map and climb preview

- **Wind.** Each stage has a prevailing wind (speed and direction) that the weather scales: light on clear days, stronger under cloud and strongest in rain, with gusts and a slow swing in direction. Drag now works on air speed (road speed plus headwind), so headwinds slow you, tailwinds help, and the pro teams and race field feel it too. A smart trainer is sent the headwind in its simulation parameters. Clouds drift with the wind and rain slants with it. A wind chip in the status bar shows an arrow (up is the way you ride), the speed and "Headwind", "Tailwind" or "Crosswind from the left". New setting **Wind** (on by default). `?wind=<m/s>,<degrees>` forces the wind for testing. New module `src/world/wind.ts`; `stepSpeed()` and `Trainer.setGrade()` gained optional headwind arguments.
- **Echelons.** In a crosswind the sheltered spot behind a rider moves to their downwind side (about 0.25 m per m/s of crosswind, up to 0.8 m). `draftFrom()` takes an optional `shift` in its `lateral` argument, auto-steer and the draft gauge's hint use it, and live riders line up on the diagonal. The pro teams (free ride, `peloton.ts`) and the race field (`raceSim.ts`, new optional `wind` option) form diagonal echelons.
- **Mini-map.** A round mini-map of the route (from the course centreline) with you, live riders, pro teams, the ghost, the finish and, in a race, sprint and summit markers. Click it to switch between the whole route (north up) and the road ahead (heading up). Redraws about 5 times a second. New settings switch **Mini-map and climb preview**, also in ☰ Menu.
- **Climb preview.** When a climb (over 3% for more than 500 m) starts within 2 km, a card shows its length, average and steepest grade and a coloured profile; on the climb it shows the distance to the top and the average grade still to come. New modules `src/climb.ts`, `src/climbUi.ts`, `src/miniMap.ts`, `src/windUi.ts`.

## Before pull request #1

### Initial commit (2026-10-30)

- `b8def0b`: an initial README stub, committed directly to `main`.

## Pull request #1: the 3D indoor cycling app (merged 2026-10-31)

Merge commit `ffcf874`. American Flyers: 3D indoor cycling app with Bluetooth trainer support.

- **First app.** A browser app that connects to a Wahoo or any FTMS smart trainer over Web Bluetooth, and rides a virtual bike along a rolling road. Includes FTMS connection with grade control, a Cycling Power fallback, an optional heart-rate strap, a power-to-speed model with gravity, rolling resistance and drag, a HUD with power zones, ride stats and an elevation strip, demo ride mode, and metric and imperial units.
- **3D world.** Rebuilt the ride scene in Three.js: a winding road from a cached centerline, procedural terrain tiles with forests, a road surface with lane markings and distance posts, a 3D bike and rider with IK legs, a sky dome with clouds and a mountain ring, sun shadows, haze, ACES tone mapping, and chase, side and rider camera views (button or **C** key). `?start=<km>` begins a ride partway along.
- **Landmarks.** GLB landmarks loaded from `public/models/` and placed beside the road. A start and finish gantry spans the road, and missing model files are skipped. Trees keep clear of landmark sites.
- **Generated models and textures.** Barn, diner, farmhouse, windmill, water tower, gas station, silos, covered bridge and rigged rider models, plus asphalt and grass textures, were generated with Higgsfield.
- **Stages.** A stage picker with profile thumbnails and `?stage=`. Heartland Rollers (endless), Route 66 Flats (25 km time-trial), and Alpe d'Huez (14 km, 1,118 m, per-kilometer gradients from swi-cycling.com, 21 numbered hairpins). Finite stages count down, show the next hairpin, and end with a finish screen.
- **Stelvio Pass.** A general mountain-climb builder, now used by Alpe d'Huez. Stelvio Pass from Prato: 24.5 km, 1,824 m, 48 numbered hairpins, with a painted checkered finish line.
- **Per-stage scenery.** Terrain, rock, snow and tree lines, forest cover and mountain height are set per stage. Steep slopes shade darker, and turn to rock.
- **Rider.** A rigged rider posed by inverse kinematics each frame, with the back, head and hands set for a riding position. Falls back to a built-in rider if the model is missing.

Pull request #1 also added a GitHub Pages deploy workflow, since removed in favor of Vercel.

## Pull request #2: workouts, data blocks, GPX routes and project memory (merged 2026-10-31)

Merge commit `a61d411`. Workouts, data blocks, GPX routes, and project memory.

- **Data blocks.** 24 selectable fields (power, W/kg, normalized power, max power, workout target and time left, cadence, speed, heart rate, distance, to go, grade, climbing, energy, TSS), chosen and ordered in a dialog, with the first shown large. Saved in settings.
- **Workouts.** A library of built-ins (Endurance, Sweet Spot, VO2 max, Over-Unders, Ramp FTP test), uploaded files, and created workouts, saved in browser storage. Imports Zwift `.zwo` and `.erg`/`.mrc` files, and exports `.zwo`.
- **ERG mode.** Uses the FTMS set-target-power command. Grade simulation resumes after a workout.
- **In-ride panel.** Target, step time left, next step, pause, skip, and ±5% intensity. A workout graph with the power trace replaces the elevation strip.
- **Summaries.** Average and normalized power, TSS and kJ at the end. The ramp test estimates FTP.
- **Workout creator.** Steady, ramp, interval and free-ride blocks, a live preview, TSS, watts at the rider's FTP, and save, save-and-ride, and `.zwo` export.
- **Statistics fix.** Ride statistics use exact elapsed time. They had been about 9% low at 10 Hz.
- **GPX routes.** Upload `.gpx` files from the stage picker. Routes are saved in browser storage and listed under *Your routes*. The road follows the smoothed bends, with elevation smoothed over about 80 m and gradients capped at 25%. Scenery scales to the route, and files without elevation ride flat.
- **Project memory.** `CLAUDE.md` records the Haiku preference for repository work, build commands and the Vercel deployment.

## Pull request #3: accounts, profiles, achievements and the admin dashboard (merged 2026-10-31)

Merge commit `bfd10f5`. Accounts, profiles, achievements, HR zones, feedback and admin dashboard.

- **Accounts.** Sign in with Google or Apple through Neon Auth. Settings, workouts and routes sync to the account.
- **Rides.** Saved automatically when a stage or workout finishes, on Reset, and every 5 minutes on long rides. Each ride keeps 1-second samples, best efforts, and time in heart-rate and power zones.
- **Profile.** Stats (totals, personal bests, distance per week, FTP progress, zone totals), achievements, and a ride list with graphs, zones and `.tcx` export.
- **Zones.** Heart-rate and power zone breakdowns after every ride, with a max HR setting.
- **FTP history.** Recorded on every change: by hand, from a ramp test, or at sign-up.
- **Feedback.** Ideas and bug reports, with status and replies.
- **Admin dashboard.** Riders, activity, signups and rides per day, top stages and workouts, ban and unban, and the feedback inbox.
- **Schema.** `db/schema.sql` added.

## Pull request #4: admin check fix (merged 2026-10-31)

- **Admin button.** The admin check now retries while the session settles after returning from Google, so admins reliably see 🛠 Admin.

## Pull request #5: realistic pedalling, home page and a visual refresh (merged 2026-10-31)

- **Virtual drivetrain.** Leg speed now follows road speed through real gearing (50/34 × 11–34) with automatic shifting, slow heavy strokes on a standing start, freewheeling, and a bike rock that grows with pedal force.
- **Home page.** A welcome screen with a cyclist hero (still and looping video made with Higgsfield) and free sign-in.
- **Visual refresh.** Sharper buttons, fields, sliders and dialogs.

## Pull request #6: documentation library (merged 2026-10-31)

- The `docs/` library: user, admin and developer guides, and reference pages.

## Pull request #7: headline, deploys and the Stelvio (merged 2026-10-31)

- Home headline: *Welcome to the free American Flyers Training Program*.
- Removed the GitHub Pages workflow; Vercel is the only deploy target.
- Stelvio Pass climbs to 2,758 m.

## Pull request #8: ride together, new climbs, and much more (merged 2026-10-31)

- **Riding together.** Signed-in riders on the same stage see each other on the road with name tags; 👥 *Riding now* list with gaps and *Ride with*.
- **New stages.** Hell of the West (the film's final stage, Idaho Springs to Echo Lake), Mont Ventoux, Col du Tourmalet, Monte Zoncolan.
- **Leaderboards and ghosts.** Weekly and all-time leaderboards from whole-stage rides (`activities.finish_s`); race your best or any leaderboard ride as a ghost.
- **Sound.** Wind, tyre hum, freewheel, crowds, interval beeps and a finish fanfare.
- **Virtual shifting.** 24 gears with on-screen and keyboard shifting; the gear changes the trainer's resistance.
- **Training plans.** Get Started, FTP Builder and Hell of the West, with five new built-in workouts.
- **First-ride setup**, **installable app** (manifest, service worker, icons), full screen and bigger numbers on TVs.
- **Tidier screen.** A ☰ Menu for everything but Stage, Workouts, 👥, Connect trainer and the account; data blocks across the top or in a column on the left or right.
- **Rider.** Shoes sit level instead of pointing up, with a little ankling.

## Pull request #9: home page copy (merged 2026-10-31)

- The home page leads with the Hell of the West, riding together, leaderboards and ghosts, and training plans.

## Pull request #10: email sign-up, drafting, pit bull hero, docs (merged 2026-10-31)

- **Email sign-up and sign-in.** Create an account with a rider name, email, password, weight and optional FTP; no phone number or address. Sign in, and reset a forgotten password by email. Sign in with Apple removed.
- **Drafting.** Riding behind another rider cuts your air drag by up to about a third (and lightens a smart trainer); a slipstream gauge shows the gap to the rider ahead, the drag saved and the watts it saves.
- **Second home hero.** A looping pit bull chase, taking turns with the original rider hero.
- **Docs.** Every guide updated for the latest features, and the languages and technologies listed in [Architecture](../developer-guide/architecture.md#languages-and-technologies).

## Pull request #11: Sentry and the pit bull hero (merged 2026-10-31)

- **Sentry error reporting** with `@sentry/browser`, on when the build has a DSN.
- The home page shows the pit bull hero on every visit (`?hero=rider` for the original).

## Pull request #12: pro teams (merged 2026-10-31)

- **Pro teams**: five computer-ridden teams with comedic near-miss names ride each stage two by two at 2.0–4.2 W/kg, in their own kit, with **Join** in 👥.

## Pull request #13: bigger draft behind a group (merged 2026-10-31)

- The draft counts the whole group ahead: up to about 54% on the back of a pro team, against 36% on one wheel.

## Unreleased (in review)

- **Automated tests and CI**: Vitest unit tests in `tests/unit/` (physics, drafting, drivetrain, stages, workouts and `.zwo` round trip, plans, GPX, ghosts, the race engine and the tour), a Playwright smoke test in `tests/e2e/` (loads the built app with Neon mocked, starts a demo ride, opens each main dialog, fails on page errors), `npm test` and `npm run test:e2e`, and a GitHub Actions workflow (`.github/workflows/ci.yml`) that builds and runs both on every pull request and push to `main`.
- **Steering**: steer across the road with **←** / **→** (or on-screen ◀ ▶ buttons on touch screens); the bike eases across over about 0.8 s and the cameras follow. **Auto-steer** (Settings, on by default) eases you onto the wheel of a rider just ahead if you haven't steered for 3 s. The draft is now lateral: full on their line, fading to nothing about 1.1 m across, and the draft gauge says which way to move when you're behind but off their line.
- **Time of day and weather** (☰ Menu → 🌤 Time & weather): Auto, dawn, day, dusk and night; Auto, clear, cloudy and rain. Night has a moon, stars and a front-light pool on the road; rain adds streaks, a wet glossy road, thicker fog and a soft rain sound. On Auto the stage sets the start (Route 66 and Hell of the West at dusk, Tourmalet cloudy), the light moves on about an hour per two minutes of riding, and the weather changes now and then. New module `src/world/atmosphere.ts` (and `rain.ts`).
- **Ride-ons**: send 👍 🔥 💪 👋 to a rider from 👥 or press **R** for the rider ahead; received ones show as a message and an emoji floating over the sender. Pro team riders sometimes reply. New table `ride_ons` and functions `send_ride_on()` and `my_ride_ons()`.
- **My kit** (☰ Menu → 🎨): jersey, second colour and bike frame, with presets, saved in `settings.kit`. Other riders see your kit: `ride_presence()` takes an optional `p_kit` (the old six-argument call still works) and `live_riders` has a `kit` column. `setTourJersey()` in `src/kit.ts` lays a tour jersey over your kit.
- **Hell of the West tour.** Two new stages from the film: Stage 1 *Morgul-Bismark* (two laps of the Boulder circuit, up The Wall) and Stage 2 *Tour of the Moon* (Rim Rock Drive, Colorado National Monument, with red rock desert scenery: `Scenery.palette = 'desert'`). The existing stage is now *Hell of the West · Stage 3: Echo Lake* (same id). **☰ Menu → 🏆 Hell of the West tour** races the three in order, with stage results and the general, points and mountains classifications (yellow, green and polka-dot jerseys), saved in `settings.tour`. Stages can be simulated. On a tour stage, lead a classification and your rider wears its jersey colours over your kit (`tourJersey()` → `setTourJersey()`).
- **Racing.** **🏁 Race this stage** on any stage with a finish: 12 pro teams of three riders on the start line, a 3-2-1 countdown, attacks on the climbs, an early breakaway, chases, cracks, merging groups and a sprint in the last 400 m, scaled to your FTP. A live race panel (position, gap, groups, next sprint or summit, jerseys) and results tables (top 20 and you). Same engine for "simulate this stage". `?timescale=` runs the clock faster for testing.

## Full commit list

For reference, every commit on `origin/main` up to pull request #3, in order. For later commits, run `git log --oneline origin/main`.

| Commit | Date | Subject |
| --- | --- | --- |
| `b8def0b` | 2026-10-30 | Initial commit |
| `8553834` | 2026-10-30 | Add American Flyers indoor cycling app |
| `a176b1b` | 2026-10-30 | Rebuild the ride scene in 3D with Three.js |
| `0b94d25` | 2026-10-30 | Add GLB landmark support and fix negative first-frame time step |
| `67d08ee` | 2026-10-31 | Add barn and diner landmark models |
| `7eec181` | 2026-10-31 | Add water tower landmark model |
| `2e04ba5` | 2026-10-31 | Add farmhouse, windmill and start/finish arch models; tune placement |
| `6c90554` | 2026-10-31 | Use generated asphalt and grass textures |
| `5f4a7df` | 2026-10-31 | Add gas station, silos and ride-through covered bridge landmark slots |
| `dc66507` | 2026-10-31 | Add gas station, silos, covered bridge and rigged rider models |
| `043fd5a` | 2026-10-31 | Add stages, including a real-gradient Alpe d'Huez, and a rigged 3D rider |
| `08d075d` | 2026-10-31 | Add Stelvio Pass, a painted finish line, and a 40-degree riding position |
| `ffcf874` | 2026-10-31 | Merge pull request #1 from Hodgy007/claude/virtual-bike-app |
| `3cc34d2` | 2026-10-31 | Add CLAUDE.md with project memory |
| `a179cda` | 2026-10-31 | Add selectable data blocks, workouts with ERG mode, and a workout creator |
| `a8c29e3` | 2026-10-31 | Add GPX route upload for practising real rides |
| `a61d411` | 2026-10-31 | Merge pull request #2 from Hodgy007/claude/virtual-bike-app |
| `c884260` | 2026-10-31 | Add accounts, profiles, achievements, HR zones, feedback and admin dashboard |
| `bfd10f5` | 2026-10-31 | Merge pull request #3 from Hodgy007/claude/virtual-bike-app |
