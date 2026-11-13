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
- **Done when:** the entry file is measurably smaller, with before and after sizes recorded here; the hub still lists every stage with its length and climbing at once; and picking a stage whose data has not arrived shows a loading state, not a broken road. If stage data turns out to be a small share of the entry file, do the largest safe part instead and write down what was found.

### C. Security header, dependencies and docs

1. **Content-Security-Policy.** `vercel.json` sets the other standard headers but not this one. Start with `Content-Security-Policy-Report-Only`, so a mistake cannot break sign-in, and list what it must allow (the app's own origin, Neon through `/api/auth`, Sentry, blob and data URLs for textures and workers, inline styles if the app needs them).
   - **Done when:** the header is in `vercel.json`, a browser test loads the app, signs in (mocked) and starts a ride with no CSP violation reported, and this page says what has to be true before the header is switched from report-only to enforcing.
2. **The Dependabot alert.** `minimatch`, pulled in by ESLint, a development tool. Upgrade ESLint, and fix what its new rules flag.
   - **Done when:** `npm audit` reports nothing, and lint is clean.
3. **`kestrel-vale-plan.md` reads as a plan though all five milestones are built.** Rewrite it as a short page on how the world is built, and move the parts that still matter (the route model, the frozen ids and lap, the tunnel approach) into it.

### D. Kestrel Vale polish

1. **A start arch that belongs in the village.** The world uses `gantry.glb`, the US stars-and-stripes arch. Build a local one in code (a banner between two posts, or a stone arch) and use it for the world's start, finish and sprint lines.
2. **Vary the terraces.** The rows repeat visibly along the high street: vary height, roof line, door colour and the odd gap.
3. **Raven Keep is small from the climb.** Make it read better (size, the crag's height, or less haze on it), without moving the road.
   - **Done when:** screenshots (`KESTREL_SHOTS=1`) show each change, and the landmark budget and every lap, segment and limit pin still hold.

### E. Split `src/main.ts` (after A is merged)

`src/main.ts` is 2,741 lines, with 72 imports and 67 event listeners. It holds the ride state, the frame loop and most of the button wiring, and only the browser tests cover it.

- Move the ride state and the simulation step into a module that takes its dependencies as arguments, so it can be unit-tested.
- One piece per pull request. Behaviour must not change; the existing browser tests are the safety net.
- **Done when:** the simulation step has unit tests of its own, and `main.ts` is shorter by what moved.

## Not in this plan

- Riders on different routes of one world seeing each other. It needs a design for presence across routes.
- Profiling on real phones and GPUs.
