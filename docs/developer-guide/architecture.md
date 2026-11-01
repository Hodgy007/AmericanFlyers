# Architecture

This page explains how the modules fit together: the frame loop, the trainer and heart-rate input, the physics and course, the HUD, the 3D world, workouts, routes, and the cloud layer, with a module diagram and the data flow between them.

## Languages and technologies

| Part | Language or format | Notes |
| --- | --- | --- |
| App code | **TypeScript** (strict), compiled to JavaScript | Everything in `src/`. `npm run build` type-checks with `tsc --noEmit`, then bundles with Vite. |
| Page markup | **HTML** | `index.html`: the home page, the hub's header and containers, top bar, panels and every dialog. |
| Styles | **CSS** | `src/style.css`, plain CSS with custom properties (no preprocessor or framework). |
| Database | **SQL** (PostgreSQL, PL/pgSQL functions) | `db/schema.sql`: tables, row-level security policies and security-definer functions, run on Neon. |
| Service worker | **JavaScript** | `public/sw.js`, served as-is (not bundled). |
| App manifest | **JSON** | `public/manifest.webmanifest`. |
| Workout files | **XML** | Zwift `.zwo` import and export; `.erg` and `.mrc` are plain-text formats. Rides export as `.tcx` (XML). |
| Routes | **XML** | `.gpx` uploads. |
| 3D models | **glTF binary** (`.glb`) | `public/models/`, generated with Higgsfield. |
| Docs | **Markdown** | `docs/` and `README.md`. |

Libraries: **Three.js** (3D rendering), **@neon/neon-js** (Neon Auth and the Data API), **@sentry/browser** (crash reports, only when the build has a DSN), and on the server **@anthropic-ai/sdk** with **zod** (the AI function in `api/`). Browser APIs: **Web Bluetooth** (trainer and heart-rate strap), **WebGL** (through Three.js), **Web Audio** (ride sounds), the **Fullscreen** and **Service Worker** APIs. Build tool: **Vite**. Hosting: **Vercel**. Backend: **Neon** (Postgres, Neon Auth, Data API). There's no server code of our own: the browser talks to Neon directly, and the database enforces who can see what.

## The shape of the app

American Flyers is a single-page app with no framework. `index.html` holds the markup, and `src/main.ts` is the entry point. It wires the modules together, owns the ride state, runs the frame loop and handles the top-bar buttons. Everything else is a module it calls.

Four things run on a timer or event, alongside the frame loop:

| Timer | Period | What it does | Where |
| --- | --- | --- | --- |
| Frame loop | Every animation frame (`requestAnimationFrame`) | Advances the ride, updates the 3D scene, and redraws the elevation strip every 200 ms. | `frame()` in `src/main.ts` |
| Trainer control | 1 second, and at once after a gear change | Sends grade (plus the virtual gear and the draft's wind factor) or ERG target power to the trainer, if they've changed. | `controlTrainer()` in `src/main.ts` |
| Riding together | 2 seconds | Sends your position and fetches the other riders on your stage. | `Presence` in `src/cloud/presence.ts` |
| Ride-ons | 4 seconds | Fetches ride-ons other riders have sent you (only while signed in and riding). | `RideOns` in `src/cloud/rideOns.ts` |
| Autosave | 5 minutes | Saves a long ride while signed in. | `setInterval` in `src/main.ts` |
| Settings sync | 800 ms after the last change | Writes settings to the account. | `pushSettings` in `src/cloud/sync.ts` |

Device events (trainer and heart-rate notifications) arrive as Bluetooth callbacks and are stored in a shared `live` object. The frame loop reads that object once per frame.

## How the app starts: home, hub, ride

`main.ts` builds the world and every module, then hands over to the start flow:

```
signed in last time? (localStorage americanflyers.signedIn)
  yes -> hub (placeholders from index.html paint first, then cached data, then the account's)
  no  -> home page -> sign in, or "Ride without an account" -> hub
hub -> Ride (or Free ride, Ride it, Race, Join) -> the ride
ride -> ☰ Menu -> 🏠 Hub, or the finish card's "Back to the hub" -> hub
```

- **Before the hub (the old flow):** a signed-in rider skipped the home page and landed on the bike; everyone else saw the home page, and both of its exits hid it and showed the ride.
- **The home page** (`home.ts`) now only leads to the hub: `openHub` for sign-in and *Ride without an account*, `requestHub` for the brand button. A sign-in made mid-ride changes nothing on screen.
- **The hub** (`src/hub/`) is a full-screen layer over the world. `hub.open()` adds the body classes `at-home` (the ride's own panels, riding together and ride-ons stand down, as on the home page) and `at-hub`, and tells `main.ts` through `onVisibility`. While it is open `frame()` does no ride physics: `hubFrame()` only renders the world, slowly orbiting your rider (`World.setOrbit()`), at about 30 fps (1 fps on phones and with reduced motion).
- **Ride** calls `startFromHub()` in `main.ts`: close the hub, `chooseStage()` if the stage differs (which starts afresh), then `startWorkout()` if a workout was chosen. The first time, `leaveHub()` also starts the first-ride guide or the Bluetooth note, as leaving the home page used to.
- **Back to the hub** is `goToHub()`: for a ride of a minute or more, a race or a group ride it asks first (`hub/leave.ts`), then stops the workout, calls `resetRide()` (which quietly saves a ride worth keeping and leaves a race or event) and opens the hub.
- **The session check** (`restoreSession()`) answers after the hub is up. `hub.sessionSettled()` turns the hub into a guest's if a signed-in hint turned out wrong.
- **Things the hub listens for.** `main.ts` dispatches `af:hub-refresh` on `document` (`stage`, `ride`, `plan`) when the app moves under an open hub; the hub also looks again when any dialog closes and when the garage's wallet changes.
- **Speed.** The shell and header are in the main bundle; each section is a dynamic `import()` loaded when first shown (and warmed when idle); the turntable (`garage/preview.ts`, three.js) is imported only when the Garage section is on screen and is disposed when it isn't; canvases draw only while visible (`dom.ts`); account data is fetched after the first paint.

## Module diagram

```mermaid
flowchart LR
  subgraph Devices
    TR[ble/trainer.ts<br/>FTMS and Cycling Power]
    HR[ble/heartRate.ts]
  end

  MAIN[main.ts<br/>frame loop and ride state]

  subgraph Ride model
    PHYS[physics.ts]
    STATS[stats.ts]
    ZONES[zones.ts]
    COURSE[course.ts]
    STAGES[stages.ts]
    ROUTES[routes/gpx.ts<br/>routes/library.ts]
  end

  subgraph Display
    HUD[hud.ts]
    PROF[profile.ts]
    WORLD[world/world.ts]
    OTH[world/others.ts<br/>other riders and ghosts]
    WB[workouts/graph.ts]
    SND[sound.ts]
  end

  subgraph Riding
    DT[drivetrain.ts<br/>gears and legs]
    DR[draft.ts]
    GH[ghost.ts]
    PL[plans.ts]
  end

  subgraph Workouts
    WPLAY[workouts/player.ts]
    WMODEL[workouts/model.ts]
    WFILES[workouts/files.ts]
    WLIB[workouts/library.ts]
    WUI[workouts/ui.ts]
  end

  subgraph Cloud
    ACC[cloud/account.ts]
    SYNC[cloud/sync.ts]
    REC[cloud/recorder.ts]
    ACH[cloud/achievements.ts]
    CUI[cloud/ui.ts]
    EA[cloud/emailAuth.ts]
    PRES[cloud/presence.ts]
    NEON[(Neon Auth and Data API)]
  end

  TR -- readings --> MAIN
  HR -- bpm --> MAIN
  MAIN --> PHYS
  MAIN --> STATS
  STATS --> ZONES
  MAIN --> COURSE
  COURSE --> STAGES
  ROUTES --> STAGES
  MAIN --> ROUTES
  MAIN --> HUD
  HUD --> PROF
  MAIN --> PROF
  MAIN --> WORLD
  MAIN --> WPLAY
  WPLAY --> WMODEL
  WUI --> WLIB
  WUI --> WFILES
  WUI --> WB
  MAIN -- control --> TR
  MAIN --> REC
  MAIN --> SYNC
  MAIN --> CUI
  CUI --> ACC
  CUI --> SYNC
  CUI --> ACH
  SYNC --> NEON
  ACC --> NEON
  SYNC --> WLIB
  SYNC --> ROUTES
  WORLD --> COURSE
  WORLD --> OTH
  MAIN --> DT
  MAIN --> DR
  MAIN --> GH
  MAIN --> PL
  MAIN --> SND
  MAIN --> PRES
  PRES --> NEON
  CUI --> EA
  EA --> ACC
```

The diagram shows the main dependencies. A few are worth knowing about:

- **`terrain.ts` and `landmarks.ts` import each other.** `terrain.ts` calls `nearLandmark()` to keep trees away from landmarks, and `landmarks.ts` calls `heightAt()` to stand models on the ground. This works because both are only called at runtime, after both modules have loaded.
- **`stages.ts` and `world/noise.ts`.** Stage definitions use the noise helpers to shape their hills, and `routes/gpx.ts` reuses the stage helpers to build routes into stages.
- **`course.ts` is the single source of truth for the road.** Physics, the HUD, the scene, the elevation strip and the trainer's grade all ask `course.ts` where the road is and how steep it is.

## The frame loop

Each frame, `frame(now)` in `src/main.ts` does this, in order:

1. Clamps the frame time to 0–0.1 s, so a tab that was in the background can't jump ahead.
2. In demo mode, sets the power from the demo slider (or from the workout target, with a small wobble). Otherwise it checks the trainer's last reading, and zeroes power and cadence after 3 seconds of silence.
3. Gets the other riders on the stage (predicted for now from their last update), runs steering and auto-steer (`steering.ts`, then `world.setLane()`), and works out the draft from the rider just ahead, scaled by how far across from their line you are (`draft.ts`).
3. Gets the other riders on the stage (predicted for now from their last update) and works out the draft from the rider just ahead (`draft.ts`). In a race (see [Racing and the tour](racing-and-tour.md)) it first steps the race (`race.update()`), and the pro teams are the racers; during the countdown your speed is held at zero.
4. Reads the road's grade at the rider's distance, and advances speed with `stepSpeed()` from [Physics and stats](physics-and-stats.md), with the drag area reduced by the draft.
5. Advances distance, moving time and work. It checks for the finish line, and totals climbing from the elevation at the rider's distance.
6. Updates the drivetrain (`drivetrain.ts`): the gear (automatic, or the rider's virtual gear), crank angle and bike rock, so the legs turn at a speed the wheels could produce.
7. Records one statistics sample, and one recorder sample while moving.
8. Advances the workout player, if one is running, with countdown beeps. It finishes the workout when the clock runs out.
9. Updates the sounds (wind, tyres, freewheel ratchet from `freewheel.ts`, crowds, rain).
10. Passes the other riders and the ghost to the world, and calls `world.update()` to place every rider, build terrain and roads, and render.
11. Every 200 ms, updates the HUD, the status line (including the gap to the ghost), the draft gauge, and the elevation strip (or the workout graph).

The frame loop never waits on the network. Saving, syncing and loading happen in event handlers and background calls.

## State and storage

Ride state lives in module-level objects in `src/main.ts`: `live` (what the devices report), `ride` (distance, speed, climbing and so on), `stats` and `workoutStats` (see [Physics and stats](physics-and-stats.md)), and `recorder` (per-second samples for the saved ride). Starting a new ride replaces these.

Persistent state is in `localStorage`, under these keys:

| Key | Holds | Module |
| --- | --- | --- |
| `americanflyers.settings` | Settings, including data blocks | `src/settings.ts` |
| `americanflyers.workouts` | The rider's own workouts | `src/workouts/library.ts` |
| `americanflyers.routes` | The rider's uploaded GPX routes | `src/routes/library.ts` |
| `americanflyers.pendingRide` | A ride held back until sign-in | `src/main.ts` |
| `americanflyers.signedIn` | A hint that skips the home page for signed-in riders (they open on the hub) | `src/home.ts` |
| `americanflyers.hub` | The hub's cache: your name, garage wallet and ride summary from last visit, so it paints at once | `src/hub/cache.ts` |
| `americanflyers.hubStage` | The stage last started from the hub | `src/hub/cache.ts` |
| `americanflyers.onboarded` | The first-ride guide has been done or skipped | `src/onboarding.ts` |

Settings now also hold the training plan in progress, the data-block position, sound, virtual shifting, ghost and ride-together switches. The service worker keeps its own cache of the app's files (see [Project structure](project-structure.md)).

When you sign in, the account is the source of truth. The browser's copies are a working cache, so the app keeps running if the network drops. See [Backend and database](backend-and-database.md#sync-rules).

## The cloud layer

`src/cloud/` talks to Neon. `client.ts` builds the client from `@neon/neon-js`. `account.ts` holds the current user and signs in with Google or with email and password (sign-up, sign-in, password reset). `emailAuth.ts` draws the email form. `presence.ts` runs riding together. `sync.ts` reads and writes every table the browser can touch, including the admin functions. `recorder.ts` records rides and writes `.tcx` files. `achievements.ts` works out badges from rides and FTP history. `ui.ts` draws the sign-in, profile, feedback and admin dialogs, and `charts.ts` draws their charts.

Nothing in the cloud layer runs on the frame loop. Every call is triggered by a user action, a ride event, the 2-second riding-together update, or the 5-minute autosave.

## Lazy loading

The first visit downloads only what draws the first frame: the entry chunk (`main.ts` and the ride, world and HUD code) and the `vendor-three` chunk. Everything else is split off with dynamic `import()` and loaded on first use, so a phone isn't parsing the garage, the admin dashboard or the privacy text before the road appears.

| What | Where it loads from | Loads when |
| --- | --- | --- |
| Neon SDK (`vendor-neon`) | `cloud/client.ts` | After the first frame (`restoreSession()`), or at the first database call. `neon` there is a small recording proxy: `neon.from(...).select(...)` and `neon.auth.getSession()` look and chain as before, and awaiting one loads the SDK and replays the calls on the real client. |
| Sentry SDK | `monitoring.ts` | After the first frame (`startMonitoring()`). Until then two tiny listeners keep crashes, and hand them to Sentry once it is up. |
| Sign-in, profile, feedback, admin dialogs | `cloud/ui.ts` (via `cloud/accountBar.ts`, which keeps the 👤 button and admin button) | First click on 👤, Admin, Feedback, or any `openSignIn()`. |
| Workout library and creator, `.zwo` import | `workouts/ui.ts` | First click on Workouts. |
| Garage and store, with its 3D turntable | `garage/garageUi.ts`, `garage/preview.ts` | First click on Garage. |
| Share card | `garage/shareUi.ts`, `shareCard.ts` (buttons in `garage/shareButton.ts`) | First press of a 📤 Share button. |
| Tour, Events, Leaderboard, Plans, Kit, Time & weather dialogs | `tourUi.ts`, `eventsUi.ts`, `leaderboardUi.ts`, `plansUi.ts`, `kitUi.ts`, `atmosphereUi.ts` | First click on their button. |
| First-ride guide | `onboarding.ts` (`onboardingState.ts` stays eager) | When it first opens. |
| Privacy text | `privacyText.ts` (loaded by `privacyUi.ts`) | First time the dialog opens. |
| Race screens and the commentator | `raceUi.ts`, `commentary.ts` | When a race starts. |
| Email sign-up form on the home page | `cloud/emailAuth.ts` | First tap of *Sign up with email*. |
| GPX parser | `routes/gpx.ts` | When a file is chosen. |
| Landmark models (`public/models/*.glb`) | `world/landmarks.ts` | When a landmark that uses the file comes within range. |
| Hero videos | `home.ts` | After the first frame. |

How it works, in `src/lazy.ts`:

- `lazy(() => import('./x'))` wraps a module (or `import(...).then((m) => m.initX(deps))` to build a UI once). `.get()` loads it once, `.peek()` returns it if it has arrived, `.prefetch()` loads it quietly.
- `use(lazyThing, (ui) => ui.open(), button)` runs something as soon as the module is there. If the wait passes 150 ms the button gets the `lazy-busy` class (a pulse, `cursor: progress`); if the load fails a toast says so and the next click tries again.
- `loadOnClick(button, lazyThing)` is for modules that attach their own handler to a button when built (Events, Leaderboard): the first click loads the module, then is replayed.
- `prefetchWhenIdle([...])`, called from `afterFirstFrame()` in `main.ts`, fetches the likely next dialogs one at a time in spare moments (not on data saver or 2G). By the time a rider taps, the chunk is usually cached. The service worker caches `/assets/*` on first fetch, so chunks work offline after the first visit.

**Adding a new lazy module:** give it an `initX(deps)` that returns `{ open() }`, wrap it in `lazy()` in `main.ts` next to the others, open it with `use(...)`, and add it to the list in `afterFirstFrame()` if it's likely to be opened. Don't import it statically from anywhere on the first-frame path (`import type` is fine); if another module needs a small part of it, move that part into its own file, as `onboardingState.ts` and `shareButton.ts` do. Check `npm run build`: the module should show up as its own file in `dist/assets/` and not in the entry chunk.

`vite.config.ts` puts `three`, the Neon libraries and Sentry in `vendor-*` chunks. They change far less often than the app, so browsers keep them across deploys.

## Racing

`src/raceSim.ts` is a self-contained race engine (riders in groups, attacks, breakaways, chases, sprints, classifications). `src/peloton.ts` hands the field to it in race mode, `src/race.ts` runs the countdown and the live panel's numbers, `src/raceUi.ts` draws them, and `src/tour.ts` / `src/tourUi.ts` keep the Hell of the West tour in `settings.tour`. See [Racing and the tour](racing-and-tour.md).

## Where to start reading

- To follow a ride from the trainer to the screen, read `onReading()` and `frame()` in [`src/main.ts`](../../src/main.ts), then [`src/physics.ts`](../../src/physics.ts).
- To understand the road, read [`src/course.ts`](../../src/course.ts) and [`src/stages.ts`](../../src/stages.ts).
- For the full file list, see [Project structure](project-structure.md).
