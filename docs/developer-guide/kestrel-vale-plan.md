# Kestrel Vale: plan for a fictional home world

Status: **milestones 1 to 3 built** (the world, five routes, world-scoped segments defined once per world, routes that start partway round the lap with the real road behind the start, the hub's world card, the whole-lap mini-map, limit rows and tests; milestone 3: the Raven Gap tunnel with its portals, crowd spots in the village, Grand Vale in the event pool and the Vale Explorer badge; see "Worlds and routes" in stages-and-gpx.md and "Tunnels" in 3d-world.md). Milestones 4 and 5 are still plans. Departures in milestone 3: the tunnel's hill is built by the tube, not the terrain (a heightfield cannot close over a road without showing its slope inside the portal, so the terrain is dug out under it), Grand Vale joins the event pool from 14 December 2026 (`since_day`) rather than at once, and the badge ignores routes added after you earned it (`WorldRoute.since`). The rest of this page is the original plan; where the code differs (for example the climb's segment is named for the summit "Raven Scar", and a route has `laps` or `length`, rather than only `length`), the code wins.

Original status line: **plan, not built.** This page describes a Zwift-style home world for American Flyers: a closed circuit with a village start, a climb, a tunnel and a lake, with named routes inside that world and a badge for each route. It covers the world, the data model for routes, the first pull request, what to build in code and what to model, the risks and the milestones.

The world is solo-first. Pro teams, the ghost and workouts must keep working, and this phase adds no new multiplayer architecture.

## In short

Make the world **one closed loop**. A **route is a window on that loop**: where it starts, how long it is (or how many laps), and its badge. Each route is compiled into an ordinary `Stage` with its own permanent id. Leaderboards, ghosts, saved rides, presence, events and the limit tables are all keyed by stage id, so they keep working without changes. The first pull request adds no rendering code.

## What the code does today

Checked against the code on 2026-11-11.

- **Water exists.** `PondBody` is in `src/world/waterTypes.ts`, and `sinkInto` lowers the ground under it.
- **Circuits close cleanly.** `circuitGeometry()` and the per-lap heading pattern in `src/stages.ts` handle this. Morgul-Bismark builds its lap from hand-measured pieces (`MB_PIECES`), which is the pattern a fictional loop needs.
- **There is no tunnel support.**
- **The stage id is the key for everything:** `activities.stage_id`, `stage_limits`, `live_riders`, `events`, `segment_efforts`, the hub's best times and the `first(...)` badges in `src/cloud/achievements.ts`.
- **Every stage with a finish needs a `stage_limits` row.** `tests/unit/stageLimits.test.ts` enforces this, and `tests/unit/segmentLimits.test.ts` does the same for `segment_limits`.
- **Every stage must start at elevation 0.** `tests/unit/stages.test.ts` enforces this.
- **`course.ts` draws the road straight back behind the start** (d ≤ 0). A route that starts partway round the loop would show a road that isn't there.
- **An import cycle is waiting.** `pchip`, `roadTrace`, `monumentAt` and `GANTRY` are private to `stages.ts`. A world in its own file that imports them, while `stages.ts` imports its routes, makes a loop.
- **Segment ids are `<stageId>:<slug>`.** The leaderboard functions don't filter on `stage_id`, so segment ids scoped to the world cost nothing in the database.
- Settings are at `SETTINGS_VERSION = 2`. The schema header is at `2026-11-09 rev-1`.

## 1. The world

**Kestrel Vale** is a fictional limestone valley in the north of England, a cousin of the Harrogate stage. It uses the existing crowd culture `'gb'`.

- **Palette:** green walled fields with patches of gold dry grass, pale limestone crags, a slate-and-stone village, a dark teal lake and dark pine plantation on the descent.
- **`Scenery` settings:** `fields: true`, `dryGrass` about 0.3, `coniferBias` about 0.45, `forestCover` about 0.35, `road: 'alpine'`, `barrier: 'stone'`, `rockLine` about 260, no snow (`snowLine: 1e9`). The default light and weather are `timeOfDay: 'day'` and `weather: 'cloudy'`.

### Lap layout

The lap is about 15.4 km. It turns left overall, with the lake inside the loop.

| Lap km | Piece | Net turn | Elevation (m) |
|---|---|---|---|
| 0.0–0.6 | **Hollins Cross** high street. Start and finish in the square; start arch at 30 m | 0° | 0 |
| 0.6–0.9 | The bend at the church | +60° | 0 |
| 0.9–1.3 | Down to the water | 0° | −6 |
| 1.3–3.8 | **Kestrel Water** lakeshore: gentle S-bends, the lake on the left. Sprint at 2.6 km | +30° | −8 to −4, rolling |
| 3.8–4.3 | **Mill Bridge** over the lake's outflow (`covered-bridge.glb`) | +40° | −4 |
| 4.3–6.0 | **Foss Bottom** farmland, a gentle false flat (barn, farmhouse, silos) | +20° | up to +25 |
| 6.0–10.3 | **Raven Scar** climb: 4.3 km at about 6.4%, steepest 300 m at 10%, five hairpins (three left, two right) | +60° | +25 to +300 |
| 10.3–10.65 | **Raven Gap**: an open rock cutting in the first pull request, a tunnel in milestone 3. KOM summit (category 2) at 10.3 km | 0° | +300 |
| 10.65–14.0 | **Highfold Woods** descent: sweeping bends, up to −10% | +120° | +300 to +10 |
| 14.0–15.0 | **Beck Lane** run-in beside the stream | +30° | +10 to −6 |
| 15.0–15.4 | Straight into the village, with a small kick to the line. **On the same heading as km 0** | 0° | −6 to 0 |

The turns add up to 360°.

### How the existing Stage API expresses it

- **Heading.** A list of pieces (straights and arcs), as in Morgul-Bismark. Each lap adds the loop's turn, as `mbHeading` does.
- **Closing the loop.** A hand-made loop never closes exactly. A small solver adjusts two straights that aren't parallel (0.9–1.3 and 4.3–6.0) until the end lands on the start. The lap length is whatever that gives, to the metre, and a test pins it, as `MB_LAP` is pinned.
- **Elevation.** `pchip` knots in lap metres, periodic over the lap.
- **Ground away from the road.** A `wildHeight` made of fbm noise, plus a ridge centred on the trace point of Raven Gap, plus `sinkInto` for the lake.
- **Lake.** A `PondBody` about 2.4 × 0.9 km at level −11. A `Scenery.roadside` hook grades the bank between the road and the water.
- **Named places.** Unnumbered `signs` entries through `namedPlaces()`.
- **Race points.** A sprint at 2.6 km and the Raven Gap summit at 10.3 km.
- **Behind the start.** The last 400 m of the lap runs on the start's heading, so the straight road `course.ts` draws behind the start lies on the real road. Routes that start at km 0 have no false road behind them.

## 2. Routes within the world

**Recommended design.** A `World` holds everything that is defined in lap metres and world coordinates. A `WorldRoute` is a window on the loop. `routeStage(world, route)` compiles a route into a `Stage`.

```ts
// src/worlds/types.ts
interface World {
  id: string; name: string; lap: number;
  headingAt(u: number): number; elevationAt(u: number): number; // lap metres, periodic
  scenery: Scenery; landmarks: LandmarkKind[]; places: [number, string][];
  race: RacePoints; baseAltitude: number; culture: CultureId;
}
interface WorldRoute {
  id: string;            // the stage id, permanent, e.g. `kestrel-vale-loop`
  name: string; tagline: string;
  start?: number;        // lap metres (milestone 2; always 0 in the first pull request)
  length: number | null; // null = endless
  badge?: { icon: string; title: string; text: string };
}
// Stage gains one optional field: world?: { id: string; route: string; start: number }
```

What `routeStage` does for a route that starts at `s`:

- `elevationAt(d) = W.elev(s + d) − W.elev(s)`, so every route starts at 0.
- Headings are absolute, so the road a route integrates is the world's road moved by −P(s), with no rotation. Everything that is a function of world position, such as `wildHeight` and the water bodies, moves by (P(s), −E(s)).
- Landmarks, places and race points move by −s, repeat each lap and are cut to the route.
- `lapLength = W.lap`.

**Alternatives rejected:**

- **A hand-written `Stage` per route.** The routes would drift apart.
- **A road network with junctions.** It would mean rewriting `course.ts`, `road.ts` and the terrain's blend near the road, which the constraints rule out.

**The real limitation:** a route can't choose a branch. For variety, a later lap can be laid out as a figure of eight or a lollipop, so that different windows of it feel different.

### What the design costs

| Area | Change |
|---|---|
| `Stage` | One optional `world` field. Nothing else changes. |
| `course.ts` | Milestone 2 only: for world stages, integrate the road backwards for d < 0 (about 15 lines). |
| Hub route picker | First pull request: none. The routes appear as normal cards named "Kestrel Vale · …". Milestone 2: group them into one world card with a chip per route (`src/hub/sections/route.ts`). |
| Mini-map | First pull request: none. Routes with a finish already draw, and the free ride shows its window ahead and behind. Milestone 2: draw the whole lap for an endless world route, and highlight a route's span. |
| KOM segments | First pull request: `segments.ts` builds the segment id from `${stage.world?.id ?? stage.id}:slug`. The 1-lap and 3-lap routes then share one Raven Scar board and one `segment_limits` row. This must ship in the first pull request: changing ids later orphans saved efforts. |
| Saved rides, ghosts, leaderboards | None: new ids only. **Route ids and the lap geometry are frozen once merged.** A change to the lap means a new id or a deliberate leaderboard reset. |
| Settings | No `settingsVersion` bump. An unknown `hubStage` id already falls back. |
| Schema | New `stage_limits` and `segment_limits` rows, and a schema version bump. |

## 3. The first pull request

**In:**

- The world: loop, elevation, terrain, lake, village, the Raven Gap cutting, places and race points.
- Three routes, all starting at km 0:
  - **Kestrel Vale Free Ride:** endless, so workouts have somewhere to go in the world.
  - **Vale Loop:** one lap.
  - **Grand Vale:** three laps.
- Segment ids scoped to the world.
- Limit rows in the database.
- Two route badges.
- Tests and docs.

**Out:** the tunnel, new models, and any change to the hub or the mini-map.

### Files

| File | Change |
|---|---|
| `src/stageKit.ts` (new) | Move `pchip`, `roadTrace`, `namedPlaces`, `monumentAt`, `GANTRY`, `startArch` and `finishArch` here unchanged, and re-export them from `stages.ts`. This breaks the import cycle. |
| `src/worlds/types.ts` (new) | `World`, `WorldRoute`, `routeStage()`, and the loop-closing solver `closeLoop(pieces, slackA, slackB)`. |
| `src/worlds/kestrelVale.ts` (new) | The world and its three routes. Its imports from `stages.ts` are type-only. |
| `src/stages.ts` | Add `world?` to `Stage`, and append `KESTREL_ROUTES` to `STAGES`. |
| `src/segments.ts` | Segment ids scoped to the world (one line, plus a comment). |
| `src/cloud/achievements.ts` | `first(...)` badges for Vale Loop and Grand Vale. |
| `db/schema.sql` | `stage_limits` rows for both routes with a finish, a `segment_limits` row for `kestrel-vale:raven-scar`, and the header bumped to `rev-2`. |
| `tests/unit/worlds.test.ts` (new) | The checks listed below. |
| `tests/unit/stageLimits.test.ts`, `segments.test.ts`, `segmentLimits.test.ts` | Add the new ids and pins, and deduplicate segments shared across a world. |
| `tests/e2e/kestrelVale.spec.ts` (new) | `?stage=kestrel-vale-loop&start={0.3,2.5,8,10.4}&graphics={low,medium}&adapt=off`: no page or shader errors, the lazy chunks load, and a screenshot is saved for review. Also checks the hub lists the three cards. |
| `docs/developer-guide/stages-and-gpx.md`, `README.md` | A "Worlds and routes" section, and the stage list. |

### Unit tests in `worlds.test.ts`

- The loop closes to within 1 m, and it turns +2π.
- The lap length is pinned.
- Elevation is periodic and continuous, and the grade stays within ±12%.
- The climb's length, gain and average match its tagline.
- The road doesn't cross itself: samples more than 300 m apart along the lap stay more than 40 m apart on the ground.
- The road stays at least 15 m from the lake's edge, and the ground under the lake is below the water.
- Every repeating landmark's `every` divides the lap.
- Route ids match `^[a-z0-9-]{1,60}$` and are unique.
- `finish` is the number of laps times the lap, and the free ride's `finish` is `null`.

**After merging:** apply the new limit rows to Neon. This changes the live database, so it waits for confirmation. Until the rows exist the routes have no cheat floor, which does no harm.

## 4. What to build in code and what to model

**Kits built in code** (`Kit` monument builders, instanced as in `barriers.ts`):

- **Dry-stone field walls:** an instanced version of `stoneGeometry()`, laid along field edges from the field noise.
- **Rock cutting:** walls for Raven Gap, reusing the shapes behind `makeRoadside` in `canyon.ts`.
- **Tunnel:** a tube extruded along the road's centreline, with a stone portal arch as a monument.
- **Stone viaduct:** a repeating arch module, seen from the climb across Foss Bottom.
- **Lakeside jetty and moored boats.**
- **Village dressing:** bunting and a market cross.
- **The village itself:** the existing `terrace` rows (stone), `alpine-church` and `chalet`.

**Existing models to reuse:** `covered-bridge`, `barn`, `farmhouse`, `silos`, `windmill` and `gantry`.

**Hero landmarks worth generating later** (a separate credit approval):

- **Raven Keep:** a ruined tower on the crag above the hairpins, seen from across the lake.
- **The Kestrel Water boathouse.**
- **The inn or market hall** on the Hollins Cross square.

Each is about 10 to 12 credits from one image, or about 20 from several views, through the existing Higgsfield pipeline (`gpt_image_2_5`, then Tripo, then shrunk with `@gltf-transform`). None of them is needed before milestone 5.

## 5. Risks, in order

1. **Changing routes after release.** A change to the lap after release breaks ghosts, leaderboards and segment times.
   - Freeze the ids, and pin the lap length and segment geometry in tests from the first pull request.
   - Scope segment ids to the world from the start.
   - A later change to the geometry gets a new id.
2. **A world that doesn't hang together.** The road's ground blend can lift land over the lakeshore, hairpins can sit badly in the ridge, and the loop can cross itself.
   - The bank hook and the lake tests.
   - Place the ridge from the trace's own points.
   - The self-crossing test.
   - Review the screenshots taken at four places along the lap in the e2e test.
3. **Performance and streaming.** The village and the climb can both be inside the terrain's 1,150 m radius, and the village can be crowded with monuments.
   - Keep to Richmond's terrace density, which is already known to run well.
   - A pure test counts the landmarks within 1,600 m at the busiest point.
   - Check on Low and Medium.
   - The tunnel tube is built per road chunk, so it streams with the road.
4. **Save-data compatibility.**
   - New ids only, and no settings change.
   - Reverting is safe: unknown stage ids fall back to Heartland, and saved activities keep their `stage_name`.
5. **Scope.** The tunnel is the costly unknown: overhanging ground on a heightfield, the camera at the portals, and the light inside.
   - Keep it out of the first pull request, and try it as a spike first in milestone 3.
   - The fallback is a covered gallery against the cliff.
   - Art and multiplayer stay separate phases.

**The tunnel spike's approach:** the roadside hook raises the ground over the tunnel's span. The terrain's back faces are culled, so from inside it can't be seen. The tube casts shadows, which darkens the rider without touching the lighting in `world.ts`.

## 6. Milestones

| # | What | Size |
|---|---|---|
| 1 | The Kestrel Vale world, three routes, segment ids scoped to the world, limit rows, two badges, tests | **L** (about 900 to 1,200 lines, about half of them tests and data) |
| 2 | Routes that start partway round the lap, with the backwards road in `course.ts`: **Raven Scar** (km 5.9 to 10.65) and **Lakeside Sprint** (km 14.0 to 4.3, across the lap line). The hub's world card, and the whole lap on the mini-map | **M** |
| 3 | The tunnel spike, then the tunnel. Crowd spots in the village. Grand Vale in the event pool (with its `event_stage_pool` row). A badge for riding every Vale route | **M** |
| 4 | Kits built in code: walls, viaduct, jetty, bunting | **M** |
| 5 | Hero models, after the credits are approved | **S** in code, plus the art |

**Later, outside this phase:** presence across a whole world, so riders on different routes in the same world see each other.

## Brief for the Sonnet subagent (milestone 1)

> Branch `claude/gallant-noether-fz1s36`, American Flyers (Vite, TypeScript, Three.js). Read `CLAUDE.md`, `docs/developer-guide/kestrel-vale-plan.md` (this page), `docs/developer-guide/stages-and-gpx.md`, the Morgul-Bismark block in `src/stages.ts` (around lines 900 to 975) and `circuitGeometry`, `namedPlaces` and `roadTrace` in the same file, `src/world/waterTypes.ts`, `src/segments.ts`, `tests/unit/{stages,stageLimits,segments,segmentLimits}.test.ts` and `tests/e2e/scenery.spec.ts`.
>
> Build the fictional circuit world "Kestrel Vale" as data. Don't change the renderer, the ride loop, the hub or the mini-map.
>
> 1. Create `src/stageKit.ts`. Move `pchip`, `roadTrace`, `namedPlaces`, `monumentAt`, `GANTRY`, `startArch` and `finishArch` into it unchanged, and re-export them from `stages.ts` so existing imports still compile.
> 2. In `src/worlds/types.ts`, write `World`, `WorldRoute` and `routeStage(world, route): Stage`. Routes start at 0 in this pull request; leave moving the start as a documented TODO. Also write `closeLoop()`: from a list of pieces (`{ len, turnDeg }`, each turn spread evenly over its length), adjust the lengths of two named straights so the loop's end lands on its start (a 2×2 linear solve), and return `headingAt(u)` and `lap`.
> 3. In `src/worlds/kestrelVale.ts`, build the world from the lap table above, with `culture: 'gb'`, `road: 'alpine'` and `barrier: 'stone'`.
>    - The lake is a `PondBody` at level −11, placed from the trace, with a roadside hook that grades the bank.
>    - Raven Gap is a rock cutting made with the shapes in `canyon.ts`.
>    - The village has rows of stone `terrace`, the `alpine-church` and the start arch.
>    - The covered bridge stands at km 3.8 to 4.3.
>    - Farm models have an `every` that divides the lap.
>    - Places go through `namedPlaces`. Race points: a sprint at km 2.6 and the summit "Raven Gap" (category 2) at km 10.3.
>    - The last 400 m must share the heading of km 0.
>    - Routes: `kestrel-vale` (endless), `kestrel-vale-loop` (one lap) and `kestrel-vale-grand` (three laps).
>    - Add the optional `world` field to `Stage`, and append the routes to `STAGES`. Imports from `stages.ts` are type-only.
> 4. In `src/segments.ts`, build segment ids from `stage.world?.id ?? stage.id`.
> 5. Add badges for the two routes with a finish in `src/cloud/achievements.ts`, following the existing `first(...)` lines.
> 6. In `db/schema.sql`, add the `stage_limits` and `segment_limits` rows, computed as the tests compute them, and bump the header to `rev-2`.
> 7. Tests:
>    - Write `tests/unit/worlds.test.ts` with every check in section 3.
>    - Update the pinned tables in the existing tests, and deduplicate shared world segments in `segmentLimits.test.ts`.
>    - Write `tests/e2e/kestrelVale.spec.ts` modelled on `scenery.spec.ts`: the four start points, each on Low and Medium, with no errors and screenshots saved to `test-results/`.
> 8. Docs: a "Worlds and routes" section in `stages-and-gpx.md`, and the stage list in `README.md`.
>
> Follow the comment style of the files you touch. Add no dependencies. Don't change `src/world/**` rendering or `main.ts`. `npm run build`, `npx vitest run` and the new e2e test must pass. Report the pinned lap length, the climb's figures and the screenshot paths. Don't commit; return a summary of the diff.

## Open question

Is the open rock cutting at Raven Gap acceptable as the first pull request's stand-in for the tunnel?
