# Racing and the Hell of the West tour

This page explains the race engine, how the live race plugs into the frame loop, the classifications, and the tour.

## Modules

| Module | Role |
| --- | --- |
| [`src/raceSim.ts`](../../src/raceSim.ts) | The engine. Pure TypeScript: no DOM, no Three.js. `RaceSim`, `RaceCourse`/`makeCourse()`, `detectSummits()`, `awardPoints()`, `stageResults()`. |
| [`src/peloton.ts`](../../src/peloton.ts) | `makeRoster(seed)` (36 riders), `RaceField`, and `Peloton.startRace()/endRace()/racing`. In a race `Peloton.riders()` returns the racers as `OtherRider`s, so `others.ts` and `draft.ts` work unchanged. |
| [`src/race.ts`](../../src/race.ts) | `LiveRace`: the countdown, `update(dt, distance, speed)`, `panel()`, `results()`. |
| [`src/raceUi.ts`](../../src/raceUi.ts) | DOM: `#race-count`, `#race-panel`, and `resultsNode()` tables. |
| [`src/tour.ts`](../../src/tour.ts), [`src/tourUi.ts`](../../src/tourUi.ts) | Tour progress, classifications, `tourJersey()`, `simulateStage()`, and the `#tour` dialog. |

## The engine

Riders are individual units that travel in **groups**. A group has a front wheel position and a speed; each rider has an offset behind the front (rows of up to four, easing between slots) and a lane. The engine steps in the caller's `dt` (a frame, or 0.5 s when simulating):

- **Pace.** A group's power is an effort fraction of a reference strength between its strongest riders and the typical rider (`0.4 × mean of top 3 + 0.6 × the 40th percentile`), moved with the same `stepSpeed()` physics as the player, with a drag reduction by group size.
  - A bunch rides at a tempo of 0.78; if a smaller group up the road is more than 15 s clear, the tempo rises towards 0.97 (a chase), and it is at least 0.86 in the last 15% of the stage.
  - Break groups ride at 0.93, chasing groups at 0.90, dropped groups at 0.82.
- **Strength.** Each rider's sustained watts are `refWkg × (0.88 + 0.3 × ability) × 68 kg`, where `refWkg` is the player's FTP per kilo (`tour.refWkg()`), so the field scales to the player. Riders also have a climbing multiplier (0.92 to 1.07) and a sprint multiplier (1.7 to 2.5 × sustained power). Archetypes per team: a climbing captain (with a name tag), an all-rounder and a sprinter.
- **Attacks.** Every group of five or more rolls a timer (100 to 220 s). When it fires on a sustained climb (the next 500 m average at least 3.5%, after 120 s of racing, not near a sprint line), one of the best climbers (sometimes with a team-mate) leaves at 120 to 150% of their power for 30 to 90 s, then rides on at 0.93. Attackers are tired afterwards and can't attack again for 4 minutes.
- **Breakaway.** In stages of at least 15 km, between 90 and 200 s, 2 to 4 riders from different teams go clear at 130% for 45 s.
- **Cracks.** Each follower's power need is computed at the speed the pace sustains (not momentum) with shelter by group size; more than 6% over their ability for 6 s drops them into a new group, which can't re-join for 25 s.
- **Merges.** Groups merge when the chaser's front reaches the rear of the group ahead and it isn't slower.
- **Sprints.** Within 460 m of a sprint banner or the finish, groups dissolve into individual sprinters; each opens up 200 to 380 m out at `sprint × power` for 20 s, then eases.
- **Lines.** Sprint banners, summits and the finish are `RaceLine`s. Each rider's crossing time is interpolated and appended to the line; the live player is reported with `reportPlayer()`. Points are awarded from crossing order by `awardPoints()` and times (with the one-second bunch rule) by `stageTimes()`.
- **Determinism.** A mulberry32 generator seeded from `opts.seed`. The same seed and the same step sequence give the same race.

`runToEnd()` steps at 0.5 s until every computer rider has finished. It is used for the results after you cross the line and for "simulate this stage" (where you are a `RosterEntry` with fixed `capW`).

## Wiring in `main.ts`

- `beginRace(stage, tourStage)` resets the stage, builds the roster and `RaceField` (`peloton.startRace`), and creates a `LiveRace`.
- Each frame, `race.update()` steps the sim (before the player moves, with last frame's distance), and `peloton.riders()` feeds the other-riders list. While `race.holding` (the countdown), the player's speed is held at zero.
- The 200 ms HUD tick draws the countdown and `race.panel()`.
- `showFinish()` branches for a race: `race.results()`, `recordStage()` for a tour, and the results tables on the finish card.
- `resetRide()` ends a race (`peloton.endRace()` restores the free-ride groups).

## The tour

`settings.tour` is a `TourProgress`: `{ id, seed, stage, results }`. `results` holds one `TourStageResult` per stage, `[rider id, time, sprint points, mountain points]` rows. The field is regenerated from `seed` with `makeRoster()`, so it is not stored. `tour.ts` keeps the current progress, saves through `onTourChange()` (main saves and syncs the settings), and computes the general, points and mountains classifications. `tourJersey()` returns `[main, second]` kit colours if you lead a classification after the stages raced so far (yellow, then green, then polka dots), or `null`; the kit system can call it. The player's rider model is not changed by this module.

## Scheduled events

Group rides and races at set times (see the [user guide](../user-guide/events-and-commentary.md)):

| Module | Role |
| --- | --- |
| [`src/schedule.ts`](../../src/schedule.ts) | Pure: the stage pool, `dailySchedule()` (a client mirror of the SQL schedule, so the Events dialog works signed out), `countdownLabel()`, `joinState()`, `eventStageKey()`. |
| [`src/eventSession.ts`](../../src/eventSession.ts) | Pure: `ActiveEvent`, `secondsSinceStart()`, `EVENT_REF_WKG`, `DropWatcher` (group rides) and `mergeEventResults()` (finish card). |
| [`src/cloud/events.ts`](../../src/cloud/events.ts) | The RPC calls, and the server clock: `syncServerClock()` stores `server − local` from the quickest of three round trips and `serverNow()` applies it. |
| [`src/eventsUi.ts`](../../src/eventsUi.ts) | The `#events` dialog, the `#event-bar` strip and the finish card's results table. |
| `src/main.ts` (section "scheduled events") | `joinEvent()`, `endEvent()`, `updateEvent()` and `eventFinishPanel()`. |

How the start is shared:

- The event is identified by `id`, `starts_at` and `seed`. `LiveRace.useEventClock(() => secondsSinceStart(...))` makes the countdown follow the server's clock, and in the racing phase steps the sim in **fixed** `EVENT_STEP` (0.25 s) slices up to the clock instead of by frame `dt`. The sim never reads the player (only `reportPlayer()` records crossings), so the same seed, the same fixed `EVENT_REF_WKG` (3.4) and the same slices give identical bots on every device. A late joiner's first frames catch the sim up (up to 600 slices a frame).
- A group ride is `Peloton.startGroupRide(wkg, seed, clock)`: one 12-rider group stepped the same way at a steady W/kg, from just ahead of the start line. `Peloton.reset()` (choosing another stage) ends it.
- Presence uses the stage key `eventStageKey(stage, event id)`, so only riders in the event see each other.
- Result time is `sim.t` at the line (race time since the event's start). `submit_event_result` sends it with the average power, unless the ride used the demo or `?timescale` (guard: `eventState.demoUsed`, `TIME_SCALE`). The finish card merges the sim's field, the server's results (polled every 15 s) and your own time.

## The commentator

[`src/commentary.ts`](../../src/commentary.ts):

- **`Commentator`** (pure, injected player and clock) decides whether a line may play now: one at a time, a 3 s pause, a cooldown per kind of line (`COOLDOWN`), at most 5 lines a minute (must-hear priority-3 lines excepted), a one-slot queue for priority 2 and 3 lines that expires after 8 s, and never the same variant twice in a row.
- **`RaceCommentary`** maps `LiveRace.onEvent(text, kind)` (attack, break, caught, sprint) and a per-tick `RaceSnapshot` (built in `updateCommentary()` in `main.ts` from `race.panel()`) to clips: start, lobby, halfway, last kilometre, summits, gaps, and lines about the player (lead, attack, dropped and back, yellow jersey, finish).
- **`ClipPlayer`** plays `public/audio/commentary/<key>-<n>.mp3` with an `<audio>` element and calls `Sound.duck()` (master gain 0.8 to 0.45) while a line plays. `ClipPlayer.preload()` fetches the clips when the first race starts.
- `CLIPS` holds what each file says. A unit test checks every entry has a file. The clips (39, mono 48 kbps, about 1 MB in all) were generated with Higgsfield (model `seed_audio`, one preset male voice) and converted with ffmpeg: `ffmpeg -ac 1 -ar 24000 -b:a 48k` with leading and trailing silence trimmed and `loudnorm`. To add or change a line, edit `CLIPS`, generate the audio the same way, and save it as `<key>-<n>.mp3`.
- Setting `commentary` (default on); `commentator.enabled = settings.commentary && sound.enabled`.

## Testing

`npm run build` type-checks everything. The engine can be run headless: bundle `raceSim.ts` and `peloton.ts` (for `makeRoster`) with esbuild and step a `RaceSim` to the end; the races take 75 to 105 simulated minutes at a 2.7 W/kg reference. In the browser, `?timescale=8` runs the clock faster (see [URL parameters](../reference/keyboard-and-url-params.md)).
