# Architecture

This page explains how the modules fit together: the frame loop, the trainer and heart-rate input, the physics and course, the HUD, the 3D world, workouts, routes, and the cloud layer, with a module diagram and the data flow between them.

## The shape of the app

American Flyers is a single-page app with no framework. `index.html` holds the markup, and `src/main.ts` is the entry point. It wires the modules together, owns the ride state, runs the frame loop and handles the top-bar buttons. Everything else is a module it calls.

Four things run on a timer or event, alongside the frame loop:

| Timer | Period | What it does | Where |
| --- | --- | --- | --- |
| Frame loop | Every animation frame (`requestAnimationFrame`) | Advances the ride, updates the 3D scene, and redraws the elevation strip every 200 ms. | `frame()` in `src/main.ts` |
| Trainer control | 1 second | Sends grade or target power to the trainer, if they've changed. | `setInterval` in `src/main.ts` |
| Autosave | 5 minutes | Saves a long ride while signed in. | `setInterval` in `src/main.ts` |
| Settings sync | 800 ms after the last change | Writes settings to the account. | `pushSettings` in `src/cloud/sync.ts` |

Device events (trainer and heart-rate notifications) arrive as Bluetooth callbacks and are stored in a shared `live` object. The frame loop reads that object once per frame.

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
    WB[workouts/graph.ts]
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
```

The diagram shows the main dependencies. A few are worth knowing about:

- **`terrain.ts` and `landmarks.ts` import each other.** `terrain.ts` calls `nearLandmark()` to keep trees away from landmarks, and `landmarks.ts` calls `heightAt()` to stand models on the ground. This works because both are only called at runtime, after both modules have loaded.
- **`stages.ts` and `world/noise.ts`.** Stage definitions use the noise helpers to shape their hills, and `routes/gpx.ts` reuses the stage helpers to build routes into stages.
- **`course.ts` is the single source of truth for the road.** Physics, the HUD, the scene, the elevation strip and the trainer's grade all ask `course.ts` where the road is and how steep it is.

## The frame loop

Each frame, `frame(now)` in `src/main.ts` does this, in order:

1. Clamps the frame time to 0–0.1 s, so a tab that was in the background can't jump ahead.
2. In demo mode, sets the power from the demo slider (or from the workout target, with a small wobble). Otherwise it checks the trainer's last reading, and zeroes power and cadence after 3 seconds of silence.
3. Reads the road's grade at the rider's distance, and advances speed with `stepSpeed()` from [Physics and stats](physics-and-stats.md).
4. Advances distance, moving time and work. It checks for the finish line, and totals climbing from the elevation at the rider's distance.
5. Advances the crank angle from the cadence, for the rig.
6. Records one statistics sample, and one recorder sample while moving.
7. Advances the workout player, if one is running. It finishes the workout when the clock runs out.
8. Calls `world.update()` to place the rider, build terrain and roads, and render.
9. Every 200 ms, updates the HUD and the elevation strip (or the workout graph).

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

When you sign in, the account is the source of truth. The browser's copies are a working cache, so the app keeps running if the network drops. See [Backend and database](backend-and-database.md#sync-rules).

## The cloud layer

`src/cloud/` talks to Neon. `client.ts` builds the client from `@neon/neon-js`. `account.ts` holds the current user. `sync.ts` reads and writes every table the browser can touch, including the admin functions. `recorder.ts` records rides and writes `.tcx` files. `achievements.ts` works out badges from rides and FTP history. `ui.ts` draws the sign-in, profile, feedback and admin dialogs, and `charts.ts` draws their charts.

Nothing in the cloud layer runs on the frame loop. Every call is triggered by a user action, a ride event, or the 5-minute autosave.

## Where to start reading

- To follow a ride from the trainer to the screen, read `onReading()` and `frame()` in [`src/main.ts`](../../src/main.ts), then [`src/physics.ts`](../../src/physics.ts).
- To understand the road, read [`src/course.ts`](../../src/course.ts) and [`src/stages.ts`](../../src/stages.ts).
- For the full file list, see [Project structure](project-structure.md).
