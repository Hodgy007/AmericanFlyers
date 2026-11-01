# Testing

This page covers what the repository checks automatically (the type check, the build, the unit tests and a browser smoke test), and how to check the interface by hand or headlessly, including the slow WebGL in headless browsers and how to mock Neon for signed-in screens.

## What runs automatically

Every pull request and every push to `main` runs [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) on GitHub Actions:

1. `npm ci`.
2. **`npm run build`.** This runs `tsc --noEmit` on everything under `src/` (strict mode, unused-variable checks, the Web Bluetooth types) and then `vite build`.
3. **`npm test`.** The unit tests (Vitest), below.
4. **The smoke test.** `npx playwright install --with-deps chromium`, then `npx playwright test`: the built app in headless Chromium, below. On failure the workflow uploads the Playwright report and traces.

Vercel also runs `npm run build` for every push, so a branch that doesn't build won't deploy.

Before every commit:

```bash
npm run build && npm test
```

## Unit tests (Vitest)

`npm test` runs `vitest run`; `npm run test:watch` re-runs on save. The tests are in `tests/unit/` and cover the pure logic, with no browser and no WebGL:

| File | Covers |
| --- | --- |
| `physics.test.ts` | `stepSpeed`: terminal speeds on the flat and on climbs, momentum, descents, mass and drag effects |
| `draft.test.ts` | `draftSaving` by gap, `groupMax`, `lateralOverlap`, `draftFrom` (look-ahead, groups, ghosts, sideways) |
| `drivetrain.test.ts` | gear tables, virtual gear offsets and cadence, automatic shifting, freewheeling, the pedal-stroke rock stays within `MAX_ROCK` |
| `stages.test.ts` | every stage; each climb's finish distance and total gain match its published figures; hairpin signs; flat stages; the Hell of the West tour stages |
| `workouts.test.ts` | `expand`, `targetAt`, TSS, the built-ins, `.zwo` export and import round trip, `.erg` / `.mrc` parsing, error messages |
| `plans.test.ts` | every plan session points at a real workout or stage; `nextSession`, `complete` |
| `gpx.test.ts` | `parseGpx` on a small fixture, `routeToStage` (length, climb, heading, no-elevation files) |
| `raceSim.test.ts` | course lines and summit detection, points and bunch-time rules, seeded determinism, plausible finish times, a live player in the crossing orders |
| `tour.test.ts` | the three classifications, jerseys, recording stages, `simulateStage` |
| `ghost.test.ts` | ghost replay, interpolation and clamping, `raceTime` |
| `freewheel.test.ts` | the ratchet tick rate (engagement points × wheel revs gained on the cassette), silence while pedalling, the rendered tick's shape and variants |
| `trust.test.ts` | which rides may go on leaderboards (demo slider, `?timescale`), the finish-card note, the DELETE confirmation, verification-code entry |
| `schedule.test.ts` | the daily event schedule and stage rotation (matches the database), join windows |
| `eventSession.test.ts` | the shared event clock, the "you've been dropped" watcher, merging real and computer-ridden results, fixed-step determinism |
| `commentary.test.ts` | commentary rate limiting and queueing, race events to voice lines, every clip file exists |
| `garage.test.ts` | the level curve, rewards, wallet parsing, loadout validation, equipment effect maths against `stepSpeed`, store rules (the Tron bike at 8,848 m), kit strings and the server's regex, the share card |
| `challenges.test.ts` | ISO weeks and the weekly challenge pick (pinned to the database for several weeks) |

Conventions:

- Files that need a DOM (`DOMParser` for `.zwo` and GPX) start with `// @vitest-environment jsdom`; the rest run in Node.
- Assert behaviour and sane ranges (a 250 W rider climbs an 8% grade at 10-16 km/h), not exact floating-point values, so a small tuning change to the physics doesn't break the suite.
- Seeded simulations (`RaceSim`) are deterministic for a seed, so the tests can compare two runs exactly. Other work changes `draft.ts`, `physics.ts`, `peloton.ts` and `raceSim.ts` additively (optional parameters), so test public behaviour and leave room for new optional behaviour.
- If a module can't be imported in Node because it touches the DOM or Three.js at import time, test the logic in a separate pure module rather than mocking the world.

## Browser smoke test (Playwright)

`npm run test:e2e` builds the app and runs `playwright test`. The test, `tests/e2e/smoke.spec.ts`, serves `vite preview` on port 4185 (override with `E2E_PORT`), then:

- mocks Neon with `tests/e2e/mockNeon.ts` (`page.route` on the Auth and Data API hosts; `{ signedIn: true }` is a rider with rides, FTP history, a plan, a garage wallet, challenges and events),
- skips the home page and the first-ride guide with `localStorage`, so the app opens on the **hub** (a guest's, because the mocked session is empty),
- checks the hub (header, seven sections, a route and a workout to choose, the sign-in prompt for guests), then presses **Ride**,
- starts a demo ride from ☰ Menu and checks the HUD fills in,
- opens and closes each main dialog (stage, workouts, riders, leaderboard, time and weather, plans, kit, tour, settings, feedback, sign in),
- goes back with ☰ Menu → 🏠 Hub, checks Escape keeps focus on **Ride**, and rides again,
- fails on any page error or console error (blocked network requests are ignored).

A second test signs the mocked rider in and checks the hub's name, level, credits, plan row, best times, each section's data, a ride row opening the profile's ride detail, and Ride starting a chosen workout.

It takes about a minute with software WebGL. To keep that fast and reliable, the test throttles `requestAnimationFrame` to about 1 fps (set `E2E_FULL_FPS=1` to turn that off) and clicks through the DOM. When you add a main dialog or menu entry, add a line to `DIALOGS` in the spec.

The Playwright config uses the default Playwright Chromium, which CI installs with `npx playwright install --with-deps chromium`. On a machine that has no downloaded browser but does have a Chromium at `/opt/pw-browsers/chromium` (the Claude Code sandbox), it uses that one.

## Check the interface by hand

Most of the app needs a person to check:

- **Without a trainer:** use the demo ride. It exercises the physics, the HUD, the 3D world, the workouts (in demo mode), the stage finish screen and the ride summary.
- **With a trainer:** connect in Chrome on `localhost` or the live site, and check the status line, grade changes on a climb, and ERG in a workout.
- **Signed in:** sign in on a trusted domain, ride to save a ride, and check the profile tabs.

## Headless checks with Playwright

For your own one-off checks (screenshots, a specific flow), use Playwright as the smoke test does. These notes describe what to expect.

### Start the app

Start the dev server (`npm run dev`) or the preview server (`npm run preview`, after a build), and point Playwright at it.

### WebGL is slow in headless browsers

The 3D scene uses WebGL, and headless browsers often render it in software. Expect slow frames and long waits for the first render. Give page actions longer timeouts, and avoid asserting on exact frame timing.

### Web Bluetooth isn't available

Headless browsers don't provide a trainer, and `navigator.bluetooth` is usually missing. The app then disables **Connect trainer** and **Heart rate**, and shows the Bluetooth-unavailable message. Test that path as it is, or test the demo ride, which works without Bluetooth.

### Mock Neon for signed-in screens

Signed-in screens need Neon's Auth and Data API. Mock them with Playwright's `page.route()`, intercepting requests to the two endpoints in [`src/cloud/client.ts`](../../src/cloud/client.ts):

- the Auth session endpoint, to return a fake signed-in user, and
- the Data API endpoints for `profiles`, `activities`, `ftp_history`, `feedback`, and the admin RPC functions, to return fixture JSON.

`tests/e2e/mockNeon.ts` does all of this (the Data API wants a JWT, which Neon Auth sends in the `set-auth-jwt` header of the session response; the mock sends an unsigned one). Fulfill each request with the shape the code expects. The shapes are in [`src/cloud/sync.ts`](../../src/cloud/sync.ts) (for example `Activity`, `FtpEntry`, `Feedback`, `AdminOverview`, `AdminUser`). Mocked responses only test the UI; they don't test Row-Level Security. Test RLS against a Neon branch, using the SQL in [Database schema](../reference/database-schema.md).

### Keep screenshots out of the repository

Don't commit screenshots, traces or Playwright reports (`test-results/` and `playwright-report/` are in `.gitignore`); they can be large and can show personal details. New automated tests go in `tests/e2e/`.

## Checks on the database

Changes to `db/schema.sql` should be tested on a Neon branch before they reach the main branch. Check:

- that the schema applies cleanly to an empty database,
- that a rider can read and write only their own rows, and
- that admin functions refuse non-admins with *Admins only*.

## Checklist before a release

1. `npm run build` and `npm test` pass, and CI is green.
2. The demo ride runs, and the stage finish screen appears on a finite stage.
3. A workout runs in demo mode, and the summary appears at the end.
4. Signed in: a ride saves, and the profile opens with its tabs.
5. If the schema changed: `db/schema.sql` is updated in the same change.
