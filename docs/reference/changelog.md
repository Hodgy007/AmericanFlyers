# Changelog

This page is the history of merged work on `main`, grouped into releases by the pull request that merged them. Dates and subjects come from `git log --reverse --format='%h %ad %s' --date=short origin/main`.

The repository has no tags, so each group is named for the pull request that merged it.

## Unreleased

### A new rider

- **New rider model** (`public/models/rider.glb`), designed with Higgsfield from front, side and back views and built from all of them, so the back you see from the chase camera is modelled, not guessed: a vented helmet, wraparound glasses, gloves, a panelled jersey with a white chest band, bib shorts and cycling shoes. Rigged with the same skeleton, so pedalling, team kits, jersey patterns and socks work as before. 0.9 MB (was 1.4 MB).
- The default kit keeps its **stars**: white stars on the navy shorts, drawn by the kit shader.

### Fix: riding with others crashed every frame

- Since the code-review fixes, `presence.riders()` returns its own reused array, and the ride loop added the pro teams and the AI rival to it, so the next frame read past the riders it knew (`Cannot read properties of undefined (reading 'at')`): with Ride together on, pro teams, a race or an AI rival broke the ride loop. The loop now copies the array, and `riders()` trims anything a caller added. Caught by `kom.spec.ts` and `ai.spec.ts`.

### Four road stages: three circuits and the Pacific Coast

- **New stages** on their real roads, with real elevation: **Richmond Worlds Circuit** (`richmond-worlds`, 2 × 16.2 km, Libby Hill and 23rd Street KOMs, finish by the State Capitol), **Central Park Loop** (`central-park`, 3 × 9.8 km counter-clockwise, Cat Hill and Harlem Hill, the Manhattan skyline round the park, the Reservoir), **Harrogate Worlds Circuit** (`harrogate-worlds`, 2 × 13.9 km, dry-stone walls, stone terraces, the Stray at the finish) and **Pacific Coast Highway** (`pacific-coast`, 39.1 km of California 1 through Big Sur, Bixby Creek Bridge, Hurricane Point, the Pacific below the cliffs). Each has wind, a finish badge, a place in the evening race rotation and a `stage_limits` row (SQL in `db/schema.sql`, to be applied by hand).
- **KOM segments on the new roads:** Libby Hill and 23rd Street (Richmond), Cat Hill and Harlem Hill (Central Park), the Oak Beck climb (Harrogate) and Hurricane Point (Pacific Coast). On a circuit any named climb of 300 m and 12 m or more is a segment, found by walking back from its summit when it is too short for the climb detector. `segment_limits` rows added.
- **Yorkshire crowds.** A British culture (`gb`): Union flags, the white-rose Yorkshire flag and polka-dot shirts; Harrogate uses it. Culture ids live in `world/cultureTypes.ts`.
- **Water.** New `Scenery.water` (`world/water.ts`): a sea plane at sea level and ponds (the Reservoir), used by the Pacific Coast and Central Park.
- **Skyline and bridge.** A procedural city skyline (`world/skyline.ts`) ring of towers outside a loop, a domed Virginia Capitol, brick and stone terraced houses and Bixby Creek Bridge, all landmark models.

### Fix: the AI coach crashed on Vercel

- `/api/ai` failed to start (`ERR_MODULE_NOT_FOUND`), so the coach answered "taking a break": its suggestion list imported `src/stages.ts`, whose world modules use extensionless imports Node can't resolve in an unbundled function. The suggestions are now plain data (`src/ai/stageSuggestions.ts`), and `tests/unit/aiServerImports.test.ts` walks everything the functions import, failing on a missing `.js` or on `src/stages.ts`, and keeps the list in step with the stages.

### KOM segments on the big climbs

- **Segments.** A stage's big climbs (about a kilometre or more with at least 60 m of climbing, or a categorised summit) are timed segments: `src/segments.ts` derives them from the stage's own elevation, with stable ids (`alpe-dhuez:main`, pinned per built-in stage in `tests/unit/segments.test.ts`). Each mountain stage gets one segment for the whole climb, rolling stages their named climbs (Morgul-Bismark's Wall on each lap, Cold Shivers and the high point on the Tour of the Moon), flat stages none. Uploaded routes keep their segments local.
- **Efforts.** Each passage is timed in moving time with a split every 50 m; stopping, jumping along the road, opening the hub or resetting voids it. Your best and latest effort per segment are kept in this browser and, signed in, in the new `segment_efforts` table.
- **In the ride.** A KOM panel under the climb card shows the top 5 and your rank within 2 km of a segment, then a live gap to your best (and a smaller one to your last attempt) on it, and a result banner at the top (*Alpe d'Huez — 52:14 · New PB by 0:41 · #3 of 27*). A ghost of your best effort rides the road. **KOM panel** in Settings hides it.
- **Hub.** A **⛰ KOM ×n** chip on each route card opens its segments with the king of each climb and your best; each opens a top-10 board (this month or all time).
- **Database.** `segment_efforts` (own rows only), `segment_limits` (a plausibility floor per built-in segment, from the app's own physics) and `segment_leaderboard()`; `delete_my_account()` deletes the efforts by name. Applied to the live database (the SQL is in `db/schema.sql`, "KOM segments").
- **Achievements.** Hill climber, Beat yourself and Segment collector. **Privacy** text and docs updated; `?komtest` lets a demo ride count for your local times.
- Tests: `segments`, `segmentLimits`, `segmentStore`, `segmentAchievements` (unit) and `kom.spec.ts` (e2e).
### Mont Ventoux's summit: modelled mast on the white plateau

- **The summit is modelled** (Higgsfield, `public/models/ventoux-summit.glb`, about 1.1 MB and 21k triangles): the banded red-and-white weather-station mast on its pale concrete block, over the code-built observatory, which stays as the fallback if the file is missing (`MONUMENT_GLB` in `landmarks.ts`). It stands right of the road at 21,300 m, on the level crown of a new **summit cone** (130 m flat, then the ground falls away at 20 degrees), so it reads on the skyline well below the plateau and then sweeps past on the right in the last 130 m. The code-built mast grew to match (banded tower from 9.5 m to 68 m, taller aerial), so the fallback isn't stretched at the landmark's 76 m.
- **New scree texture** (Higgsfield `gpt_image_2`, through `scripts/prep-terrain.py`): pale limestone rubble with ochre patches and dark stones replaces Poly Haven's *Gray Rocks* in `public/textures/terrain/scree.jpg` and its normal map, so Ventoux's bald white top is limestone, not snow.
- Tests: `tests/unit/monuments.test.ts` (the observatory's height and place on the summit plateau).

### Higgsfield graphics

- **Horizon panoramas.** The far mountains are now a panorama of the stage's region (Alps, Pyrenees, Rockies, red-rock desert, rolling hills), generated with Higgsfield, keyed on its sky and wrapped round the sky ring with mirrored repeat. `scenery.horizon` picks it per stage (uploaded routes: alps if `mountainScale` >= 2, else hills). Loaded lazily, one WebP (about 55 to 110 KB, half size on Low); the procedural ring shows until it arrives or if it fails. The ring's haze, tint and per-stage height scale still apply. Files built by `scripts/prep-horizon.py`.
- **Generated grass and sandstone ground textures** (Higgsfield) replace the Poly Haven ones: clearly more blade and grain detail on slopes and desert ground, no visible tiling at riding distance. Normal maps come from `scripts/prep-terrain.py`. Generated rock and snow were tried and left out: no visible gain.
- **Le Géant du Tourmalet is a modelled statue** (Higgsfield, 0.86 MB `public/models/geant.glb`), same place, facing and height as the code-built one, which stays as the fallback if the file is missing (`MONUMENT_GLB` in `landmarks.ts`).
- **Camper vans are a modelled camper** (Higgsfield, 0.4 MB `public/models/camper.glb`, 4.4k triangles) on Medium, High and Ultra, instanced with a lightened random tint and scaled to 6.3 m long; the box vans stay on Low and until the file has loaded (the roadside objects are refitted when it arrives) or if it is missing. A big climb puts 15 to 24 vans in all and a handful in view, so no distance cut-off was needed (`SceneryTier.vanModel`).

### Loose ends from the polish batch

- **Mount Washington summit in frame at 400, 200, 100 and 50 m.** At 200 m the buildings were 53 degrees right of the chase camera's heading (the half-view is 43). A search over every position and rotation within about 100 m of the finish found none that keeps one group in view at all four distances, because the road wraps round the summit and the camera turns 100 degrees between 200 and 50 m. So the lattice broadcast tower is now its own landmark (`washington-tower`, with its own rock pile) on the outside of the bend, 60 m left of the road at 12,200 m and dead ahead of the last straight (23 degrees at 200 m, 13 at 400 m, 19 at 100 m), and the buildings stay inside the bend, where they are in frame at 400, 100 and 50 m. The summit group's size is now 38.5 m (its height without the tower), and it (and the summit cone) moved from 32 m to 40 m beside the road: its knoll's lower step reached to about 3 m from the road centre and showed as a grey wall across the right lane 25 m before the finish. Shots at 400, 200, 100, 50, 30 and 10 m checked. Tests in `summitCone.test.ts`.
- **Tour of the Moon no longer hazier on High.** Cause: the post chain (Medium and up) blends the haze in linear HDR where Low blends in display colour, which reads about twice as thick and pale over the dark red rock (Low with only the post chain on already looked like Medium), and High and Ultra's sky environment map then lights shaded rock with pale sky. Bloom, AO and the grade are not involved. Fix, for this stage only: new `Scenery.directHaze` (the post chain blends haze as Low does) and `Scenery.skyLight` (scales the environment, 0.3 here). Far ridge colour at Independence Monument View, Low 104,73,64: High was 151,128,128, now 110,79,74. Alpe d'Huez and Mont Ventoux on High are unchanged (mean pixel difference 0.7 and 0.1 of 255, the same as run-to-run noise). `scene.environmentIntensity` is now only written when it changes.
- **Coke Ovens checked and reshaped.** First time seen: they stand on the flat canyon floor (ground 163 to 181 m under the whole row, the road is 236 m above) and read through the haze, but they were squat hemispheres on pale plate-like aprons with striped Entrada colours. Now four taller beehive domes with near-vertical sides, a Wingate red-brown palette (new optional `colors` on the monolith lathe), a smaller and darker talus apron, and the row shifted onto the flat part of the floor. They are not visible from the chase, side or rider cameras at any distance: the guardrail and the 20 to 36 degree depression angle hide the canyon floor, so only a camera above the rail shows them.

- **autoGraphics e2e no longer flaky.** The race: the test looked at the toast (up for 4.5 s) and at `__afGraphics.change` (overwritten by the next step down) some time after the tier had dropped, and read the tier for the Settings note separately from the note while Auto was still stepping down; the last reload also had no wait for the hub. The test now records toasts and changes as they happen (MutationObserver and a 20 ms sampler), waits until the tier and the note agree, and waits for the hub after every reload. Assertions are unchanged.

### Stage fixes: Washington, Flagstaff, training plans

- **Stelvio's hairpin numbers were already right.** The detector's 48 match the real plaques (48 and 47 follow Gomagoi below Trafoi, 46 is at the Hotel Bella Vista in Trafoi, the Franzenshöhe is at 22, 4 to 1 come together before the last ~500 m straight); the docs said they might be out by four. Pinned by a test; no detector change.
- **Mount Washington.** `Scenery.barrier` gains `'none'` (`barrierKind()` / `hasBarriers()`): the Auto Road has no guardrails. A bare **summit cone** (`ClimbSpec.summit`, `world/summitCone.ts`) makes the ground fall away from the top, and the summit is now the long Sherman Adams building, observatory tower, a lattice broadcast tower, a stone hut and masts on a rock knoll, inside the last bend: in view from about 500 m out and again in the last 100 m.
- **Flagstaff's Flatirons** stand where the real ones do (from the First and Fifth Flatiron's coordinates, facing east, 270 m tall), through a new landmark option `world` (position in metres east/south of the start, height, yaw) and `world/flatironsPlacement.ts`; `ClimbSpec.basin` sinks the ground towards them. They are broadside and on the left over the first kilometre (clearest from the side camera) and behind the road further up.
- **Training plans.** A fourth plan, **American Climbs** (4 weeks): Flagstaff, Mount Diablo, Mount Blue Sky, and the Mount Washington Auto Road last.
- Tests: `tests/unit/summitCone.test.ts`, `tests/unit/flatironsPlacement.test.ts`, and additions to `realStage`, `roadside` and `plans`.

### Tour of the Moon: canyons and monoliths on the real rim

- `RIM_ROCK_SECTIONS` re-surveyed against the baked Rim Rock Drive (USGS 3DEP ground heights either side of the road, OpenStreetMap place names): Monument Canyon is on the right from Artists Point to Independence Monument View, Red Canyon, Ute Canyon and Fruita Canyon on their real sides, the drop on the left on the switchbacks above Monument Road and down Fruita Canyon, and no cliff across the plateau at Black Ridge and the visitor center. The cliff's lines are warped so its faces aren't ruled straight.
- The Coke Ovens, the Kissing Couple and Independence Monument stand at their real places along the road in Monument Canyon (the old extra copies are gone). Independence Monument is brought in from 566 m to 340 m so it reads through the haze.
- New optional `Scenery.clearAir` (the haze distance is multiplied by it); the Tour of the Moon sets 3.2, so the canyon floors and monoliths no longer wash out.
- `roadsideSlope()` now measures over +-4 m (a cell of the 4 m grid) instead of +-1.5 m, so no stone or bush is planted within a cell of a step in a cliff, where it would hang over the cut.
- Tests: `tests/unit/canyon.test.ts`, `tests/unit/monoliths.test.ts` (sides at sample distances, monoliths on the canyon floor, continuity).

### Ventoux scree, Le Géant, campers on stacked hairpins

- Mont Ventoux's summit scree reads as limestone rubble, not snow: a darker pale-grey base, warm ochre patches, dark streaks and gaps, a stronger grain and normal map for the scree layer (`CONTRAST`, `NORMAL` in `src/world/ground.ts`) and thicker, darker scattered stones on High and Ultra. Other stages are unchanged.
- Le Géant du Tourmalet is rebuilt: a steel cyclist (broad torso leaning 40 degrees, tapered limbs, head and helmet) out of the saddle on a steel bike with spoked wheels, on a stepped plinth with a "Le Géant du Tourmalet" plaque, with its own metallic material. `Kit.rod()` and `Kit.ball()` in `src/world/monumentKit.ts`.
- Campers (and every other `groundSampler()` user) no longer float or sink on stacked hairpins. Cause: the road centreline is generated lazily, and a sampler only scanned what existed when it was made, so the other leg of a hairpin further up the course was missing from the blend between legs until the road had been extended. `candidatesFor()` in `src/world/terrain.ts` now generates the road to the finish first. The strict test is back: every camper within 0.3 m of the ground (`tests/unit/crowdLife.test.ts`).

### Auto graphics at a few frames a second

- Auto graphics now steps down on a device managing only a few frames a second (frames of 120–400 ms): the 3 s window never held the 20 frames a verdict needed, so it stayed on Ultra. Six frames are now enough when their median is over 120 ms (`ADAPT.slowFewFrames`, `slowFewMs` in `src/world/adapt.ts`). Unit test in `tests/unit/quality.test.ts`.

### A visible way to end the ride

- A **⏹ End** button sits in the top bar on the ride screen (first in the row on phones, next to ☰ Menu elsewhere). After a minute or more (or in a race or group ride) it asks **End ride?** with **Save and finish** (**End ride** when signed out) or **Keep riding**, then shows the ride summary, which has **Start a new ride** and **Back to the hub**. Under a minute it goes straight to the hub. The old **↺ End / reset ride** menu item is now **⏹ End ride** and does the same.
- **🏠 Hub** and **⏹ End ride** now sit near the top of the ☰ Menu. The menu also has a `vh` height fallback plus touch scrolling, so on browsers without `dvh` (older Safari) it scrolls instead of running off the screen.
- `askToLeave()` in `src/hub/leave.ts` serves both questions (`purpose: 'end'`); `finishRide()` in `src/main.ts`. Test: `tests/e2e/endRide.spec.ts`.

### Four American climbs

- **New stages** on their real roads: **Mount Washington Auto Road** (`mt-washington`, 12.2 km, 1,417 m, pitches to 22%, cloudy and very windy, bare grey rock above the tree line), **Mount Blue Sky** (`mt-blue-sky`, 23.3 km, 1,080 m to 14,130 ft, the continuation of the Echo Lake stage from Echo Lake Lodge, tundra and snow patches above the tree line), **Mount Diablo** (`mt-diablo`, 18 km, 990 m, golden grass and oaks) and **Flagstaff Mountain** (`flagstaff`, 7.4 km, 602 m, with the Flatirons beside the lower switchbacks). Each ends at its summit building or ruin and a brown park sign with the real elevation, and has a finish badge.
- **Baking.** `scripts/bake-routes.mjs` gains a per-road `profile`: the Auto Road is tagged `bicycle=no` in OpenStreetMap, so it is baked with BRouter's `car-eco` profile. The four roads add about 23 KB of source to the first load (the main chunk goes from 154.2 to 166.7 KB gzipped).
- **Golden grass.** New optional `Scenery.dryGrass` (0 to 1) dries the grass to straw on the ground colour, the dry-grass layer and the tufts; Mount Diablo uses it.
- **Scheduling and limits.** The evening race rotation gains the four stages (`EVENT_STAGE_POOL` and `event_stage_pool` positions 9 to 12) and `stage_limits` gains their rows (`db/schema.sql`: apply it to the database). `tests/unit/stageLimits.test.ts` computes the limits for every stage through the app's physics; the older rows sit 0.4 to 3% below the computed floor, so they are slightly permissive.
- **Colorado crowds.** Mount Blue Sky and Flagstaff get the Colorado crowd culture; Washington and Diablo the American one.
- Tests: `tests/unit/americanClimbs.test.ts`, `tests/unit/stageLimits.test.ts`, and the stage lists in the existing stage tests.

### Real roads and gradients for the built-in stages

- **Real road lines.** Alpe d'Huez, Stelvio, Mont Ventoux, the Tourmalet, Monte Zoncolan, Echo Lake (Hell of the West stage 3) and the Tour of the Moon now follow their real roads, with real elevation, instead of a zig-zag of identical 12 m hairpins. The Morgul-Bismark circuit takes the shape of the real loop around Superior, Colorado (scaled to its 21.1 km lap, closing exactly); its elevation, with The Wall, is unchanged. Every stage keeps its length and published gain, so leaderboards, ghosts, schedules and `stage_limits` are unaffected, and Alpe d'Huez keeps its per-kilometre gradients.
- **Baked once, small.** `scripts/bake-routes.mjs` fetches each road from BRouter (OpenStreetMap lines, SRTM elevation), cleans it (median-filtered elevation, no bend tighter than an 11 m radius) and writes `src/routes/real/<id>.ts`: int8 steps of heading every 5 m and elevation every 20 m, about 40 KB gzipped for all of them. `routes/realStage.ts` maps the real length onto the stage's, rescales the profile to the published figures and caps the gradient near the published maximum.
- **Hairpins found, not invented.** They are detected in the real heading: Alpe d'Huez's 21 (hairpin 7, the Dutch Corner, is in Huez village at about 1,400 m) and Stelvio's 48 are numbered; Ventoux, the Tourmalet, Zoncolan and Echo Lake have none numbered, so the HUD no longer announces "next: Virage 1" on Ventoux. `StageSign` gained `numbered` and `name`: the HUD announces places ("next: Chalet Reynard in 800 m"), and crowds and guardrails still gather at every hairpin.
- **Places moved to where they are.** Chalet Reynard stands at 1,440 m on the real Ventoux; the Tour of the Moon's race points (Cold Shivers, the high point, Black Ridge, the visitor center) and Echo Lake's mountain prime are on the real road; the Flatirons now stand west of Highway 93 on the real loop.
- **Credit.** "Road lines © OpenStreetMap contributors (ODbL), routed with BRouter; elevation: SRTM (NASA, public domain)" is in the README, the developer guide and under the stage list in the hub's Route section.
- Tests: `tests/unit/realStage.test.ts` (decoder round trip, length mapping, hairpin detection, gradient capping, each stage's length and gain, the loop's closure).

### Crowds with local character, the Dutch Corner and roadside camps

- **Culture.** Crowds dress for the country, from the stage's hairpin word: France (tricolour, polka-dot jerseys and flags, Breton and Basque flags), Italy (tricolour, lots of Giro pink), the USA (stars and stripes) and Colorado on the Hell of the West stages (with the state flag). Flags are canvas-drawn in one atlas.
- **The Dutch Corner.** Alpe d'Huez's seventh hairpin has a crowd hotspot: three rows deep on both sides, mostly in orange with Dutch and orange flags, and louder (`crowdNear()` goes above 1 there). Hotspots are data (`{ d, radius, density, culture }` in `crowdZones.ts`), so other stages can have one.
- **Camper vans, tents and parasols** on the big climbs, parked 8 to 14 m back on the uphill verge in the crowd zones, kept off the road, the guardrails and parapets, steep ground and the last 150 m; thinned by tier, shadows from High (new `src/world/campers.ts`). High and Ultra spectators also get caps and bigger flags (`Scenery.crowdDetail`).
- Tests: `tests/unit/crowdLife.test.ts`.

### Procedural landmarks for the climbs and the Boulder circuit

- **Landmarks built in code.** `LandmarkKind` takes `model` (a `MonumentId`) as an alternative to `file` (a union: exactly one), with `options` (`lines`, `style`, `seed`) for words and looks. The builders (`src/world/monuments.ts`, `monumentBuildings.ts`, `flatirons.ts`, toolkit `monumentKit.ts`) make low-poly, flat-shaded, vertex-coloured groups from primitives, one merged mesh each under about 6,000 triangles; `landmarks.ts` imports them as a lazy chunk the first time one is in range, scales them to `size` and places them like models (small ones cast shadows).
- **Ventoux:** the summit observatory with its red-and-white banded mast, the Tom Simpson memorial 1.3 km from the top, Chalet Reynard. **Alpe d'Huez:** a village church on the outside of hairpin 7 (found from the stage's signs, so it follows the road), ski apartments near the top. **Tourmalet:** La Mongie's apartment blocks at 15 km and Le Géant du Tourmalet at the col. **Stelvio:** the hotels at the pass. **Echo Lake:** a log lodge.
- **Summit boards.** Every European climb ends with a brown (France) or green (Italy) board on posts: "COL DU TOURMALET / ALT. 2115 m", "PASSO DELLO STELVIO / 2758 m", "MONT VENTOUX / 1910 m", "MONTE ZONCOLAN / 1750 m", "ALPE D'HUEZ / 1850 m".
- **The Flatirons** stand west of the Morgul-Bismark circuit: six or seven red-tan slabs leaning on a forested ridge, 2.5 km from Highway 93 and visible from up to 7 km along the road (`LandmarkKind.reach`). They use a material that shrinks the distance the height fog sees, so they are hazy rather than fogged out, and cast no shadows.
- **For later stages** (built and tested, not placed yet): Mount Washington's summit buildings and mast, Mount Diablo's stone summit tower with its beacon, the ruins of the Mount Blue Sky summit house, and a wooden US park sign (`summit-sign-us`, any text).
- `ClimbSpec.landmarks` (a list, or a function given `at.hairpin(label)`) adds landmarks after the arches. Tests: `tests/unit/monuments.test.ts` (every builder's budget and shape, sizes match the stages, the church is at hairpin 7, the far-fog patch).

### Tour of the Moon: canyon rims, cliffs and monoliths

- **Canyons beside the road.** New optional `Scenery.roadside(d, lateral, plain)` hook shapes the ground near the road, keyed off course distance and lateral offset so it survives a change of route. The Tour of the Moon uses it (`src/world/canyon.ts`) for stretches with a canyon on the left, the right, both or neither: a ledge, a sheer stepped cliff of 120 to 220 m, a talus slope and a canyon floor, with rock climbing in ledges on the other side. The terrain reaches 900 m from the road on such a stage. Stone parapets run along the edges (the stage uses `barrier: 'stone'`, and barriers are no longer limited to stages with hairpin signs).
- **Nothing grows on cliffs.** `roadsideSlope()` keeps trees off slopes steeper than 0.6 and ground cover off slopes steeper than 0.5.
- **Monoliths** (`src/world/monoliths.ts`): Independence Monument, the Coke Ovens and the Kissing Couple stand on the canyon floors, with smaller ones further on; banded sandstone, flat-shaded, under 5,000 triangles each, shadows on High and Ultra.
- Tests: `tests/unit/canyon.test.ts`, `tests/unit/monoliths.test.ts`.

### Mont Ventoux's summit is limestone scree, not snow

- **A scree ground layer.** The terrain gets an eighth splatting layer, `scree` (Poly Haven's CC0 *Gray Rocks*: broken pale stones, `public/textures/terrain/scree.jpg` and `scree-n.jpg`, credited in `public/textures/README.md`). A stage's optional `Scenery.screeLine` (same datum as `rockLine` and `snowLine`) turns the ground above it, over a noisy band like the snow line, to warm pale grey with darker stones; rock still shows on steep slopes, cliffs there are a paler limestone, the road's shoulder stays scree rather than dirt, snow still wins above `snowLine`, and no trees grow above the line.
- **Ventoux** now uses `screeLine: 1150` (Chalet Reynard, where the forest ends) and `snowLine: 1e9`: it is summer, so the white summit is no longer a snowfield. Other stages are unchanged (Stelvio keeps its snow).
- **Per tier.** `layersFor()` takes the scree flag, so only Ventoux downloads the scree texture; Low uses grass, rock and scree there (still three layers). The texture array is eight layers deep on every stage (about 4 MB more GPU memory at 1K). The vertex-colour fallback is pale as well, before the textures arrive.
- Tests: `tests/unit/roadside.test.ts` (scree weights and colour, `layersFor`), `tests/e2e/scenery.spec.ts` (Ventoux fetches scree, not snow).

### Road style per region

- The road's look is now a property of the stage (`Scenery.road`). **Alpine** (Alpe d'Huez, Stelvio, Tourmalet, Ventoux): a white dashed centre line, thin worn edge lines, no gravel strip, darker patched asphalt. **Lane** (Monte Zoncolan): no markings, ragged dark edges. **Park** (Tour of the Moon): solid double yellow, red chip-seal tint, dusty-red shoulders. Everything else keeps the US highway look. The colour map and the asphalt normal/roughness maps both come from one pure description per style (`src/world/roadStyle.ts`, tested in `tests/unit/roadStyle.test.ts`), and the road repaints when the stage changes. The alpine texture is 768 px long so a 3 m dash and a 10.8 m gap tile.
- **Milestones.** On the French and Italian climbs the distance signs are cyclists' milestones: a white post with a yellow (France) or red (Italy) top showing the climb, the distance to the summit and the next kilometre's average gradient ("Sommet 7 km / Pente moy. 8.1 %", "Cima 7 km / Pendenza media 8.1 %"). New `src/world/milestones.ts`.
- **Stone parapets.** `Scenery.barrier: 'stone'` (Stelvio, Tourmalet, Ventoux, and the Tour of the Moon) replaces the guardrails with low dry-stone parapets in the same places (`stoneGeometry()` in `barriers.ts`). Low costs the same as before.

### Better trees: species per stage, one style, level of detail, wind sway

- **Nine species in one low-poly style** (`src/world/trees.ts`): spruce, pine, larch, oak, beech (and maple), aspen, cottonwood, juniper (and pinyon) and shrub, replacing the three clashing primitives (cones, blobs, junipers). Per-vertex colour is darker at the bottom and inside of the crown and lighter at the tips; each instance also gets its own brightness, hue and saturation.
- **Species per stage.** New optional `Scenery.trees` (relative weights) on every built-in stage: oaks, cottonwoods and maples on Heartland and Route 66; spruce, larch and beech on the Alpe; spruce, larch and pine on the Stelvio; oak, pine and beech on Ventoux; beech, pine and shrubs on the Tourmalet; beech and spruce on Zoncolan; lodgepole pine, spruce and aspen at Echo Lake; juniper, pinyon and shrubs on the Tour of the Moon. Height decides what fits (oaks low, larches higher), shrubs take over at the tree line, and a route without a mix (an uploaded GPX) derives one from `coniferBias`.
- **Morgul-Bismark is open grassland** (`forestCover` -0.45, fewer lone trees): cottonwoods, ponderosas and shrubs, scattered, with the odd clump, instead of a dense conifer forest.
- **Two levels of detail.** Near trees are 70 to 130 triangles, far ones 28 to 44 with the same silhouette; a tile swaps between them (with hysteresis) at 400 m. Low always draws the far geometry. Triangle counts are in the 3D world guide.
- **Trees sway in the wind** (the shared `sway.ts`): each vertex leans by its height above the base, a crown moves as one, and the shadows sway too. One material for every tile and both levels of detail.
- Tests: `tests/unit/trees.test.ts` (species weights, habitat, tree line, LOD hysteresis, tint, geometry budgets, stage mixes).

### Ground cover beside the road on High and Ultra

- **Grass tufts, wildflowers, stones and sage.** The verges and fields right beside the road (5.6 to 30 m from the centreline, within 90 m of the rider, thickest at the verge) now carry small instanced plants. They follow the ground: green tufts and a few white, yellow and purple wildflowers on grass, straw tufts on dry grass and fields, sparse tufts and pebbles on the dirt verge, stones and tiny alpine flowers on rock, nothing on snow, and sage bushes and red stones in the Tour of the Moon's desert. Plants sway with the wind (`sway.ts`), shade dark at the base to light at the tips, receive shadows and cast none, and shrink to nothing over the last 15 m of range.
- **Per tier.** `SceneryTier.groundCover`: Low and Medium none (the chunk isn't downloaded), High half the density, Ultra all of it. The Auto controller disposes the cover when it steps down to Medium and rebuilds it when it climbs back.
- **Cost.** One lazily loaded chunk (`groundCover`, about 5 kB gzip), four draw calls, about 64,000 triangles at Ultra on Heartland (30,000 on High), cells built nearest first in a few ms of a frame and kept until 114 m away; deterministic from the stage and position. `groundProbe()` in `terrain.ts` gives height and ground layer weights for things stood on the ground. New `tests/unit/groundCover.test.ts`.

### A Bluefy link for iPhone and iPad riders

- Signed-in riders on an iPhone or iPad whose browser has no Web Bluetooth (Safari, Chrome and Edge there are all WebKit) see a small card in the hub's Ride panel with Bluefy's icon, a **Get Bluefy on the App Store** link and a **Copy link** button (the site's address, to paste into Bluefy). It never shows signed out, on other platforms, or inside Bluefy (where `navigator.bluetooth` exists). iPadOS 13+ is detected by its Mac user agent plus touch points.
- New `src/bluefy.ts` (detection and the card), mounted from `src/hub/header.ts`; styles in `src/hub/hub.css`; icon at `public/images/bluefy-icon.png`. Tests: `tests/unit/bluefy.test.ts` and `tests/e2e/bluefy.spec.ts`.

### Ride modes: routes are rides, not races

- **Solo, With pro teams, Race.** A segmented control above the hub's Ride button, with a line of help. **Solo** (the default for everyone): just you, friends riding the route live and your ghost. **With pro teams**: the computer-ridden teams ride along, as before. **Race**: race the pro teams, only on a route with a finish and no workout (it greys out otherwise); the big button then reads **Race**. Race is for one ride and isn't stored; Solo and With pro teams are `settings.proTeams`, synced to the account.
- **Migration.** New `settings.settingsVersion` (2) and `migrateSettings()`: a saved copy without it (this browser's, or the account's on sign-in) is moved to Solo once, since pro teams were on for everyone and rarely a deliberate choice. After that the choice is kept. `DEFAULT_SETTINGS.proTeams` is now `false`.
- **☰ Menu → 🚴 Pro teams: on/off**, in step with the Settings checkbox and the hub. Switching mid-ride doesn't reset the ride: new groups start beyond the drawn road and roll into view (`Peloton.reset(around, offscreen)`); off just stops drawing them. During a race or group ride it reads "Pro teams: racing".
- **Copy.** The hub's Route subtitle is "Pick a road to ride. Race it if you like."; the card's chip is a smaller, quieter **🏁 Race it** shortcut; the Hell of the West tour card still says it is a race series. Settings explains the pro teams switch as the ride mode.
- New `src/rideMode.ts`; tests in `tests/unit/rideMode.test.ts` (migration, mode logic) and `tests/e2e/rideMode.spec.ts` (Solo has no teams, With pro teams, the migration, Race starting a race).

### Sign-in works in Safari

- Neon Auth is now served from our own origin at `/api/auth` (a small pass-through function, `api/auth-proxy.ts`, in production — a plain Vercel rewrite adds `X-Forwarded-Host`, which Neon rejects — and a proxy in `vite.config.ts` for `npm run dev` / `vite preview`), so the session cookie is first-party. Calling Neon's own domain made it a third-party cookie, which Safari (ITP) blocks: riders signed in with Google, Neon created the session, but the app never saw it and stayed on the home page. The service worker no longer touches `/api/` requests. Existing riders sign in once more after this change.

### Graphics: Auto starts on Ultra and steps down when it's jerky

- **Auto starts on Ultra on every device**, phones included. Only a software renderer (SwiftShader, llvmpipe… and the e2e browser) still starts on Low. The device signals (cores, memory, GPU, screen) are kept for logging and that exception only.
- **Auto remembers what worked on this device** (`americanflyers.graphicsAuto`: tier, render scale, timestamps, GPU; per device, not synced). After 30 s of steady riding it keeps the tier and scale it settled on and starts there next time. Every third visit, or after 3 days, it starts one tier above the remembered one to re-test (never more than one up, never above Ultra).
- **It watches for jerky, not just slow.** Over the last 3 s it judges the median frame time, the share of hitches (frames over 2.5× the median or over 50 ms) and stalls over 100 ms: jerky is a median over 22 ms, over 8% hitches, or 3 stalls. Warm-up, tab switches, the hub, open dialogs and loading spikes (a landmark model arriving, a stage change) aren't judged. Three frames in a row over 400 ms count as clearly struggling.
- **Fast and gentle step-downs.** Clearly struggling (median over 40 ms, or over 20% hitches) drops a whole tier at once with a 3 s cool-down; a merely jerky ride takes the old gentle path (render scale 1 → 0.85 → 0.7, then a tier). Stepping back up needs sustained headroom, never goes above the visit's starting tier and keeps the back-off.
- **Auto tells you.** A toast when it changes the tier ("Graphics lowered to High for a smoother ride" / "Graphics raised to Ultra"), at most one per 20 s and none in the first 4 s. Settings → Graphics reads "Auto (now: High)" with a line saying where Auto started and why. Fixed tiers behave as before.
- **Dev parameters:** `?softgpu=off`, `?jank=60` (or `?jank=120/8`), `?settle=3000`. New `tests/e2e/autoGraphics.spec.ts`; `tests/unit/quality.test.ts` covers the start tier, re-test, memory round trip, hitch detection, fast and gentle step-downs, settling and the note throttle.

### Graphics: light, colour, a real sky and haze, and a quality setting per device

- **Graphics setting** (⚙ Settings → Graphics): Auto, Low, Medium, High or Ultra, kept on this device only (`americanflyers.graphics`, not synced). Auto picks a starting tier from the device (software renderers, phones, tablets, integrated and discrete GPUs, cores, memory, screen size), then watches frame times: slow frames lower the render scale (1 → 0.85 → 0.7), then the tier, then shadows; a long calm stretch raises it again, never above the first pick, with cool-downs and growing back-off so it doesn't flap. A fixed tier only moves the render scale. The setting shows what Auto picked. `?graphics=` overrides for a visit, `?adapt=off` freezes adaptation, and `window.__afGraphics` reports the tier, scale and fps. New `world/quality.ts`, `adapt.ts`, `graphics.ts`.
- **Post-processing (Medium and up, lazy chunk).** Bloom that only catches the sun, the Tron neon, headlight pools and glints; a colour grade that follows the light and weather (warm at dawn and dusk, cool and flat in cloud and rain, blue at night, a soft vignette); tone mapping and sRGB in the `OutputPass`; FXAA (SMAA on High and up). High adds half-size ambient occlusion and sky reflections on bikes and riders (a PMREM environment from the sky, rebuilt only when the sky changes), softer shadows and cloud shadows; Ultra a full-size bloom chain and a 4,096 shadow map. Low draws straight to the screen and never downloads the chunk (`post`, `vendor-three-post`). New `world/post.ts`, `grade.ts`.
- **Shadows** no longer shimmer: the shadow box follows the rider in whole shadow-map texels.
- **Sky.** One dome shader with a warm horizon band on the sun's side at low sun, the pink belt opposite it, a forward-scattering halo and a hot sun disc that feeds bloom, and noise clouds a kilometre and a half up, lit from the sun's side, drifting with the wind and thinning into the haze (replacing the 26 clusters of spheres). The far mountains are buried in haze at their feet and clear at the peaks.
- **Haze.** The linear fog is replaced by exponential height fog (denser in valleys, thinner up high) whose colour warms towards the sun and matches the sky's horizon, installed once as shader-chunk overrides so terrain, road, trees, riders and landmarks all get it (`world/fog.ts`). Thicker at dawn, dusk and in rain.
- **Cost.** The entry chunk grew by about 5 kB gzip (the tier choice, the fog and the sky shader) and `vendor-three` by about 2 kB (the reflection prefilter). The frame-time controller is a 1 kB chunk loaded just after the first frame. The post chunk is 49 kB gzip of three addons plus 2 kB of ours, fetched on Medium and up only. Drawn in headless Chromium's software renderer at 800 × 500, a frame costs about 1.0× on Low, 1.2× on Medium, 1.8× on High and 2.3× on Ultra (a relative guide only; real GPUs differ).
- **Tests.** `tests/unit/quality.test.ts` covers tier selection, the controller (warm-up, hysteresis, cool-down, back-off, fixed tiers) and the grade per look.
### Graphics, round 6: terrain textures, a wet road, painted climbs, guardrails and crowds

- **Terrain textures.** The ground's flat vertex colours become texture splatting: seven CC0 layers (grass, dry grass, dirt, rock, snow, red sandstone, sand) blended by the same height, slope and stage logic as before, laid over the stage's own colours so every stage keeps its palette. Rock is triplanar and takes over any steep pixel (no stretched cliffs), a large-scale tint hides tiling, and High and Ultra add detail normal maps. One terrain material, texture arrays with mipmaps and tier-capped anisotropy. Textures (Poly Haven, CC0; see `public/textures/README.md`) are fetched lazily after the first frame, only the layers a stage can show; until they arrive, and if they never do, the plain colours show. Low uses three layers at 512 px and no normals. The old generated `public/textures/grass.jpg` is gone (nothing used it any more).
- **Road.** An asphalt normal map (CC0) with a derived roughness map, painted lines left crisp (Medium and up). In rain the road grows noise-mask puddles, nearly mirror-smooth, flat and darker, that reflect the sky (environment map on High and up; a fresnel horizon colour on Low and Medium).
- **Painted words on the climbs.** ALLEZ, VAS!, GO GO GO, stars, arrows and "ALLEZ <your first name>" over the last 3.4 km and before about a third of the hairpins, the same places every ride (`world/roadPaint.ts`).
- **Guardrails** on the outside of every hairpin and along steep drops, one instanced section (`world/barriers.ts`).
- **Crowds** of instanced low-poly spectators with flags, lining hairpins, summits and the last 700 m, using the same `crowdNear()` as the crowd sound (now in `world/crowdZones.ts`); they jump and wave as you pass (vertex shader). Density, flags and shadows per tier.
- **Per tier.** `TIER_SPECS[tier].scenery` (`world/scenery.ts`).
- **Cost.** Entry chunk +4.7 kB (+1.7 kB gzip); two new lazy chunks, `ground` (9.3 kB, 3.8 gzip) and `roadExtras` (14.2 kB, 6.2 gzip); 1.84 MB of new textures (net +1.71 MB after removing the unused 126 kB `grass.jpg`), fetched on demand (Low fetches about 0.5 MB). In headless Chromium's software renderer (800 × 500, the Alpe summit with crowds and paint) a frame costs about 1.2× the old one on Low, 1.5× on Medium and High and 1.55× on Ultra (Heartland, textures only: 1.2×, 1.3×, 1.5×); a relative guide only, real GPUs differ.
- **Tests.** `tests/unit/roadside.test.ts` (hairpin detection, paint plan, guardrails, crowds, ground-layer weights, tier switches), `tests/e2e/scenery.spec.ts`.

### A third home hero

- **The home page hero now rotates through three heroes** in a fixed order: the pit bull chase (`dog`), the cyclist glancing back at the pit bull (`look`, new: `public/images/hero-look*.jpg` and `hero-look*.mp4`), then the original rider (`rider`), crossfading every 10 seconds. Each visit starts on the next hero in that order (the last start is kept in `americanflyers.hero`; an unknown value starts on the pit bull chase). A hero's still and clip are only fetched about 5 seconds before it is shown, and a slide is reused on later laps. `?hero=look` pins the new one, like `?hero=dog` and `?hero=rider`. Reduced motion and data saver still get the still image only, cycling through the three per visit.

### An account is required: no more guest riding

- **The home page is the only way in without an account.** *Ride without an account* is gone, and so is everything else that left the home page for the hub or the ride with no account (the Escape key, the brand button for a guest). Sign in with Google, or sign up with email; it's free. The home page copy now reads *Free: no subscription, no card. A free account saves your rides, plans and progress.*
- **Signed-in riders open on the hub, as before** (the `americanflyers.signedIn` hint skips the home page). If the session check then finds no account, the hint is cleared and the home page shows. Signing out (or the account disappearing) closes the hub and the ride and shows the home page; the profile's *Sign out* saves a ride under way first.
- **No guest hub.** The guest rider card, the sign-in prompts in the Achievements, Stats and Garage sections, and *Sign in to join* on events are removed; the hub's types and logic lost their guest state (`IdentityState` is `pending` or `in`; `signedIn()` and `openSignIn` are gone from the hub's context and deps).
- **Guest leftovers removed.** The finish card's *Sign in to save this ride* note and the pending guest ride are gone. An old `americanflyers.pendingRide` left in the browser is still saved once at sign-in and then deleted, so no ride is lost. The offline ride queue (for signed-in riders) is unchanged.
- **Unchanged:** settings, workouts and routes made on this device before accounts were required still sync to the account at first sign-in (`syncOnSignIn`). The demo ride stays, for signed-in riders.
- **Privacy text** no longer says riding without an account keeps settings only in the browser; it says an account is needed to ride.
- **Tests.** The smoke test, devices and AI tests ride as a signed-in rider; new `tests/e2e/home.spec.ts` covers the no-account home page, a stale hint, sign-out and the old-ride and old-workout migrations; `tests/unit/home.test.ts` covers the hint.

### Rides saved while offline

- If a signed-in rider's ride can't be saved (no connection, or the server doesn't answer), it's kept on the device and uploads by itself when the connection comes back, at sign-in, when the tab is shown again, and every two minutes while any are waiting. The finish card (or a toast, once per ride) says "Saved on this device". Saving is an upsert by the ride's id, so a retry never duplicates a ride. Up to 20 rides are kept per device; a long ride that won't fit in the browser's storage is kept without its 1-second samples. A ride that keeps failing while online is given up after 12 tries, with a message. New module `src/rideQueue.ts`; tests in `tests/unit/rideQueue.test.ts` and `tests/e2e/offline.spec.ts`.

### Faster loading: a much smaller first download

- **Code splitting.** The first visit now downloads only the entry chunk and `vendor-three`; the Neon SDK, the Sentry SDK and every dialog that isn't on screen at the start load on first use (workouts, garage and store with its 3D turntable, share card, sign-in, profile and admin, tour, events, leaderboard, plans, kit, time and weather, first-ride guide, privacy text, race screens, commentator, email sign-up form, GPX import). A button whose code is still arriving pulses; a failed load shows a toast and the next click tries again. After the first frame the likely next dialogs are fetched one at a time in spare moments (not on data saver or 2G). See "Lazy loading" in the architecture guide for how to add a lazy module (`src/lazy.ts`).
- **Vendor chunks.** `three`, the Neon libraries and Sentry are separate long-cached files (`vite.config.ts`).
- **Neon loads on demand.** `src/cloud/client.ts` exports a recording proxy with the same call syntax as the SDK; the SDK loads after the first frame (sign-in is restored then) or at the first database call. Sign-in restore therefore starts a moment later than before.
- **Sentry loads after the first frame.** Crashes before then are kept and sent once it is up. Sentry's automatic page-load timing now starts later, so page-load traces are less accurate.
- **Landmark models load when needed.** Each of the nine `.glb` files (7.5 MB together) is fetched when a landmark that uses it first comes within range, instead of all at start-up.
- **Home page.** The hero videos start after the first frame; the email form's code loads when *Sign up with email* is first tapped.
- **Fonts.** The Google Fonts stylesheet is preloaded but no longer blocks the first paint (text shows in the fallback font until it arrives, as `display=swap` already did).
- **AI coach and rivals load on demand.** The AI client (`src/ai/*`, `src/cloud/aiApi.ts`) was in the entry chunk (117 kB gzip, up from 102 kB); it is now its own chunk, loaded when a rider who opted in starts a ride, when a rival is chosen or the Rivals dialog opens, when the AI switches are saved, or when a ride summary needs the coach's card. The Rivals dialog and the AI part of Settings load on first open and are prefetched when idle. Until the controller has loaded its hooks do nothing, and rival lines and the coach's built-in tips work with the AI off as before. Entry chunk now about 105 kB gzip. Settings opens a moment after the click on a first visit if the consent module hasn't arrived (the AI switches stay off until it has).
- **Fixed:** `main.ts` registered the service worker and the install-button handlers again on every animation frame (a copy of that block had ended up inside `frame()`); the copy is removed.
### Trainer in the menu, and devices that are remembered

- **Trainer and heart rate in the ☰ Menu.** 🔌 Connect trainer / Disconnect *name* and ❤️ Heart rate / Disconnect *name*, with a status line under each; the top-bar button stays. The menu now scrolls on short screens.
- **Remembered devices.** The trainer and strap you connect are remembered in this browser (`americanflyers.devices`, not synced). In Chrome with persistent Bluetooth permissions (`getDevices`, behind a flag today) they reconnect on load with no chooser; elsewhere a banner and menu item give a one-tap **Reconnect *name*** through a name-filtered chooser. **Forget** per device in the menu and in Settings.
- **Automatic reconnection.** A remembered device that drops mid-ride is retried after 1, 2, 4, 8 and 15 s; the ride carries on (power reads 0), notifications are re-subscribed and the current resistance is sent again. New modules `src/ble/remembered.ts`, `src/devicesUi.ts`; `connectTrainer`/`connectHeartRate` are split into request and open steps.
### The hub: a screen before you ride

- **A hub comes first.** Signing in leads to it, signed-in riders open on it every time (no more dropping straight onto the bike), and guests reach it with *Ride without an account*. Sign-in, hub, ride. The home page's first paint is skipped for signed-in riders (a hint set in `index.html`).
- **Header.** Name, level and title, an XP bar and credits (from the garage wallet), a big **Ride** button for what is chosen (with its elevation profile or workout chart), **Free ride** (endless Heartland Rollers), and the training plan's next session with **Ride it**. On phones a bottom bar keeps **Ride** in reach.
- **Seven sections** (tabs on a computer, one scrolling column on a phone): **Route** (every stage and climb, plus uploaded GPX routes, with profile thumbnails, length, climbing, your best time, a Race button, the tour), **Training** (the Ramp FTP test, your workouts, the built-ins, with block charts, and Create), **Plan** (progress, the next session with *Ride it*, or pick a plan), **Achievements** (earned badges and the next to go), **Garage** (a turntable of your bike, level, credits, what you wear, this week's challenges), **Stats** (this week and the last four weeks, FTP and its history, eight weeks of distance, your last rides) and **Events** (the next race and group ride with a live countdown and *Join*). Detail views are the existing dialogs, opened over the hub; a ride row opens that ride in the profile.
- **What Ride starts.** Picking a route clears any workout; picking a workout rides it on an endless stage (your chosen one if it has no finish line, otherwise Heartland Rollers). The last stage started from the hub is remembered.
- **Back to the hub.** ☰ Menu → 🏠 Hub, the brand button, and a *Back to the hub* button on every finish and summary card. A ride of a minute or more, a race or a group ride asks first: *Keep riding*, or *Save and go to the hub*.
- **The look.** The live world circles your rider behind the blur (one frame a second on phones and with reduced motion), in the home page's type and navy glass, with the red-white-blue stripe; bigger on TVs (as the ride screens are) and a two-across grid on phones.
- **Fast.** Placeholders paint first, then last visit's cached wallet and ride summary (`americanflyers.hub`), then the account's. Every section and the turntable are loaded when first shown (`import()`), canvases draw only when visible, and nothing jumps when data arrives.
- **Accessible.** Tab order, Enter on cards (the whole card is one button with `aria-pressed`), arrow keys on the section tabs, visible focus, announcements when a choice is made, and Escape brings you back to *Ride* instead of stranding you.
- New modules in `src/hub/` (`hub.ts`, `header.ts`, `data.ts`, `accountData.ts`, `cache.ts`, `dom.ts`, `leave.ts`, `types.ts`, `hub.css`, `sections/`). Small edits to `main.ts` (the start flow, `goToHub()`, the hub's frame), `home.ts` (leads to the hub), `index.html`, `world/world.ts` (`setOrbit()`), `cloud/ui.ts` (`openProfile(tab, rideId)`) and `workouts/ui.ts`. Unit tests in `tests/unit/hub.test.ts`; the smoke test now goes through the hub, and `tests/e2e/mockNeon.ts` provides a signed-in rider.
### AI coach and AI rivals

- **Coach Marty (opt-in).** ⚙ Settings → AI coach. A ride plan at the start (tips tied to climbs, sprints, summits or workout steps), at most one reactive tip every 5 minutes (slow cadence on a climb, heart-rate drift, over the ERG target, close behind a rider without the draft), and a debrief on the ride summary (headline, summary, two went-well, two work-on, a suggested next session from the built-in workouts and stages with a Load it button). Debriefs are kept with the ride and show in the profile. Optional spoken tips.
- **Four AI rivals (opt-in memory).** ☰ Menu → 🤺 Rivals: Kit Blaze (showboat sprinter), Sasha Frost (cold climber), Gus Fenwick (crafty veteran) and Tess Wattson (data-obsessed time triallist). Each rides as a bot at about your pace with a style of attack, with a name tag, a speech bubble and a toast. With AI rivals on they write fresh opening and closing lines and remember your head-to-head record and a few notes (forget any time). Demo and sped-up rides do not count. Works with ready-made lines when the AI is off.
- **One Vercel function** `api/ai.ts` (new dependencies `@anthropic-ai/sdk`, `zod`; `vercel.json`). The rider's Neon token is passed to the database function `ai_claim()`, which checks opt-in, ban and the daily quota. Model `claude-opus-5-5` (override with `AI_MODEL`) at low effort, structured output, refusal fallback, prompt caching. See `docs/developer-guide/ai.md`.
- **Database.** New tables `ai_consent`, `ai_usage`, `rival_memory`, `coach_notes` and functions `my_ai_consent`, `set_ai_consent`, `ai_claim`, `rival_record`, `my_rivals`, `forget_rival`, `save_coach_debrief`, `my_coach_debrief` (see `db/schema.sql`). Privacy page lists Anthropic as a processor for opted-in riders.
- **Tests.** Unit tests for the moments, plan, triggers, rival bot, sanitizers, canned text, prompts and the handler (no network), and a Playwright spec with `/api/ai` mocked.

### Trust and safety: privacy, account deletion, email verification, leaderboard sanity

- **Privacy page.** ☰ Menu → 🔒 Privacy (also linked from the sign-in dialog, the home page small print and the profile) says in plain English what is collected, what other riders see, where it is kept and for how long, and how to delete it. It is a draft for the site owner to review, not legal advice (`src/privacyUi.ts`).
- **Delete my account.** Profile → 🔒 Privacy & data. Type `DELETE` to confirm; the database function `delete_my_account()` removes the rider's rows from every table with a `user_id` (profile, rides, workouts, routes, FTP history, feedback, live position, ride-ons in both directions, and tables added later) and then the Neon Auth user, whose sessions and linked accounts go with it. The rider is signed out, this browser's saved data is cleared, and a goodbye message shows. Admin accounts are refused with a clear message.
- **Download my data.** The same tab saves a JSON file of everything stored about the rider (`my_data_extras()` supplies the parts the app can't read directly).
- **Email verification (prepared, switched off).** After email sign-up, if Neon Auth holds the session back until the address is verified, a 6-digit code step appears (resend with a 30 s timer), then the rider is signed in. Unverified accounts that try to sign in get the same step. Unverified accounts also see a gentle banner at the top of their profile with "Email me a code". With verification off nothing changes. See the admin guide for the Neon Auth settings. New modules `src/cloud/verification.ts`, `codeEntry.ts`, `verifyBanner.ts`.
- **Leaderboard sanity.** New table `public.stage_limits` (fastest believable time and top speed per built-in stage) and function `ride_is_plausible()`. `stage_leaderboard()` and `stage_ghost()` (same signatures and columns) now ignore rides faster than the floor, rides averaging over 2000 W, rides with no power data that are also suspiciously fast, and rides flagged `activities.demo`.
- **Demo and sped-up rides stay off the leaderboards.** A ride that used the demo power slider or `?timescale` is saved with `demo = true` and no `finish_s`, and the finish card says so (`src/rideIntegrity.ts`).
### Scheduled group rides and races, and the race commentator

- **Events.** ☰ Menu → 🗓 Events lists a race every evening (19:30 UTC, rotating through nine stages) and a 2.6 W/kg group ride at midday (12:30 UTC, Heartland Rollers), plus one-off events admins add, with countdowns, **Join** (open from an hour before) and the results of finished races. The database creates the daily schedule on demand (`upcoming_events()`), so there is always something on; `server_now()` lets every browser line up its clock.
- **Synchronised start.** Joining puts you on the line in a lobby bar with the number of other riders there. Riders in an event see only each other (presence under the stage key `<stage>#event-<id>`). The 3-2-1 starts together by the server's clock. In a race the computer-ridden field comes from the event's seed, a fixed 3.4 W/kg and fixed 0.25 s slices, so everyone races the same bots; a group ride is one steady pace group that tells you gently when you have been dropped (more than 100 m behind).
- **Results.** `submit_event_result()` stores one time per rider per event, checked against the start time and sanity limits; `event_results()` lists the real riders. The finish card merges real riders and the computer field by time and keeps looking for finishers. Demo and `?timescale` rides send no result.
- **Admin.** The Admin tab can add and remove one-off events (`admin_create_event()`, `admin_delete_event()`, both check `is_admin()`).
- **Race commentator.** Voice lines for the start, attacks, the break forming and being caught, the gap, intermediate sprints, summits, halfway, the last kilometre, the sprint, and about you (attack, lead, dropped and back, yellow jersey, finish). Rate-limited so it never talks over itself; ride sounds dip while it speaks. 39 clips in `public/audio/commentary/`, generated with Higgsfield. New setting **Race commentary** (on by default, needs sound on).
- New modules `src/schedule.ts`, `src/eventSession.ts`, `src/eventsUi.ts`, `src/commentary.ts`, `src/cloud/events.ts`; additive changes to `race.ts` (`useEventClock()`, `leadPos`), `peloton.ts` (`startGroupRide()`), `sound.ts` (`duck()`). Unit tests for the schedule, the commentary rate limits, the drop watcher, result merging and bot determinism.
### Garage, credits, levels, challenges and the share card

- **Credits and levels** from saved rides, counted on the server (`my_wallet()`): 1 credit per km and per 10 m climbed, 5 XP per km and 0.5 XP per metre, levels 1 to 50. Demo and sped-up rides are ignored. A high-water mark of km and climbing (`rider_progress`) keeps unlocks when rides are deleted.
- **Bike store** (☰ Menu → 🚲 Garage & store): frames (classic, aero, climbing, time-trial, Tron), wheels (35 mm alloy, 50 mm carbon, 80 mm deep, light climbing, disc for the time-trial bike), tyres, helmets, jersey designs and socks, with prices, level requirements and a live turntable. Each item states its effect in watts and seconds from the ride's physics. `buy_item()` checks level, unlock rule and balance.
- **Equipment effects** change mass, drag area and rolling resistance in one marked place in `main.ts` (modest: -2.5% to -5% drag for frames, -0.8 kg to +0.4 kg weight, -0.0005 rolling resistance).
- **The Tron bike**, unlocked by 8,848 m of total climbing and claimed automatically: neon edges, light-ribbon wheels, a ground glow, a gentle pulse, brighter at night. Other bikes look different too (deep rims, a solid disc, aero tubes, a time-trial bike with tri-bars and a tucked rider).
- **Clothing**: stripes, hoops, chevrons, stars, polka dots and a skinsuit, drawn by the rider shader from pre-skinning positions; black and aero helmets; coloured socks.
- **Others see your bike and clothes**: the kit string gains optional `;f=tron;w=deep80…` parts (validated by `ride_presence()`, same signature).
- **Weekly challenges** (`my_challenges()`, `claim_challenge()`): four per ISO week, claimed once for credits. New columns `activities.race_place`, `race_size`, `pro_m`.
- **Share card**: a 1080 x 1350 picture of a ride from the finish card and from profile rides, shared with the Web Share API or saved as a PNG.
- New setting `loadout`. New modules in `src/garage/`, `src/world/bikeParts.ts`. Unit tests in `tests/unit/garage.test.ts` and `challenges.test.ts`.

### Joining it up

- Garage equipment and the road's wind go into the same physics step, and aero kit also trims the wind resistance sent to a smart trainer (with the draft).
- Jumping along the route in a demo ride is off during scheduled events as well as races and workouts.
- The DELETE confirmation box and the Events dialog's "Opens an hour before" status are styled to match the rest of the app.

## Before pull request #1

### Initial commit (2026-10-30)

- `b8def0b`: an initial README stub, committed directly to `main`.

## Pull request #1: the 3D indoor cycling app (merged 2026-10-31)

Merge commit `ffcf874`. American Flyers: 3D indoor cycling app with Bluetooth trainer support.

- **First app.** A browser app that connects to a Wahoo or any FTMS smart trainer over Web Bluetooth, and rides a virtual bike along a rolling road. Includes FTMS connection with grade control, a Cycling Power fallback, an optional heart-rate strap, a power-to-speed model with gravity, rolling resistance and drag, a HUD with power zones, ride stats and an elevation strip, demo ride mode, and metric and imperial units.
- **3D world.** Rebuilt the ride scene in Three.js: a winding road from a cached centerline, procedural terrain tiles with forests, a road surface with lane markings and distance posts, a 3D bike and rider with IK legs, a sky dome with clouds and a mountain ring, sun shadows, haze, ACES tone mapping, and chase, side and rider camera views (button or **C** key). `?start=<km>` begins a ride partway along.
- **Landmarks.** GLB landmarks loaded from `public/models/` and placed beside the road. A start and finish gantry spans the road, and missing model files are skipped. Trees keep clear of landmark sites.
- **Generated models and textures.** Barn, diner, farmhouse, windmill, water tower, gas station, silos, covered bridge and rigged rider models, plus asphalt and grass textures, were generated with Higgsfield.
- **Stages.** A stage picker with profile thumbnails and `?stage=`. Heartland Rollers (endless), Route 66 Flats (25 km time-trial), and Alpe d'Huez (14 km, 1,118 m, per-kilometer gradients from swi-cycling.com, 21 numbered hairpins). Finite stages count down, show the next hairpin, and end with a finish screen.
- **Stelvio Pass.** A general mountain-climb builder, now used by Alpe d'Huez. Stelvio Pass from Prato: 24.5 km, 1,824 m, 48 numbered hairpins, with a painted checkered finish line.
- **Per-stage scenery.** Terrain, rock, snow and tree lines, forest cover and mountain height are set per stage. Steep slopes shade darker, and turn to rock.
- **Rider.** A rigged rider posed by inverse kinematics each frame, with the back, head and hands set for a riding position. Falls back to a built-in rider if the model is missing.

Pull request #1 also added a GitHub Pages deploy workflow, since removed in favor of Vercel.

## Pull request #2: workouts, data blocks, GPX routes and project memory (merged 2026-10-31)

Merge commit `a61d411`. Workouts, data blocks, GPX routes, and project memory.

- **Data blocks.** 24 selectable fields (power, W/kg, normalized power, max power, workout target and time left, cadence, speed, heart rate, distance, to go, grade, climbing, energy, TSS), chosen and ordered in a dialog, with the first shown large. Saved in settings.
- **Workouts.** A library of built-ins (Endurance, Sweet Spot, VO2 max, Over-Unders, Ramp FTP test), uploaded files, and created workouts, saved in browser storage. Imports Zwift `.zwo` and `.erg`/`.mrc` files, and exports `.zwo`.
- **ERG mode.** Uses the FTMS set-target-power command. Grade simulation resumes after a workout.
- **In-ride panel.** Target, step time left, next step, pause, skip, and ±5% intensity. A workout graph with the power trace replaces the elevation strip.
- **Summaries.** Average and normalized power, TSS and kJ at the end. The ramp test estimates FTP.
- **Workout creator.** Steady, ramp, interval and free-ride blocks, a live preview, TSS, watts at the rider's FTP, and save, save-and-ride, and `.zwo` export.
- **Statistics fix.** Ride statistics use exact elapsed time. They had been about 9% low at 10 Hz.
- **GPX routes.** Upload `.gpx` files from the stage picker. Routes are saved in browser storage and listed under *Your routes*. The road follows the smoothed bends, with elevation smoothed over about 80 m and gradients capped at 25%. Scenery scales to the route, and files without elevation ride flat.
- **Project memory.** `CLAUDE.md` records the Haiku preference for repository work, build commands and the Vercel deployment.

## Pull request #3: accounts, profiles, achievements and the admin dashboard (merged 2026-10-31)

Merge commit `bfd10f5`. Accounts, profiles, achievements, HR zones, feedback and admin dashboard.

- **Accounts.** Sign in with Google or Apple through Neon Auth. Settings, workouts and routes sync to the account.
- **Rides.** Saved automatically when a stage or workout finishes, on Reset, and every 5 minutes on long rides. Each ride keeps 1-second samples, best efforts, and time in heart-rate and power zones.
- **Profile.** Stats (totals, personal bests, distance per week, FTP progress, zone totals), achievements, and a ride list with graphs, zones and `.tcx` export.
- **Zones.** Heart-rate and power zone breakdowns after every ride, with a max HR setting.
- **FTP history.** Recorded on every change: by hand, from a ramp test, or at sign-up.
- **Feedback.** Ideas and bug reports, with status and replies.
- **Admin dashboard.** Riders, activity, signups and rides per day, top stages and workouts, ban and unban, and the feedback inbox.
- **Schema.** `db/schema.sql` added.

## Pull request #4: admin check fix (merged 2026-10-31)

- **Admin button.** The admin check now retries while the session settles after returning from Google, so admins reliably see 🛠 Admin.

## Pull request #5: realistic pedalling, home page and a visual refresh (merged 2026-10-31)

- **Virtual drivetrain.** Leg speed now follows road speed through real gearing (50/34 × 11–34) with automatic shifting, slow heavy strokes on a standing start, freewheeling, and a bike rock that grows with pedal force.
- **Home page.** A welcome screen with a cyclist hero (still and looping video made with Higgsfield) and free sign-in.
- **Visual refresh.** Sharper buttons, fields, sliders and dialogs.

## Pull request #6: documentation library (merged 2026-10-31)

- The `docs/` library: user, admin and developer guides, and reference pages.

## Pull request #7: headline, deploys and the Stelvio (merged 2026-10-31)

- Home headline: *Welcome to the free American Flyers Training Program*.
- Removed the GitHub Pages workflow; Vercel is the only deploy target.
- Stelvio Pass climbs to 2,758 m.

## Pull request #8: ride together, new climbs, and much more (merged 2026-10-31)

- **Riding together.** Signed-in riders on the same stage see each other on the road with name tags; 👥 *Riding now* list with gaps and *Ride with*.
- **New stages.** Hell of the West (the film's final stage, Idaho Springs to Echo Lake), Mont Ventoux, Col du Tourmalet, Monte Zoncolan.
- **Leaderboards and ghosts.** Weekly and all-time leaderboards from whole-stage rides (`activities.finish_s`); race your best or any leaderboard ride as a ghost.
- **Sound.** Wind, tyre hum, freewheel, crowds, interval beeps and a finish fanfare.
- **Virtual shifting.** 24 gears with on-screen and keyboard shifting; the gear changes the trainer's resistance.
- **Training plans.** Get Started, FTP Builder and Hell of the West, with five new built-in workouts.
- **First-ride setup**, **installable app** (manifest, service worker, icons), full screen and bigger numbers on TVs.
- **Tidier screen.** A ☰ Menu for everything but Stage, Workouts, 👥, Connect trainer and the account; data blocks across the top or in a column on the left or right.
- **Rider.** Shoes sit level instead of pointing up, with a little ankling.

## Pull request #9: home page copy (merged 2026-10-31)

- The home page leads with the Hell of the West, riding together, leaderboards and ghosts, and training plans.

## Pull request #10: email sign-up, drafting, pit bull hero, docs (merged 2026-10-31)

- **Email sign-up and sign-in.** Create an account with a rider name, email, password, weight and optional FTP; no phone number or address. Sign in, and reset a forgotten password by email. Sign in with Apple removed.
- **Drafting.** Riding behind another rider cuts your air drag by up to about a third (and lightens a smart trainer); a slipstream gauge shows the gap to the rider ahead, the drag saved and the watts it saves.
- **Second home hero.** A looping pit bull chase, taking turns with the original rider hero.
- **Docs.** Every guide updated for the latest features, and the languages and technologies listed in [Architecture](../developer-guide/architecture.md#languages-and-technologies).

## Pull request #11: Sentry and the pit bull hero (merged 2026-10-31)

- **Sentry error reporting** with `@sentry/browser`, on when the build has a DSN.
- The home page shows the pit bull hero on every visit (`?hero=rider` for the original).

## Pull request #12: pro teams (merged 2026-10-31)

- **Pro teams**: five computer-ridden teams with comedic near-miss names ride each stage two by two at 2.0–4.2 W/kg, in their own kit, with **Join** in 👥.

## Pull request #13: bigger draft behind a group (merged 2026-10-31)

- The draft counts the whole group ahead: up to about 54% on the back of a pro team, against 36% on one wheel.

## Pull request #14: steering, weather, the Hell of the West tour, racing, ride-ons and kits (merged 2026-10-31)

- **Steering**: steer across the road with **←** / **→** (or on-screen ◀ ▶ buttons on touch screens); the bike eases across over about 0.8 s and the cameras follow. **Auto-steer** (Settings, on by default) eases you onto the wheel of a rider just ahead if you haven't steered for 3 s. The draft is now lateral: full on their line, fading to nothing about 1.1 m across, and the draft gauge says which way to move when you're behind but off their line.
- **Time of day and weather** (☰ Menu → 🌤 Time & weather): Auto, dawn, day, dusk and night; Auto, clear, cloudy and rain. Night has a moon, stars and a front-light pool on the road; rain adds streaks, a wet glossy road, thicker fog and a soft rain sound. On Auto the stage sets the start (Route 66 and Hell of the West at dusk, Tourmalet cloudy), the light moves on about an hour per two minutes of riding, and the weather changes now and then. New module `src/world/atmosphere.ts` (and `rain.ts`).
- **Ride-ons**: send 👍 🔥 💪 👋 to a rider from 👥 or press **R** for the rider ahead; received ones show as a message and an emoji floating over the sender. Pro team riders sometimes reply. New table `ride_ons` and functions `send_ride_on()` and `my_ride_ons()`.
- **My kit** (☰ Menu → 🎨): jersey, second colour and bike frame, with presets, saved in `settings.kit`. Other riders see your kit: `ride_presence()` takes an optional `p_kit` (the old six-argument call still works) and `live_riders` has a `kit` column. `setTourJersey()` in `src/kit.ts` lays a tour jersey over your kit.
- **Hell of the West tour.** Two new stages from the film: Stage 1 *Morgul-Bismark* (two laps of the Boulder circuit, up The Wall) and Stage 2 *Tour of the Moon* (Rim Rock Drive, Colorado National Monument, with red rock desert scenery: `Scenery.palette = 'desert'`). The existing stage is now *Hell of the West · Stage 3: Echo Lake* (same id). **☰ Menu → 🏆 Hell of the West tour** races the three in order, with stage results and the general, points and mountains classifications (yellow, green and polka-dot jerseys), saved in `settings.tour`. Stages can be simulated. On a tour stage, lead a classification and your rider wears its jersey colours over your kit (`tourJersey()` → `setTourJersey()`).
- **Racing.** **🏁 Race this stage** on any stage with a finish: 12 pro teams of three riders on the start line, a 3-2-1 countdown, attacks on the climbs, an early breakaway, chases, cracks, merging groups and a sprint in the last 400 m, scaled to your FTP. A live race panel (position, gap, groups, next sprint or summit, jerseys) and results tables (top 20 and you). Same engine for "simulate this stage". `?timescale=` runs the clock faster for testing.

## Pull request #15: tests and CI, wind and echelons, mini-map and climb preview (merged 2026-11-01)

- **Automated tests and CI**: Vitest unit tests in `tests/unit/` (physics, drafting, drivetrain, stages, workouts and `.zwo` round trip, plans, GPX, ghosts, the race engine and the tour), a Playwright smoke test in `tests/e2e/` (loads the built app with Neon mocked, starts a demo ride, opens each main dialog, fails on page errors), `npm test` and `npm run test:e2e`, and a GitHub Actions workflow (`.github/workflows/ci.yml`) that builds and runs both on every pull request and push to `main`.
- **Wind.** Each stage has a prevailing wind (speed and direction) that the weather scales: light on clear days, stronger under cloud and strongest in rain, with gusts and a slow swing in direction. Drag now works on air speed (road speed plus headwind), so headwinds slow you, tailwinds help, and the pro teams and race field feel it too. A smart trainer is sent the headwind in its simulation parameters. Clouds drift with the wind and rain slants with it. A wind chip in the status bar shows an arrow (up is the way you ride), the speed and "Headwind", "Tailwind" or "Crosswind from the left". New setting **Wind** (on by default). `?wind=<m/s>,<degrees>` forces the wind for testing. New module `src/world/wind.ts`; `stepSpeed()` and `Trainer.setGrade()` gained optional headwind arguments.
- **Echelons.** In a crosswind the sheltered spot behind a rider moves to their downwind side (about 0.25 m per m/s of crosswind, up to 0.8 m). `draftFrom()` takes an optional `shift` in its `lateral` argument, auto-steer and the draft gauge's hint use it, and live riders line up on the diagonal. The pro teams (free ride, `peloton.ts`) and the race field (`raceSim.ts`, new optional `wind` option) form diagonal echelons.
- **Mini-map.** A round mini-map of the route (from the course centreline) with you, live riders, pro teams, the ghost, the finish and, in a race, sprint and summit markers. Click it to switch between the whole route (north up) and the road ahead (heading up). Redraws about 5 times a second. New settings switch **Mini-map and climb preview**, also in ☰ Menu.
- **Climb preview.** When a climb (over 3% for more than 500 m) starts within 2 km, a card shows its length, average and steepest grade and a coloured profile; on the climb it shows the distance to the top and the average grade still to come. New modules `src/climb.ts`, `src/climbUi.ts`, `src/miniMap.ts`, `src/windUi.ts`.

## Pull request #16: rotating home hero (merged 2026-11-01)

- The home page hero rotates between the pit bull chase and the original rider, crossfading every 10 seconds while the home page is open, and starts on the other one each visit. The second hero is only downloaded once the first has been up for a few seconds. Riders who prefer reduced motion or have data saver on get the still image, alternating per visit. `?hero=dog` or `?hero=rider` pins one.

## Pull request #17: steadier rider, freewheel sound, jump along the route (merged 2026-11-01)

- **Less wobble.** The bike's side-to-side rock with each pedal stroke is now at most about 1° (it was up to 3.4° on climbs and at low cadence), for you and the other riders. `MAX_ROCK` in `src/drivetrain.ts`.
- **Freewheel sound.** Rebuilt from a square-wave beep into a synthesised hub ratchet (`src/freewheel.ts`): a pre-rendered metallic pawl tick (six variants) played at the real ratchet rate, 36 engagement points × how much faster the wheel turns than the cassette. Coasting at 30 km/h that's about 140 ticks a second, a buzz that builds as the cranks spin down and slows to clicks as you stop. Ticks are scheduled ahead on the audio clock so the rate stays accurate at any frame rate.
- **Jump along the route (demo rides).** Click or tap the elevation profile to go to that point. It doesn't count as distance or climbing, and moves the ride's start, so no leaderboard time. Off during races and workouts.

## Full commit list

For reference, every commit on `origin/main` up to pull request #3, in order. For later commits, run `git log --oneline origin/main`.

| Commit | Date | Subject |
| --- | --- | --- |
| `b8def0b` | 2026-10-30 | Initial commit |
| `8553834` | 2026-10-30 | Add American Flyers indoor cycling app |
| `a176b1b` | 2026-10-30 | Rebuild the ride scene in 3D with Three.js |
| `0b94d25` | 2026-10-30 | Add GLB landmark support and fix negative first-frame time step |
| `67d08ee` | 2026-10-31 | Add barn and diner landmark models |
| `7eec181` | 2026-10-31 | Add water tower landmark model |
| `2e04ba5` | 2026-10-31 | Add farmhouse, windmill and start/finish arch models; tune placement |
| `6c90554` | 2026-10-31 | Use generated asphalt and grass textures |
| `5f4a7df` | 2026-10-31 | Add gas station, silos and ride-through covered bridge landmark slots |
| `dc66507` | 2026-10-31 | Add gas station, silos, covered bridge and rigged rider models |
| `043fd5a` | 2026-10-31 | Add stages, including a real-gradient Alpe d'Huez, and a rigged 3D rider |
| `08d075d` | 2026-10-31 | Add Stelvio Pass, a painted finish line, and a 40-degree riding position |
| `ffcf874` | 2026-10-31 | Merge pull request #1 from Hodgy007/claude/virtual-bike-app |
| `3cc34d2` | 2026-10-31 | Add CLAUDE.md with project memory |
| `a179cda` | 2026-10-31 | Add selectable data blocks, workouts with ERG mode, and a workout creator |
| `a8c29e3` | 2026-10-31 | Add GPX route upload for practising real rides |
| `a61d411` | 2026-10-31 | Merge pull request #2 from Hodgy007/claude/virtual-bike-app |
| `c884260` | 2026-10-31 | Add accounts, profiles, achievements, HR zones, feedback and admin dashboard |
| `bfd10f5` | 2026-10-31 | Merge pull request #3 from Hodgy007/claude/virtual-bike-app |
