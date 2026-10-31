# Stages and GPX

This page covers the stage definition, how the six mountain climbs are built from published figures, how the Heartland and Route 66 courses are shaped, and how a GPX file becomes a stage.

Source: [`src/stages.ts`](../../src/stages.ts), [`src/course.ts`](../../src/course.ts), [`src/routes/gpx.ts`](../../src/routes/gpx.ts), [`src/routes/library.ts`](../../src/routes/library.ts).

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
| `signs` | `{ d, label, style }[]` | Hairpin plaques. |
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
| `coniferBias` | 0 for broadleaf, 1 for conifers. |
| `forestCover` | Negative for open farmland, higher for more forest. |
| `fields` | Whether farmland patches appear. |
| `mountainScale` | Height of the distant mountain ring. |

`course.ts` wraps the current stage: `elevationAt`, `gradeAt` (a central difference over ±2 m), `headingAt`, and a cached centerline built by stepping 2 m along the heading. Changing stage clears that cache.

## Heartland Rollers and Route 66 Flats

Both are built from sums of sine waves (`waves()`), eased in from flat over the first 400 m (or 800 m on Route 66). Heartland has no finish. Route 66 has `finish: 25000`.

## The mountain climbs

Hell of the West, Alpe d'Huez, Stelvio Pass, Mont Ventoux, Col du Tourmalet and Monte Zoncolan all use `buildClimb()`, which takes a `ClimbSpec`:

| Field | Meaning |
| --- | --- |
| `kmGrades` | Average gradient for each kilometer, in percent. The last entry can cover a part kilometer. |
| `length`, `gain` | Length and total climb, in meters. |
| `hairpins`, `firstHairpin`, `lastHairpin` | Count and positions. |
| `bunching` | Above 1 makes the straights shorter higher up. |
| `approachBends`, `finalBend` | Gentle bends in radians before the first hairpin, and after the last. |
| `hairpinWord`, `baseAltitude`, `timeOfDay`, `weather`, `scenery` | As in the stage definition. |

How it works:

1. **Hairpins.** Each hairpin is a bend with a 12 m centerline radius that turns the road through almost 180°, joined by straights angled up the mountainside at 0.12 rad from the fall line. Straight lengths are spread with a deterministic jitter, then scaled so the whole sequence fits between the first and last hairpin.
2. **Heading.** Straights follow their angle, and bends turn through the hairpin's arc. Small meanders keep the straights from looking ruled.
3. **Gradient.** Each kilometer's gradient is interpolated from the `kmGrades` midpoints. Inside a hairpin the raw gradient is halved, because the bend is flatter. Each kilometer is then rescaled so its average matches `kmGrades`, and the whole climb is scaled so its total gain matches `gain`.
4. **Elevation.** The result is integrated into a height profile. Past the summit there's a 60 m run-out, rising 1 cm per meter.
5. **Scenery.** A plane is fitted to the road's rise across the mountainside, so the land beside the road climbs with it. Massif and ridge noise are added above that plane.
6. **Signs.** Each hairpin gets a plaque 12 m before its start, numbered so the first one you reach carries the highest number.

### Published figures and the approximation

- **Alpe d'Huez.** The per-kilometer gradients come from swi-cycling.com. The base is 723 m, and the 1,118 m gain puts the summit at 1,841 m.
- **Stelvio Pass.** No per-kilometer source was found, so the shape is an approximation: an easier valley start, then 8 to 9%, with the hairpins bunched toward the top. The base is 915 m and the gain is 1,843 m, so the summit is at 2,758 m.
- **Hell of the West** (`hell-of-the-west`). The final stage of the film *American Flyers* was filmed on Colorado 103 from Idaho Springs to Echo Lake (fast-rewind.com filming notes). 20.8 km and 942 m from 2,293 m to 3,235 m (pjammcycling.com), averaging about 3.5% for the first 11 km and 5.8% for the next 9 (summitbiking.org), then the short flat at the lake. Five switchbacks in the upper half (*Switchback*); scenery is all conifer forest, with Colorado's treeline (≈3,500 m) above the finish and snow on the surrounding 4,000 m peaks.
- **Hell of the West tour stages.** Stages 1 and 2 are not built by `buildClimb()`; `stages.ts` defines them directly, from a monotone cubic interpolation (`pchip`) through published knots plus small rolling waves.
  - **Morgul-Bismark** (`hotw-morgul-bismark`): a closed loop made of straights and quarter-circle corners (`MB_SEGS`), 21.1 km (13.1 miles; wikipedia.org *Morgul-Bismark*, coloradohometownweekly.com 2011-05-25), ridden twice. Opposite straights carry the same small bend, so the lap closes to within a metre and lap 2 lies on lap 1; elevation is periodic (`d mod lap`), and farm landmarks' spacing divides the lap so the scenery repeats too. The Wall is the last 1.6 km of each lap, building to 18% and easing before the line. `Stage.lapLength` is the lap.
  - **Tour of the Moon** (`hotw-tour-of-the-moon`): Rim Rock Drive, 37 km (23 miles), high point 2,024 m (6,640 ft), about 700 m of climbing for the park loop (nps.gov *Road Biking on Rim Rock Drive*; mtntownmagazine.com *Classic Rides: The Colorado National Monument's Tour of the Moon* for the order of climbs). Switchbacks are a heading wiggle over the first 6 km. The scenery is `palette: 'desert'`.
  - `Stage.race` lists intermediate sprints and named summits (`RacePoints`); where it has no summits they are found from the profile by `detectSummits()`. `Stage.tourStage` is the stage's number in the tour.
- **Mont Ventoux** (`ventoux`). From Bédoin, 21.4 km, 1,610 m, 300 → 1,910 m. Per-kilometer shape approximated from published profiles: gentle to Saint-Estève, 9–10% through the forest, easing past Chalet Reynard. The bald white summit uses the snow shading (snow line set just above the tree line).
- **Col du Tourmalet** (`tourmalet`). From Luz-Saint-Sauveur, 19 km, 1,404 m, 711 → 2,115 m, steeper above Barèges with eight hairpins. Shape approximated.
- **Monte Zoncolan** (`zoncolan`). From Ovaro, 10.1 km, 1,210 m, 525 → 1,735 m, 11.9% average with long 13–15% stretches and nine hairpins. Shape approximated; the steepest 10 m ramps reach about 16% (the real road touches 22%, smoothed out by the per-kilometer model).

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
