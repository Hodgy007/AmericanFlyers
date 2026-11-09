# KOM segments

A stage's big climbs are timed as **segments**: while riding, each passage is an effort (elapsed moving time, average power and a split every 50 m). The KOM panel shows a leaderboard before and on the climb and a live gap to your earlier attempts; the hub lists a route's segments. Rider-facing description: [Leaderboards and ghosts](../user-guide/leaderboards-and-ghosts.md#kom-segments).

| File | What it holds |
| --- | --- |
| `src/segments.ts` | Pure logic: `segmentsFor(stage)`, `SegmentTracker`, `timeAt`/`gapSeconds`/`distanceAt`, `segmentStatus`, `judgeEffort`/`resultText`, `boardSummary`. No DOM, no network. |
| `src/segmentStore.ts` | `SegmentStore`: your best and latest effort per segment in `localStorage` (`americanflyers.segments`), and the queue of efforts waiting to be sent (`americanflyers.segments.pending`). |
| `src/segmentUi.ts` | The in-ride KOM panel (`#kom-card`), the effort result banner (through the toast), the segment ghost, and the glue between the tracker, the store and the account. |
| `src/segmentBoardUi.ts` | The hub's segments dialog (`#segment-board`), loaded on first use. |
| `src/cloud/segmentApi.ts` | `segmentLeaderboard()`, `myEfforts()`, `myEffortLog()`, `saveSegmentEffort()` and the offline queue. |
| `db/schema.sql` ("KOM segments") | `segment_efforts`, `segment_limits`, `segment_effort_is_plausible()`, `segment_leaderboard()`. |

## Finding the segments

`segmentsFor(stage)` runs once per stage (cached in a `WeakMap`). **Single-climb stages** (`isClimb(stage)`: numbered hairpins and a finish; not tour stages or uploaded routes) get exactly one segment, `<stageId>:main`, from the first big climb to the finish or, if the road peaks earlier, the highest point, named after the climb ("Mount Washington", `MAIN_NAMES`). Every other stage follows the rules below. A rolling stage that finishes on a named summit (Echo Lake) has its last climbs joined across small dips and run to the line. It takes `findClimbs()` (`src/climb.ts`) over the stage's own elevation, joins climbs at most 250 m apart with a dip of at most 12 m (a hairpin's flat is not a break), and keeps those of at least 900 m and 60 m of climbing. A race summit of category 2 or harder (`Stage.race.summits`) lets a shorter, lower climb count (500 m, 40 m), and its name is given to the climb it sits at (within 300 m past the top, in the climb's upper half). The unnamed biggest climb is called "<Stage> climb" (or just the stage's name if it is the only segment) and the rest "Climb N". Endless stages have none; uploaded routes get segments with `shared: false`.

A circuit (`Stage.lapLength`) is scanned over its first lap only; the segment's `passes` is the number of laps and each passage is its own effort. A climb that runs over the lap line ends at it (Morgul-Bismark's Wall tops out at the lap line, where the race awards its summit).

**Ids are the leaderboard's keys.** `<stageId>:main` for a single-climb stage, `<stageId>:<slug of the summit name>` for a named climb on a rolling stage and `<stageId>:climb-<n>` for the rare unnamed one (at least 2 km and 100 m). `tests/unit/segments.test.ts` pins every built-in stage's ids, names, starts and ends, and `tests/unit/segmentLimits.test.ts` insists on a `segment_limits` row for each. If you change the detector, a stage's profile or its summits, those tests fail: either restore the old ids or add the new segments' rows to `segment_limits` (and decide what happens to the old board). A new built-in stage needs a row in the pinned table as well.

Current segments: Morgul-Bismark: The Wall (both laps); Tour of the Moon: Cold Shivers, The high point; Hell of the West (Echo Lake): Echo Lake (the whole climb to the line); and one `<stage>:main` segment each for Alpe d'Huez, Stelvio Pass, Mont Ventoux, Col du Tourmalet, Monte Zoncolan, Mount Washington, Mount Blue Sky, Mount Diablo and Flagstaff Mountain. Heartland Rollers and Route 66: none.

## Timing an effort

`main.ts` calls `komUi.frame(distance, movingTime, work, riding)` every frame, right after the moving-time clock advances (and before the finish check, so a climb that tops out at the line still counts). `SegmentTracker.update()` is allocation-free except when a split or an effort is stored:

- A start line crossed between two frames starts an effort; the start time (and the work at that moment) is interpolated between the frames, so a coarse frame (a sped-up clock) doesn't move the time.
- A split is stored for every 50 m into the segment, interpolated the same way, as tenths of a second (an int). The top is not a split: it is `Effort.t`. `Effort.p` is the average power.
- It voids an effort when `riding` is false (stopped, on the start line of a race, finished), when the distance jumps by more than 150 m in a frame (the demo profile jump) or goes backwards, and on `reset()`. `komUi.reset()` runs on a new ride, a new stage and when the hub opens.

## The live gap

`timeAt(effort, length, x)` reads the elapsed time of a stored effort at `x` metres, linearly between its splits (and between the last split and the top). `gapSeconds(ref, length, x, elapsed)` = your elapsed time minus that: negative is ahead. The panel shows time as the one primary format (`−0:07` green, `+0:12` red, one update a second) against your best and a smaller line against your last attempt (hidden when your last attempt is your best); it does not show metres. `distanceAt()` is the inverse, used for the optional ghost: while on a segment, with **Race my best ride** on and no whole-stage ghost, the best effort rides the road as a ghost rider (id `ghost`).

## Where efforts count

`SegmentUiDeps.eligible()` is `leaderboardEligible(rideFlags)`: false after the demo slider supplied power or on a `?timescale` clock. An ineligible effort is timed and shown (so the live gap works) but not kept anywhere, and the banner says *Demo ride, not saved*. `?komtest` makes it count for the local store only: it never reaches the account, because only `eligible()` efforts are sent. An eligible effort is stored locally (best and latest), then, if the rider is signed in and the stage is built in (`segment.shared`), queued in `americanflyers.segments.pending` and inserted into `segment_efforts` (`flushPendingEfforts()`, retried whenever a board loads); then the board is read again for the rank in the banner (waiting at most 2.5 s for it).

## The panel

`segmentStatus(segments, distance, PREVIEW_RANGE)` says whether a segment starts within 2 km or you are on one. On approach `segmentUi` loads the segment's board once per ride (`segmentLeaderboard(id)` and `myEfforts(id)`, whose best and latest are merged into the local store so the gap follows you to another device); a failed board is retried after a minute. Signed out, or on an uploaded route, nothing is fetched and the panel says so. On wide screens the card sits beside the climb card (left of it, or right where the left is taken); on a phone it stacks under it. **KOM panel** in Settings (`Settings.komPanel`, default on) hides it; efforts are still recorded.

## The database

See [Database schema](../reference/database-schema.md#kom-segments). `segment_efforts` has row-level security (own rows: select, insert, delete). `segment_leaderboard()` is `security definer`: one row per rider (their best plausible effort), the top 10 plus the caller, banned riders excluded, `riders` = the board's size. `segment_effort_is_plausible()` applies `segment_limits` (80% of the time at 390 W, 60 + 8 kg, CdA 0.25; the segment is timed within a whole-stage simulation, the faster pass on a circuit), a 2000 W cap and the demo flag. `delete_my_account()` deletes the rows by name, and `my_data_extras()` exports them with the other tables that have a text `user_id`.

When you add a built-in segment, add its `segment_limits` row (the test prints the expected numbers when it fails) and apply it to the live database: the table is data, not a migration.
