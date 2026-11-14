# Improvement plan (November 2026)

Status: **in progress.** This page lists the fixes that came out of a review of the app on 12 November 2026, in the order they should be done, and what "done" means for each. It is a working document: when everything here is built, fold what still matters into the other guides and delete it.

The review looked at the code on `main`, measured the build, and used what the CI failures of that week exposed. It did not profile on a real GPU or phone, or test with a real trainer.

## Workstreams

Four run side by side, because they touch different files. The fifth waits for the first, because both change `src/main.ts`.

### A. Ride timing: KOM efforts and demo power (done)

Both suspected bugs were investigated. Neither was what it looked like; one real bug was found and fixed.

1. **KOM efforts "lost" when frames are slow or the tab is hidden: the hypothesis was wrong.**
   - `komUi.frame()` (which feeds `SegmentTracker`) has been called from `simStep()` since the segments were added, once per substep of at most 0.1 s real time, and only the panel's redraw (`komUi.update()`) is on the HUD's 200 ms schedule. The tracker never sees a gap of more than a substep: 1.5 m at 15 m/s, 30 m at `?timescale=20`. A hidden tab is stepped by the background timer through the same `simulate()`. So `JUMP_M` (150 m) cannot be met by slow frames or hidden tabs. The plan text above was written from a misreading of `frame()`.
   - What the CI saw ("--", "No time yet") was the second bug below: the demo ride was being stopped and reset by the late sign-in, so the rider never reached the segment.
   - Added: unit tests that drive the tracker through a `RideClock` with frames 5 s and 1 s apart, at 1× and `?timescale=20` (same time and splits as dense frames), plus the contract that one update per 10 s frame would void it (`tests/unit/segments.test.ts`); a browser test that rides The Wall with one frame a second at 20× and gets the result toast and all 19 splits (`tests/e2e/rideTiming.spec.ts`). The existing KOM browser tests were not switched to `slowFrames`.
   - Checked per step, not per frame: recorder samples, statistics, workout player, race, peloton, AI coach and rival, steering, drivetrain, finish check, snapshot (time-based, ticked from both loops) are all in `simStep()` or time-based. Still on the HUD's 200 ms schedule in `render()`, so skipped while the tab is hidden: the "no finish line: 30 minutes counts as done" plan credit (`ride.planCounted`; it fires when the tab is next shown), `updateEvent()` and `updateCommentary()` (event drop-out status and race commentary; both look at the clock or the race state, so they catch up). Not fixed: none loses data, and they are not the same bug.
2. **The demo rider's power fading to 0 W: an app bug, but not a physics or `?timescale` one.**
   - Cause: `onAccountChange` in `src/main.ts` called `abandonRide()` whenever the account id differed from `rideUserId`, including the first change from "no account yet" to the signed-in rider. With the signed-in hint the hub shows at once, the session comes back later, and a rider who had already pressed Ride lost the demo (`setDemo(false)`, so the stale-reading rule zeroed power) and the ride (`resetRide()`: distance and time back to 0, speed 0). On the test machine the session landed 5 to 15 s in, while the page was busy drawing in software, which is why it looked like a fade at "about 70 s of ride time" at 20× and went away with 250 ms frames. The slider kept reading 250 W; the demo panel and "Stop demo" button had switched off.
   - Fix: only abandon when the ride had an owner (`hadOwner`): a ride started on the hint is the returning rider's own. Signing out, or switching to another account, still stops the ride.
   - Test: `tests/e2e/rideTiming.spec.ts` holds the session back 4 s (new `sessionDelayMs` option of `mockNeon`), starts a demo ride and checks power, the demo button and the ride clock after it lands.
   - `slowFrames` itself is fine; its caveat is replaced by a note (`tests/e2e/slowFrames.ts`).

### B. First load: fetch a stage's data when it is picked

- The entry file is 214 kB compressed, and Three.js is another 176 kB, before the road appears.
- `src/stages.ts` imports all 16 baked routes in `src/routes/real/` and the whole Kestrel Vale world, although a rider uses one stage at a time.
- **Measure first.** Find what is in the entry file (for example with `npx vite-bundle-visualizer`, run once, not added as a dependency) and list the five largest parts.
- **Done (workstream B).** What was in the 569 kB entry chunk (rendered size from rollup, gzip of each module on its own): `src/world/*` 227 kB / 80 kB gz, the baked roads `src/routes/real/*` 103 kB / 50 kB, `main.ts` 102 kB / 29 kB, `stages.ts` (definitions of every stage) 41 kB / 13 kB, `src/cloud` 40 kB, `src/hub` 37 kB, Kestrel Vale and `worlds/` 34 kB / 11 kB, `ble` 22 kB, `raceSim` 21 kB. So the stage data was the second-largest group (18%), and with the stage definitions and the Kestrel Vale world 31% of the file; the 3D world code is the largest but is needed for the first frame.
  - Moved: every stage but Heartland and Route 66 now loads on demand (`stageDefs/`, `worlds/kestrelVale.ts`, with their baked roads); the hub, schedule and lists read a generated, test-checked `stageCatalogue.ts`. See [Stages and GPX](stages-and-gpx.md#how-a-stage-is-loaded) and the lazy-loading table in [Architecture](architecture.md#lazy-loading).
  - Page entry: `boot.ts` (tiny) fetches the opening stage's road, then imports `main.ts`; `vite.config.ts` preloads the app chunk and its stylesheet from `index.html`, so there is no extra round trip.

  | Before the first frame | Before | After |
  | --- | --- | --- |
  | Entry chunk (`index`, raw / gzip) | 568.8 kB / 218.3 kB | 35.8 kB / 14.4 kB (`boot` + catalogue + stage loader) |
  | App chunk (`main`, raw / gzip) | (in the entry) | 409.7 kB / 148.7 kB |
  | Entry + app | 568.8 kB / 218.3 kB | 445.5 kB / 163.1 kB (-22% / -25%) |
  | All JS fetched (entry, app, `vendor-three`, 2 small shared chunks) | 1,274.6 kB / 398.2 kB | 1,154.1 kB / 344.4 kB (-9.5% / -13.5%) |
  | One stage on demand (Alpe d'Huez / Stelvio / Pacific Coast, gzip) | 0 | about 6 / 5 / 6 kB |

  Not moved, and why: the race engine, `music`, `devicesUi`, `workouts` and the cloud code are wired into `main.ts` in many places (and others are editing it); each is 4 to 7 kB gzip. A stage never fetched cannot be ridden offline (the toast says so); one ridden once can (the service worker keeps the chunk).
- **Done when (original):** the entry file is measurably smaller, with before and after sizes recorded here; the hub still lists every stage with its length and climbing at once; and picking a stage whose data has not arrived shows a loading state, not a broken road. If stage data turns out to be a small share of the entry file, do the largest safe part instead and write down what was found.

### C. Security header, dependencies and docs

1. **Content-Security-Policy.** `vercel.json` sets the other standard headers but not this one. Start with `Content-Security-Policy-Report-Only`, so a mistake cannot break sign-in, and list what it must allow (the app's own origin, Neon through `/api/auth`, Sentry, blob and data URLs for textures and workers, inline styles if the app needs them).
   - **Done when:** the header is in `vercel.json`, a browser test loads the app, signs in (mocked) and starts a ride with no CSP violation reported, and this page says what has to be true before the header is switched from report-only to enforcing.
   - **Status: done, report-only.** The policy and what each directive allows are in [Security](security.md#content-security-policy); it is built by `csp.mjs` and sent by `vercel.json`, `vite preview` and `vite dev`; `tests/e2e/csp.spec.ts` and `tests/unit/csp.test.ts` guard it.
   - **Before switching to enforcing** (rename the header to `Content-Security-Policy` in `csp.mjs`, run `npm run csp:sync`, and keep the report-only copy for any stricter experiment):
     1. Add somewhere to send reports. There is none today, so a production violation is only seen in the rider's console. Cheapest: a `report-uri` (and `report-to`) pointing at Sentry's security endpoint for the project (Sentry accepts CSP reports at `https://<ingest host>/api/<project id>/security/?sentry_key=<public key>`, the same public key as the DSN), which needs no new function. The alternative is a small `api/csp-report.ts` that logs the report (blocked URI, directive, source file, never the page's query string) to the Vercel logs.
     2. A week or more of clean reports in production, on the browsers riders use (Chrome, Safari, Firefox, Bluefy on iOS), including a sign-in with Google, an email sign-in and password reset, a ride on every graphics tier, the share-card save, a `.fit` and `.tcx` export and a service-worker update. Extensions inject scripts and styles and produce noise: filter reports whose source is `chrome-extension:` or `moz-extension:`.
     3. The two things the test cannot see are checked by hand: the Sentry ingest host the DSN really uses is in `connect-src` (the list covers `*.ingest.sentry.io`, `.us.` and `.de.`), and Neon's Data API host in `csp.mjs` is the one in the production environment.
     4. A rollback plan: the header is one line in `vercel.json`, so reverting is a revert of that commit (or a rename back to report-only).
2. **The Dependabot alert.** `minimatch`, pulled in by ESLint, a development tool. Upgrade ESLint, and fix what its new rules flag.
   - **Done when:** `npm audit` reports nothing, and lint is clean.
   - **Status: done.** ESLint 10.14.0 and typescript-eslint 8.72.2 are already the latest releases, so there is no upgrade to make: the alert (minimatch below 11.0.1) is cleared by an npm `overrides` entry forcing `minimatch ^11.0.8` for ESLint's, typescript-eslint's and the Sentry plugin's copies, and `npm audit` reports 0 vulnerabilities.
3. **`kestrel-vale-plan.md` reads as a plan though all five milestones are built.** Rewrite it as a short page on how the world is built, and move the parts that still matter (the route model, the frozen ids and lap, the tunnel approach) into it.
   - **Status: done.** The page is now [kestrel-vale.md](kestrel-vale.md).

### D. Kestrel Vale polish (done)

1. ~~**A start arch that belongs in the village.**~~ Done: `vale-arch` (two limestone piers, oak beam, painted board with the place and START/FINISH/the sprint's name, chequered trim, bunting; about 1,200 triangles), chosen by `World.arch` and used by `routeStage` for the start, each finish and every sprint. Other stages keep `gantry.glb`.
2. ~~**Vary the terraces.**~~ Done: `terrace` with `village: true` (22 seeded rows: two and three storeys, stepped roofs, low cottages, ginnels, shopfronts, door and frame colours, chimneys, shifted and differently wide). Same one landmark every 44 m, so the budget (52) holds; Richmond's and Harrogate's rows are untouched and pinned by a test.
3. ~~**Raven Keep is small from the climb.**~~ Done: 28 m tall (was 20), the crag 40 m above the slope (was 26) with an 18 m flat bench, and the world's `clearAir` 1.5. The road and its elevation and heading are unchanged.
   - **Done when:** `KESTREL_SHOTS=1` screenshots show each change (the Medium keep from the second leg is visible again, the fourth leg shows it on a clear crag); the landmark budget and every lap, segment and limit pin still hold. Not done: the keep is still small from the climb's foot (800 m).

### E. Split `src/main.ts` (after A is merged)

`src/main.ts` is 2,741 lines, with 72 imports and 67 event listeners. It holds the ride state, the frame loop and most of the button wiring, and only the browser tests cover it.

- Move the ride state and the simulation step into a module that takes its dependencies as arguments, so it can be unit-tested.
- One piece per pull request. Behaviour must not change; the existing browser tests are the safety net.
- **Done when:** the simulation step has unit tests of its own, and `main.ts` is shorter by what moved.

## Not in this plan

- Riders on different routes of one world seeing each other. It needs a design for presence across routes.
- Profiling on real phones and GPUs.
