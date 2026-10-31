# Testing

This page covers what the repository checks automatically (the type check and the build), and how to check the interface by hand or headlessly, including the slow WebGL in headless browsers and how to mock Neon for signed-in screens.

## What runs automatically

The repository has no test suite. `package.json` has no test script, and there are no test files. The automated checks are:

- **`npm run build`.** This runs `tsc --noEmit` on everything under `src/`, with strict mode, unused-variable checks and the Web Bluetooth types, and then `vite build`. A build that passes has no type errors and bundles every module.
- **The Vercel build.** Vercel runs `npm run build` for every push, so a branch that doesn't build won't deploy.

Run the build before every commit:

```bash
npm run build
```

## Check the interface by hand

Most of the app needs a person to check:

- **Without a trainer:** use the demo ride. It exercises the physics, the HUD, the 3D world, the workouts (in demo mode), the stage finish screen and the ride summary.
- **With a trainer:** connect in Chrome on `localhost` or the live site, and check the status line, grade changes on a climb, and ERG in a workout.
- **Signed in:** sign in on a trusted domain, ride to save a ride, and check the profile tabs.

## Headless checks with Playwright

Playwright isn't in the repository. You can add it for your own checks, outside the project if you prefer. These notes describe what to expect.

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

Fulfill each request with the shape the code expects. The shapes are in [`src/cloud/sync.ts`](../../src/cloud/sync.ts) (for example `Activity`, `FtpEntry`, `Feedback`, `AdminOverview`, `AdminUser`). Mocked responses only test the UI; they don't test Row-Level Security. Test RLS against a Neon branch, using the SQL in [Database schema](../reference/database-schema.md).

### Keep checks out of the repository

If you add Playwright tests, keep them in a separate folder and decide whether they belong in the repository. Don't commit screenshots or traces; they can be large and can show personal details.

## Checks on the database

Changes to `db/schema.sql` should be tested on a Neon branch before they reach the main branch. Check:

- that the schema applies cleanly to an empty database,
- that a rider can read and write only their own rows, and
- that admin functions refuse non-admins with *Admins only*.

## Checklist before a release

1. `npm run build` passes.
2. The demo ride runs, and the stage finish screen appears on a finite stage.
3. A workout runs in demo mode, and the summary appears at the end.
4. Signed in: a ride saves, and the profile opens with its tabs.
5. If the schema changed: `db/schema.sql` is updated in the same change.
