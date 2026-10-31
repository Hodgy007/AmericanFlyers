# Stages and GPX

This page covers the stage definition, how the two mountain climbs are built from published figures, how the Heartland and Route 66 courses are shaped, and how a GPX file becomes a stage.

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

Alpe d'Huez and Stelvio Pass use `buildClimb()`, which takes a `ClimbSpec`:

| Field | Meaning |
| --- | --- |
| `kmGrades` | Average gradient for each kilometer, in percent. The last entry can cover a part kilometer. |
| `length`, `gain` | Length and total climb, in meters. |
| `hairpins`, `firstHairpin`, `lastHairpin` | Count and positions. |
| `bunching` | Above 1 makes the straights shorter higher up. |
| `approachBends`, `finalBend` | Gentle bends in radians before the first hairpin, and after the last. |
| `hairpinWord`, `baseAltitude`, `scenery` | As in the stage definition. |

How it works:

1. **Hairpins.** Each hairpin is a bend with a 12 m centerline radius that turns the road through almost 180°, joined by straights angled up the mountainside at 0.12 rad from the fall line. Straight lengths are spread with a deterministic jitter, then scaled so the whole sequence fits between the first and last hairpin.
2. **Heading.** Straights follow their angle, and bends turn through the hairpin's arc. Small meanders keep the straights from looking ruled.
3. **Gradient.** Each kilometer's gradient is interpolated from the `kmGrades` midpoints. Inside a hairpin the raw gradient is halved, because the bend is flatter. Each kilometer is then rescaled so its average matches `kmGrades`, and the whole climb is scaled so its total gain matches `gain`.
4. **Elevation.** The result is integrated into a height profile. Past the summit there's a 60 m run-out, rising 1 cm per meter.
5. **Scenery.** A plane is fitted to the road's rise across the mountainside, so the land beside the road climbs with it. Massif and ridge noise are added above that plane.
6. **Signs.** Each hairpin gets a plaque 12 m before its start, numbered so the first one you reach carries the highest number.

### Published figures and the approximation

- **Alpe d'Huez.** The per-kilometer gradients come from swi-cycling.com. The base is 723 m, and the 1,118 m gain puts the summit at 1,841 m.
- **Stelvio Pass.** No per-kilometer source was found, so the shape is an approximation: an easier valley start, then 8 to 9%, with the hairpins bunched toward the top. The base is 915 m, and the gain is 1,824 m. The tagline gives the summit as 2,758 m. Base plus gain is 2,739 m, so the tagline and the stage data don't quite agree.

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
