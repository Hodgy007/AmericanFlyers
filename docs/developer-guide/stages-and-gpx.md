# Stages and GPX

This page covers the stage definition, how the mountain climbs and two of the Hell of the West stages follow real roads baked from map data, how the Heartland and Route 66 courses are shaped, and how a GPX file becomes a stage.

Source: [`src/stages.ts`](../../src/stages.ts), [`src/course.ts`](../../src/course.ts), [`src/routes/realStage.ts`](../../src/routes/realStage.ts), [`src/routes/realRoute.ts`](../../src/routes/realRoute.ts), [`scripts/bake-routes.mjs`](../../scripts/bake-routes.mjs), [`src/routes/gpx.ts`](../../src/routes/gpx.ts), [`src/routes/library.ts`](../../src/routes/library.ts).

## The stage definition

A `Stage` in `src/stages.ts`:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Used in `?stage=`, in the database (`stage_id`) and for achievements. |
| `name`, `tagline` | string | Shown in the picker. |
| `finish` | number or `null` | Finish distance in meters. `null` is an endless stage. |
| `elevationAt(d)` | function | Height above the start, at distance `d`. |
| `headingAt(d)` | function | Direction of travel in radians (0 is +x). |
| `scenery` | object | Terrain and scenery settings (see below). |
| `landmarks` | `LandmarkKind[]` | Landmarks to place. See [3D world](3d-world.md#landmarks). |
| `signs` | `StageSign[]` | Hairpins and named places: `{ d, label, style, numbered?, name? }`. A numbered sign (`numbered` not `false`) gets a plaque on the road and a "next: Virage 7" announcement. `numbered: false` marks a bend the real road does not number (crowds and guardrails still gather there, nothing is drawn or announced); a `name` ("Chalet Reynard") is announced in place of a number. |
| `hairpinWord` | string, optional | The local word for a hairpin, such as *Virage*. |
| `baseAltitude` | number, optional | Meters above sea level at the start, for the elevation readout. |
| `timeOfDay` | `'dawn' \| 'day' \| 'dusk' \| 'night'`, optional | The light when the rider's time of day is on Auto (default `day`). Route 66 and Hell of the West use `dusk`. |
| `weather` | `'clear' \| 'cloudy' \| 'rain'`, optional | The weather when the rider's weather is on Auto (default `clear`). The Tourmalet uses `cloudy`. |
| `uploaded` | boolean, optional | True for GPX routes. |

The `scenery` object:

| Field | Meaning |
| --- | --- |
| `wildHeight(x, z)` | Ground height far from the road. |
| `bumpAmp` | Small-scale roughness, in meters. |
| `rockLine`, `snowLine`, `treeLine` | Heights where rock, snow and the tree line begin. |
| `screeLine` (optional) | Height where bare pale limestone scree begins, with no trees above it. Ventoux sets it, with `snowLine: 1e9` (its white summit is limestone, not snow). Same datum as the other lines: metres above the stage's start. |
| `coniferBias` | 0 for broadleaf, 1 for conifers. |
| `forestCover` | Negative for open farmland, higher for more forest. Below -0.2 the lone trees thin out too (Morgul-Bismark, at -0.45, is open grassland with the odd clump). |
| `trees` | Optional `{ species: weight }` (`spruce`, `pine`, `larch`, `oak`, `beech`, `aspen`, `cottonwood`, `juniper`, `shrub`); the weights are relative. Left out, the mix comes from `coniferBias`, which is what an uploaded route gets. Height still decides what fits (`habitat()` in `trees.ts`), and shrubs take over at the tree line. |
| `fields` | Whether farmland patches appear. |
| `mountainScale` | Height of the distant mountain ring. |
| `road` | Optional `RoadStyle`: `'us-highway'` (default), `'alpine'`, `'lane'` or `'park'`. Sets the road's paint and surface (see `world/roadStyle.ts` and the road section of the 3D world guide). Uploaded routes use the default. |
| `dryGrass` | Optional 0 to 1: how much of the grass has dried to straw (golden vertex colour, and the dry-grass layer and tufts). Mount Diablo sets 1. |
| `barrier` | Optional `'rail'` (default, W-beam guardrails) or `'stone'` (low dry-stone parapets). |
| `roadside(d, lateral, plain)` | Optional hook that shapes the ground beside the road (canyons). `d` is the course distance of the nearest road point, `lateral` the signed offset from the centreline (+ right), `plain` the height relative to the road the terrain would give. It returns the height relative to the road, or `null` for no opinion. The terrain then reaches 900 m from the road instead of 260 m. It runs for every vertex near the road, so keep it cheap, and key it off `d` and `lateral` (never world coordinates) so it survives a change of route. A stage with a hook also gets barriers (`hasBarriers()`). See `world/canyon.ts`. |

`course.ts` wraps the current stage: `elevationAt`, `gradeAt` (a central difference over ±2 m), `headingAt`, and a cached centerline built by stepping 2 m along the heading. Changing stage clears that cache.

## Heartland Rollers and Route 66 Flats

Both are built from sums of sine waves (`waves()`), eased in from flat over the first 400 m (or 800 m on Route 66). Heartland has no finish. Route 66 has `finish: 25000`.

## Real roads

The mountain climbs (European and American), Echo Lake (`hell-of-the-west`), the Tour of the Moon and the Morgul-Bismark loop follow their real roads. The road lines come from OpenStreetMap and the elevation from SRTM, fetched once by hand through [BRouter](https://brouter.de) and baked into small modules in `src/routes/real/` by `scripts/bake-routes.mjs`. Heartland and Route 66 stay synthetic, and so does Morgul-Bismark's elevation (it has its own hand-made Wall).

> **Map data.** Road lines © OpenStreetMap contributors (ODbL), routed with BRouter; elevation: SRTM (NASA, public domain). The credit is in the README, here, and under the stage list in the hub's Route section.

### The data format

Each `src/routes/real/<id>.ts` is generated (don't edit it) and exports a `RealRouteData` (`routes/realRoute.ts`):

| Field | Meaning |
| --- | --- |
| `length` | The real road's length in metres. |
| `head0`, `head` | The heading of the first sample (units of 4 mrad) and a base64 string of int8 changes: one sample every 5 m. East is 0 and south is +π/2, as in the world, so a right turn raises the heading. The heading is unwrapped (Stelvio turns through 80π in all). |
| `ele0`, `ele` | The first elevation (decimetres) and int8 decimetre changes every 20 m. Empty for a shape-only road (Morgul-Bismark). |

`decodeRoute()` turns that into two `Float64Array`s. All the baked roads together are about 125 KB of base64 and 52 KB gzipped; they are in the first load because the hub draws every stage's profile from `elevationAt` before you ride.

### Baking a route

```
node scripts/bake-routes.mjs [id ...]    # all of them when no id is given
```

`ROUTES` in the script is the list: a stage id, the `lonlats` to route through (extra waypoints force the right road; put them on the road, never on a junction or a roundabout, or the router makes a little loop there), the stage's published `length`, `start` and `end` altitudes, and flags (`profile` names the BRouter profile: `car-eco` for the Mount Washington Auto Road, which is tagged `bicycle=no` in OpenStreetMap, so the default `fastbike` routes round it over footpaths; `trimToTop` ends a summit climb at its highest point, `closed` closes a circuit exactly, `noElevation` keeps only the shape, `smoothing` multiplies the elevation smoothing: the rolling Rim Rock Drive uses 3 so SRTM's wobble doesn't add climbing the road doesn't have, 763 m against the Park Service's 700). Raw BRouter answers are cached in `scripts/.cache/` (ignored by Git), so reprocessing is free; delete the folder to fetch again. The script:

1. resamples the route every metre in a flat projection and smooths the positions over about 10 m;
2. takes the heading every 5 m, then caps how fast it may change at 0.09 rad/m, spreading the excess over the neighbouring samples so the total turn is kept: no bend is tighter than an 11 m radius, so the 9.2 m road never folds on itself even on Stelvio's hairpins;
3. takes the elevation through a median filter (SRTM's 90 m cells straddle cliffs and tunnels), smooths it over about 100 m and caps its steps at 35%;
4. for a circuit, adds a whole number of turns to the heading and trims two sine bumps off it until the end meets the start (position and heading);
5. prints the length against the stage's (it warns beyond 8%, except for a circuit), the altitudes against the published ones, and writes the module.

To add a road: add an entry, run the script for it, add `route: <module>` to a `ClimbSpec`, and look at the log's warnings. The BRouter profile (`fastbike` by default) and a few waypoints are usually all it takes.

### From data to a stage (`routes/realStage.ts`)

- **Length.** The stage's length is fixed (leaderboards, ghosts, race schedules and the `stage_limits` table depend on it), so the real road is mapped onto it proportionally: `headingAt(d)` reads the data at `d × realLength / stageLength`. The baked roads are within 5% of their stages' length except Echo Lake (4%), the Tour of the Moon (7%) and the Morgul-Bismark loop (6%); a few per cent of stretch is invisible.
- **Elevation.** `elevationFrom()` takes the real profile and rescales it to the published figures: each kilometre to its published gradient when the stage has `kmGrades` (Alpe d'Huez), then the whole climb so the finish is `gain` above the start (a road that also descends, the Tour of the Moon, is scaled so its highest point is `peak`), then the gradient is capped at `maxGrade` (near the published maximum: 13.5% on the Alpe, 22% on Zoncolan) by handing the excess to the neighbouring 10 m points. A climb never descends (`climbOnly`: SRTM's small dips are levelled). Past the finish there is the usual 60 m run-out, rising 1 cm per metre.
- **Hairpins.** `detectHairpins()` finds the stretches where the heading turns faster than 0.02 rad/m for a total of more than 140° (gaps up to 15 m are bridged). Given an official count it relaxes the threshold (to 125°, then 110°) until it finds that many, and keeps the sharpest if there are more. A hairpin gets a sign 12 m before it (`StageSign`), and `at.hairpin(label)` gives its apex and the outside of its turn, so a landmark can stand on the right side of hairpin 7. Only Alpe d'Huez (21) and Stelvio (48) number theirs, counting down to the top (`ClimbSpec.hairpins`); the other roads' hairpins are unnumbered signs, and `ClimbSpec.places` adds named ones (Saint-Estève, Chalet Reynard, Barèges, La Mongie). `at.altitude(m)` gives the course distance where the road reaches an altitude, to place a landmark where the real place is (Chalet Reynard is at 1,440 m).
- **The land.** As before, a plane is fitted to the road's rise (`landPlane()`), so the land climbs with the road, with massif and ridge noise above it; the terrain's near-road blending keeps stacked hairpins apart.

### The stages

- **Alpe d'Huez** (`alpe-dhuez`). From Le Bourg-d'Oisans, 14 km, 1,118 m, 723 → 1,841 m, with the published per-kilometre gradients (swi-cycling.com). 21 hairpins are found, hairpin 21 at the foot and hairpin 7 (the Dutch Corner) in Huez village at about 1,400 m, where the village church stands.
- **Stelvio Pass** (`stelvio`). From Prato allo Stelvio up the SS38 through Gomagoi and Trafoi, 24.5 km, 1,843 m, 915 → 2,758 m. 48 hairpins are found and numbered down from the top, which matches the real plaques: the pair 48 and 47 follow Gomagoi, below Trafoi (the famous "48" sign is there), 46 is at the Hotel Bella Vista in Trafoi (1,543 m), the Gasthof Weisser Knott follows 33, the Franzenshöhe (2,188 m) is at 22, and 4 to 1 come one after another before the last ~500 m straight to the pass (quaeldich.de, *Stilfser Joch: Nordostrampe von Prad*; cyclingdestination.cc; pjammcycling.com). No stage-specific detector option is needed. `tests/unit/realStage.test.ts` pins these.
- **Mont Ventoux** (`ventoux`). From Bédoin up the D974 through Saint-Estève and Chalet Reynard, 21.4 km, 1,610 m, 300 → 1,910 m. The real profile is gentle to Saint-Estève and about 9–10% in the forest; the summit is limestone scree. Ventoux has no numbered hairpins.
- **Col du Tourmalet** (`tourmalet`). From Luz-Saint-Sauveur through Barèges, 19 km, 1,404 m, 711 → 2,115 m. No numbered hairpins.
- **Monte Zoncolan** (`zoncolan`). From Ovaro by the Liariis road, 10.1 km, 1,210 m, 525 → 1,735 m, 11.9% average with ramps to 22%. The road ends at its highest point (`trimToTop`).
- **American climbs.** Four hill climbs on their real roads, with the lengths and gains the climbing sites and race organisers publish (the baked road is within 3% of each length). Each ends at a brown park sign (`summit-sign-us`, see `summitSign()` in `stages.ts`) and the building or ruin that stands at the top, and each has a finish badge in the hub.
  - **Mount Washington Auto Road** (`mt-washington`). From the toll house on NH-16 at the Glen House to the summit parking: 12.2 km (7.6 mi), 1,417 m, 499 → 1,917 m (6,288 ft), 11.6% average, pitches to 22% (wikipedia.org *Mount Washington Hillclimb Auto Race*, mwarbh.org). Baked with the `car-eco` profile (the road is closed to bicycles outside the hill-climb). Northern hardwoods and spruce, krummholz at about 1,350 m, then bare grey rock; `weather: 'cloudy'`, a gale in `STAGE_WINDS` (11 m/s, into your face), `road: 'lane'`. The Sherman Adams building and observatory (`washington-summit`) stand at the top, with an "ELEV. 6,288 FT" board. Halfway House (1,170 m) is a named place.
  - **Mount Blue Sky** (`mt-blue-sky`, formerly Mount Evans). Colorado 5 from Echo Lake Lodge, where Echo Lake (`hell-of-the-west`) finishes, to the summit parking: 23.3 km (14.5 mi), 1,080 m, 3,231 → 4,311 m (14,130 ft), 4.6% (pjammcycling.com, codot.gov). Spruce and bristlecone pines to the tree line at about 3,500 m, then tundra, rock and lingering snow; `road: 'park'`. The lodge stands at the start (`log-lodge`), Summit Lake (12,830 ft) is a named place, the Crest House ruins (`crest-house-ruins`) are by the top and the board reads "14,130 FT". The published length is the PJAMM figure; the OSM road is 23.1 km.
  - **Mount Diablo** (`mt-diablo`). From Diablo Road in Danville up Mount Diablo Scenic Boulevard, South Gate Road and Summit Road: 18 km (11.2 mi), 990 m (3,249 ft), 183 → 1,173 m (the Mount Diablo Challenge's course, mountdiablochallenge.itsyourrace.com). The start is where Diablo Road meets Mount Diablo Scenic Boulevard; the baked road is 18.3 km. Oaks, grey pines and chaparral over golden grass (`Scenery.dryGrass: 1`; it keeps daytime light, because dusk turns the straw brown), `road: 'park'`. South Gate is a named place; the stone summit building and beacon (`diablo-summit`) stand at the finish.
  - **Flagstaff Mountain** (`flagstaff`). Flagstaff Road, Boulder, from Baseline Road to the crest of the road at 7,705 ft (2,349 m): 7.4 km (4.6 mi), 602 m (1,975 ft), 1,746 → 2,349 m, 8.1% (pjammcycling.com; theroadtocat2.wordpress.com gives 4.55 mi and 628 m for the same climb). That is the classic Flagstaff Road segment; the "Flagstaff Summit" road branches off it near the Amphitheater to a lookout that is lower (about 2,100 m), and the longer "Super Flag" starts further down. Ponderosa pine and open slopes, `road: 'us-highway'` (yellow centre line), Panorama Point is a named place, and the Flatirons stand on the left of the lower switchbacks.
- **Hell of the West** (`hell-of-the-west`, Stage 3). The final stage of the film *American Flyers* was filmed on Colorado 103 from Idaho Springs to Echo Lake (fast-rewind.com filming notes). The road is the real Chicago Creek road: 20.8 km, 942 m, 2,293 → 3,235 m, steeper after the creek leaves the road, with two wide switchbacks. Scenery is conifer forest (lodgepole pine, spruce and a little aspen), with Colorado's treeline (≈3,500 m) above the finish and snow on the surrounding 4,000 m peaks.
- **Hell of the West tour stages 1 and 2.** `stages.ts` defines them directly. `Stage.race` lists intermediate sprints and named summits (`RacePoints`); where it has no summits they are found from the profile by `detectSummits()`. `Stage.tourStage` is the stage's number in the tour.
  - **Morgul-Bismark** (`hotw-morgul-bismark`): the real loop around Superior, Colorado (OpenStreetMap, scaled from 22.4 km to the 21.1 km lap of 13.1 miles; wikipedia.org *Morgul-Bismark*): from the top of the Wall at McCaslin Boulevard and Highway 128, west on 128, north on Highway 93, east on Highway 170 and south down McCaslin to the line, ridden twice. The baked data is shape only and closes exactly (heading included), so each lap adds the same whole turn (`MB_TURN`) and lap 2 lies on lap 1; the elevation is the stage's own, periodic (`d mod lap`), with the Wall as the last 1.6 km of each lap, building to 18% and easing before the line. The lap's length is kept to the metre it had as a rounded rectangle (`MB_PIECES`), because races are timed against it; the Highway 93 sprint and the Flatirons (west of 93, so on the left riding north) sit half way along that leg (`MB_SPRINT`); farm landmarks' spacing divides the lap so the scenery repeats too. `Stage.lapLength` is the lap.
  - **Tour of the Moon** (`hotw-tour-of-the-moon`): Rim Rock Drive from just below the Grand Junction entrance (1,460 m) past Cold Shivers Point and the Saddlehorn visitor center to the Fruita entrance, 37 km (23 miles), high point 2,024 m (6,640 ft) (nps.gov *Road Biking on Rim Rock Drive*; mtntownmagazine.com *Classic Rides: The Colorado National Monument's Tour of the Moon*). The profile is scaled so its highest point is 2,024 m and capped at 10%. Cold Shivers, the high point, the rise at Black Ridge and the visitor center are race points placed from the real road. The canyon sections (`RIM_ROCK_SECTIONS`) and the monoliths are keyed to course distance and were kept as they were: they still sit on the right sides and stretches of the real rim road, but are not surveyed. The scenery is `palette: 'desert'`.

`finish_s` on a saved ride (the leaderboard time) is only set when a ride starts on the start line (`startDistance === 0`) and crosses the finish.

## Routes from GPX

### Parse

`parseGpx(fileName, text)` in `src/routes/gpx.ts`:

1. Parses the XML. If the parser reports an error, it throws *This file is not valid GPX (XML).*
2. Reads track points (`trkpt`). If there are fewer than two, it reads route points (`rtept`). If there are still fewer than two, it throws.
3. Reads latitude, longitude and elevation from each point. Points without a valid latitude or longitude are dropped.
4. Uses elevation only if more than 80% of points have it. Missing values are filled with the previous one, and if no elevation is usable, all values are zero and the route is flat.
5. Drops points less than 5 m from the last kept point (haversine distance).
6. Takes the name from `metadata/name`, then `trk/name`, then `rte/name`, then the file name without `.gpx`.

The result is a `StoredRoute` with an ID built from the time and a random suffix, the points as `[lat, lon, elevation]` rounded to 6 and 1 decimal places, and a `hasElevation` flag. It's stored as-is.

### Build a stage

`routeToStage(route)` turns the route into a `Stage`:

1. **Projection.** Points are projected onto a flat plane around the first point: x is east, z is south, so turns aren't mirrored.
2. **Resample** every 5 m along the route, interpolating position and elevation.
3. **Elevation.** The elevations are smoothed with two moving-average passes, each 17 samples wide (85 m at a 5 m step). The gradient between samples is capped at ±25%, and the elevation is rebuilt by integrating that capped gradient.
4. **Heading.** Taken from the smoothed track over ±2 samples, unwrapped so it can be interpolated, then smoothed again.
5. **Finish.** `finish` is the route length.
6. **Scenery.** A plane is fitted through the road's rise, as on the climbs. Hills are scaled by `hilliness`, which is the elevation range divided by 900 m, clamped between 0.15 and 1.
7. **Alpine.** If the start altitude plus the highest point is above 1,400 m, the route is treated as alpine: rock, snow and tree lines sit at 2,300 m, 2,800 m and 2,000 m above sea level (converted to the route's datum), and no farm landmarks are placed. Otherwise farm landmarks are used.
8. **Landmarks.** A start arch, a finish arch, and (if not alpine) `FARM_LANDMARKS`.

The tagline gives the length and climbing, and says *No elevation in the file, so it rides flat* when the file had none.

### Storage

Routes are stored in `localStorage` under `americanflyers.routes`. The built stage is cached in memory and rebuilt on load. When a route is saved while signed in, the `StoredRoute` is also written to the `routes` table, in its `data` column. See [Backend and database](backend-and-database.md).
