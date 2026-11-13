# Kestrel Vale: how the world is built

Kestrel Vale is American Flyers' first home world: a fictional limestone valley in the north of England (crowd culture `gb`), ridden as one closed loop with five routes. It is solo-first: ghosts, workouts and pro teams work on it as on any stage, and there is no presence across routes. The code is `src/worlds/kestrelVale.ts` (the world) and `src/worlds/types.ts` (the route model). How a world is compiled into stages is in the "Worlds and routes" section of [stages-and-gpx.md](stages-and-gpx.md#worlds-and-routes); how it is drawn is in [3d-world.md](3d-world.md) ("Tunnels", "Kestrel Vale's dressing", "Kestrel Vale's hero models"). This page is the overview and the rules.

## The lap as built

The lap is **15,398.8 m** (pinned in `tests/unit/worlds.test.ts`), turns left once (the lake is inside the loop) and starts and ends in the Hollins Cross square. Its pieces, in lap metres:

| Lap m | What |
| --- | --- |
| 0 to 600 | Hollins Cross high street: start and finish, stone terraces, start arch |
| 600 to 900 | The bend at the church |
| 900 to 4,010 | Down to Kestrel Water, then the lakeshore (sprint at 2,600) |
| 4,010 to 4,260 | Mill Bridge over Mill Beck (the covered bridge) |
| 4,260 to 6,018 | Foss Bottom farmland (barn, farmhouse, silos; dry-stone walls) |
| 6,018 to 10,283 | **Raven Scar**: 4,265 m, 275 m up, 6.45% on average, the steepest 300 m at about 10%, five hairpins (centres at 6,458, 7,228, 7,978, 8,748 and 9,583) |
| 10,283 to 10,633 | **Raven Gap**: the rock cutting. KOM summit (category 2) at 10,283; **the tunnel runs from 10,297 to 10,619 (322 m)**, the last stretch of the cutting |
| 10,633 to 13,964 | Highfold Woods descent |
| 13,964 to 14,949 | Beck Lane beside the stream |
| 14,949 to 15,399 | Run-in on the heading of lap metre 0 (see the rules below) |

Elevation runs from -8 m (the lakeshore) to +300 m (Raven Gap) above the square.

## Routes

Every route is a window on the loop, compiled by `routeStage(world, route)` into an ordinary `Stage`. Starts are in lap metres:

| Route id | Name | Start | Length |
| --- | --- | --- | --- |
| `kestrel-vale` | Free Ride | 0 | endless |
| `kestrel-vale-loop` | Vale Loop | 0 | 1 lap, 15,399 m |
| `kestrel-vale-grand` | Grand Vale | 0 | 3 laps, 46,196 m |
| `kestrel-vale-raven-scar` | Raven Scar | 5,900 (Foss Bottom straight) | 4,800 m, to lap metre 10,700 |
| `kestrel-vale-lakeside` | Lakeside Sprint | 14,000 (Beck Lane) | 5,700 m, across the lap line (at 1,399 m into the route) to lap metre 4,301, just past Mill Bridge |

## The route model

- **`World`** holds everything defined in lap metres and world coordinates: heading and elevation (periodic), scenery, landmarks, named places, race points, crowd spots, tunnel spans. The loop is built from pieces (`{ len, turnDeg }`) and closed by `closeLoop()`, which solves the lengths of two straights (`water-road` and `foss-straight`) so the end lands on the start; the lap length is whatever that gives.
- **`WorldRoute`** is `id`, `name`, `tagline`, `start?` (lap metres, default 0), exactly one of `laps` (a number, or `null` for endless) or `length` (metres), and `since?`.
- **`routeStage()`** re-bases the world on the start `s`: elevation is `elev(s + d) - E(s)` so every route starts at 0, positions move by `-P(s)`, landmarks and spans move by `-s` and are cut to the route. A route that starts partway round gets the real road behind its start (`course.ts` integrates it backwards), so pick starts on a straight, not in the cutting or on the bridge. `Stage.lapLength` is set only for whole-lap routes. The details are in stages-and-gpx.md and are not repeated here.

## Rules that must not be broken

1. **Route ids and the lap geometry are frozen.** Leaderboards, ghosts, saved rides, presence and the limit tables key on the stage id. A change to the lap means a new route id or a deliberate leaderboard reset. The lap length, the climb and the segment geometry are pinned in `worlds.test.ts`, `segments.test.ts` and the limit tests.
2. **Segment ids are scoped to the world** (`kestrel-vale:raven-scar`, never `kestrel-vale-loop:...`), and segments are defined once per world, on its one-lap route. The climb's segment is 4,150 m: lap metres 6,025 to 10,175, so 125 to 4,275 on Raven Scar; the Free Ride and the Lakeside Sprint have none. Every route that covers it shares one board and one `segment_limits` row.
3. **Every new route gets a `since` date** (`YYYY-MM-DD`). The Vale Explorer badge is earned by finishing every route with a finish line; achievements are recomputed from saved rides, so a route added later must not un-earn it. The badge asks only for the routes that existed on the day of the last finish needed. None of the five routes has a `since` (they are the launch routes), and `tests/unit/valeAchievements.test.ts` fails for a route with neither.
4. **The race rotation uses `since_day`.** The evening race on UTC day N is the (N mod n)th of the n stages in rotation that day, so appending a stage would move every day's stage, including days whose events already exist. Grand Vale is in `event_stage_pool` with `since_day` 20801 (14 December 2026); a later stage gets a `sinceDay` a few weeks ahead, and `db/schema.sql` must be applied more than 15 days before it (the schedule creates 14 days ahead). The client mirror is `EVENT_STAGE_POOL` / `raceStageForDay`.
5. **The last 400 m of the lap run on the heading of lap metre 0**, so the straight road drawn behind a route that starts at 0 lies on the real road.
6. **`every` must divide the lap** for a repeating landmark (a one-off uses the lap itself), and a world's scenery hooks must be functions of world position and lap metres only.
7. **Only types are imported from `stages.ts`** in `worlds/*` (it imports the routes at run time); helpers come from `stageKit.ts` and `src/world/`.
8. A new route also needs its `stage_limits` row (and a `segment_limits` row for a new segment), a bumped schema version, and rows in the per-stage tables: the checklist is in stages-and-gpx.md.

## How the pieces are made

- **The tunnel.** A heightfield cannot close over a road, so over the span the terrain is dug into a slot below the road and a tube (`src/world/tunnel.ts`, built per road chunk, three draw calls) supplies the hill and the vault; two stone portals (`tunnel-portal`, one monument decorated on both faces) mark the mouths. The road's elevation and heading are untouched, so the lap, segments and limits do not change. Nothing else stands in the span (no crowd, barriers or trees). Details: 3d-world.md, "Tunnels".
- **Dressing kits (no models or textures).** Dry-stone field walls in Foss Bottom, Mill Beck (a `RiverBody` that runs under Mill Bridge), the stone viaduct across Foss Gill, the lakeside jetty with boats, and the market cross and bunting in Hollins Cross. They are deterministic, hashed from the world's lap metres (so every route and lap looks the same), thinned by graphics tier, and budgeted by tests (at most 52 landmarks in the 1,600 m ahead at the village). Details: 3d-world.md, "Kestrel Vale's dressing".
- **Hero models.** `raven-keep.glb`, `kestrel-boathouse.glb` and `hollins-cross-inn.glb`, one of each a lap, made with the Higgsfield pipeline in `public/models/README.md` (three GPT Image 2.5 front views and three Tripo H3.1 conversions: 27.75 credits). The keep stands on a crag whose terrain is solved to the road's own blend (`cragGround`), the boathouse and jetty are placed from the lake's shore, and each file is fetched only when the rider comes in range. Details: 3d-world.md, "Kestrel Vale's hero models".
- **Hub and map.** The hub shows one world card with a chip per route (same `data-fkey="stage-<id>"` as a normal card); the mini-map draws the whole lap for the free ride and the route's span, picked out, for a partial route.

## Tests and test hooks

- Unit: `worlds.test.ts` (loop closure, pinned lap, elevation, climb, no self-crossing, lake and beck, route windows, budgets), `tunnel.test.ts`, `valeLandmarks.test.ts`, `valeAchievements.test.ts`, plus the segment and limit tests.
- Browser: `tests/e2e/kestrelVale.spec.ts` loads places along the lap (the village, the lakeshore, the climb, the cutting, the tunnel at five points, the two partial routes, every dressing and hero spot) with `?stage=<id>&start=<km>&graphics=<tier>&adapt=off` and checks for page and shader errors. By default it uses Low and a short wait. **`KESTREL_SHOTS=1`** adds Medium, waits for the terrain to settle (`KESTREL_SETTLE_MS`, default 25,000 ms) and saves `test-results/kestrel-*.png` for a human to look at; `-g "dressing"`, `-g "hero"` and `-g "tunnel"` run subsets.

## Known limits

- A route cannot choose a branch: it is a window on one loop, so variety comes from where it starts and how far it goes.
- The viaduct stands on the hillside above the Foss straight, not across the valley floor (a viaduct on the floor would have to cross the road), so it reads broadside from the straight and small from the climb.
- Raven Keep is not visible from the lakeshore (about 3.3 km away, past the haze) and is small from the foot of the climb; on Medium and up the haze hides it from Raven Scar's second leg until about 500 m away.
- Rain still falls through the tunnel's hill, and the mini-map does not mark the tunnel.
- Grand Vale joins the race rotation on 14 December 2026, not at once.

## Deliberately left out

- **Presence across routes.** Riders on different routes of the same world do not see each other: presence, ghosts and leaderboards are per stage id. A world-wide presence layer would be its own project.
- A road network with junctions, and a hand-written `Stage` per route (the routes would drift apart).
