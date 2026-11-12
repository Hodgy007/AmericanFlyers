# Improvement plan (November 2026)

Status: **in progress.** This page lists the fixes that came out of a review of the app on 12 November 2026, in the order they should be done, and what "done" means for each. It is a working document: when everything here is built, fold what still matters into the other guides and delete it.

The review looked at the code on `main`, measured the build, and used what the CI failures of that week exposed. It did not profile on a real GPU or phone, or test with a real trainer.

## Workstreams

Four run side by side, because they touch different files. The fifth waits for the first, because both change `src/main.ts`.

### A. Ride timing: KOM efforts and demo power (do first)

Two suspected bugs that affect real rides. Neither is confirmed; step one of each is a failing test.

1. **KOM efforts may be lost when the tab is hidden or frames are slow.**
   - The ride is simulated from real time in substeps (`simulate()` and `simStep()` in `src/main.ts`, `src/rideClock.ts`), so it carries on in a hidden tab.
   - The KOM timer (`komUi.update()`, which feeds `SegmentTracker` in `src/segments.ts`) is called from the part of `frame()` that redraws the HUD.
   - `SegmentTracker` voids an effort when the distance jumps more than 150 m between two updates (`JUMP_M`). At 15 m/s that is 10 seconds without an update.
   - On CI, with frames 250 ms to 1 s apart and `?timescale=20`, the KOM panel read "--" and "No time yet".
   - **Done when:** the tracker is fed from the simulation step (the panel can still redraw on the HUD's schedule), a unit test shows an effort survives a long gap between frames, and a browser test rides a segment with frames 1 s apart.
2. **The demo rider's power fades to 0 W at about one frame a second with `?timescale=20`.**
   - Seen in the browser tests; the cause is not known. Nothing in the demo path of `simStep()` decays power.
   - **Done when:** the cause is found and written down, a test reproduces it, and it is fixed, or it is shown to be an artefact of `?timescale` that a real rider cannot meet (then say so in `tests/e2e/slowFrames.ts` and here).

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
