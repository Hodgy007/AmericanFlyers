# 3D world

This page covers the Three.js setup in `src/world/`: the renderer and lights, the cameras, the terrain tiles, the road, the rider rig, the sky, the landmarks (GLB models and monuments built in code), and how to add one.

Source: [`src/world/`](../../src/world/).

## Renderer and lights

`World` in [`src/world/world.ts`](../../src/world/world.ts) creates the renderer:

- `WebGLRenderer` with a high-performance preference. The canvas is multisampled only when the tier can end up drawing straight to the screen (Auto or Low) and the GPU is not a software renderer (where it is very slow); Medium and up anti-alias in the post chain. A throwaway WebGL context (`probeSignals()`) reads the GPU's name first. (Choosing Low after starting on a fixed Medium or higher therefore has no multisampling until the next load.)
- Pixel ratio, shadow map size and blur, and everything in [Graphics tiers and post-processing](#graphics-tiers-and-post-processing) come from the graphics tier (`src/world/graphics.ts`).
- Shadows use `PCFShadowMap` (five rotated hardware-filtered taps; three r187 has no separate soft type, so softness is `shadow.radius`).
- ACES filmic tone mapping, with exposure 1.05 by day (the atmosphere changes it with the light). With post-processing the `OutputPass` applies it instead of the renderer. AgX was tried and looked washed out beside ACES, so ACES stays.

Lighting:

- A **hemisphere light** (sky blue above, green-brown below, intensity 1.1). On High and Ultra the sky itself lights things (see image-based lighting below) and this is turned down to 0.4× by day, kept in full at night.
- A **directional sun** (`#fff4e0`, intensity 2.6). Its shadow map is 1,024 to 4,096 px (by tier) and covers a 60 m box (76 m on Ultra) centred on the rider. Each frame `Graphics.fitShadow()` moves the box to the rider **snapped to whole shadow-map texels in light space**, so the shadow edges don't shimmer as you ride.

The distance fades into **height fog** (see [Haze and height fog](#haze-and-height-fog)). The hemisphere light, sun, fog and exposure above are the clear-day values; at other times of day and in other weather they are set by the atmosphere (see below).

## Graphics tiers and post-processing

Everything that costs GPU time hangs off one setting, **Graphics**: Auto, Low, Medium, High or Ultra. It is kept per device in `localStorage` (`americanflyers.graphics`), not in the synced `Settings`, and `?graphics=low|medium|high|ultra|auto` overrides it for one visit.

| File | What it holds |
| --- | --- |
| [`quality.ts`](../../src/world/quality.ts) | The tiers and `TIER_SPECS` (what each switches on), the render scales, the saved choice, where Auto starts (`pickAutoStart`), its per-device memory and the note throttle. Pure. |
| [`adapt.ts`](../../src/world/adapt.ts) | `Adapter` and `judge()`, the frame-time controller (jerkiness, fast and gentle step-downs, settling). Pure; its own small chunk, loaded just after the first frame. |
| [`graphics.ts`](../../src/world/graphics.ts) | `Graphics`: reads the device, applies a tier to the renderer, sun shadow, sky and atmosphere, loads the post chunk, draws the frame, feeds the controller, and exposes `window.__afGraphics`. |
| [`grade.ts`](../../src/world/grade.ts) | `gradeFor()`: colour grade and bloom numbers for a look. Pure. |
| [`post.ts`](../../src/world/post.ts) | The lazy chunk: `EffectComposer` pipeline and `SkyEnvironment` (reflections). Only Medium and up download it. |
| [`fog.ts`](../../src/world/fog.ts) | The height-fog and cloud-shadow shader chunks. |

| Tier | Pixel ratio | Shadow map (blur) | Post chain | Bloom | AO | Sky reflections | Cloud shadows | Sky cloud octaves |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Low | ≤ 1 | 1,024 (1) | none (direct render) | no | no | no | no | 3 |
| Medium | ≤ 1.5 | 2,048 (1) | bloom, grade, FXAA | quarter-size chain | no | no | no | 4 |
| High | ≤ 2 | 2,048 (2) | + GTAO at half size, SMAA instead of FXAA | half-size chain | yes | yes (128 px cube) | yes | 5 |
| Ultra | ≤ 2 | 4,096 (1.6), 76 m box | as High | full-size chain | 0.75 size, 16 samples | yes (256 px cube) | yes | 5 |

**Auto: the starting tier** (`pickAutoStart`, in `quality.ts`):

- Software renderers (the WebGL renderer string contains SwiftShader, llvmpipe, lavapipe, software…) → **Low**, with shadows off. This is the only use of the device signals (`pickAutoTier(signals)` is now just that test); cores, memory, GPU string and screen size are still read for logging but no longer cap the start, and phones are not capped up front.
- Otherwise the **remembered** state, else **Ultra**. The memory is `localStorage` `americanflyers.graphicsAuto`: `{ tier, scale, at, tested, sessions, gpu }`, per device and never synced. It is written (`Graphics.remember`) once the controller has gone 30 s of measured riding (holds and the hub don't count) without a change (`Adapter.takeSettled()`), and again whenever it settles on something new; never for a software renderer or with shadows off. A different GPU string ignores it.
- **Re-test:** each Auto visit adds 1 to `sessions` at load. When `sessions` reaches 3, or `tested` is 3 days old, the visit starts **one tier above** the remembered one (never above Ultra, scale back to 1), sets `tested` to now and `sessions` to 0, and leaves the remembered tier in storage. If that tier holds for 30 s it becomes the new memory; if the controller steps down, the lower tier is saved as before. The visit's starting tier is also its ceiling, so Auto never climbs above it. Choosing Auto in Settings re-reads the memory without counting a visit.

**Auto: adapting** (`Adapter.push(now, frameMs, workMs)`, one call per drawn frame; the thresholds are in `ADAPT`):

- Frame times are not judged during a 4 s warm-up (the same again when the hub closes), after a change (6 s cool-down, 3 s after a whole-tier drop), after a resize, in the hub orbit (its frames are throttled on purpose), with a dialog open (`Graphics` holds the controller each frame while a `<dialog>` is open, then 1 s more), for 1.5 s after the tab becomes visible again, for 1 s after a landmark model is placed, 2 s after a stage change, and 600 ms after a frame that spent much longer than usual building scenery (`World.update` times `ensureRoad`, the road and its extras, landmarks and new terrain tiles; a frame counts as a spike when that took over 8 ms and over 3× its running average, so a slow device's steady cost is still judged) (`Graphics.pause()`, called from `World`; a shader compile, upload or tile build isn't the device's fault). A frame over 400 ms is a stall, not a sample, and clears the window; but 3 in a row (under 2.5 fps) count as clearly struggling.
- **Jerky** (`judge()` over the last 3 s, at least 20 frames): median frame over 22 ms, or more than 8% **hitches** (a frame over 2.5× the median, or over 50 ms), or 3 or more frames over 100 ms.
- **Clearly struggling:** median over 40 ms, or more than 20% hitches → drop a **whole tier at once** (scale back to 1; event `fast: true`), with a 3 s cool-down. At Low, or with a fixed tier, this falls back to the gentle path.
- **Merely jerky:** one gentle step: render scale 1 → 0.85 → 0.7, then the next tier down (scale back to 1), then shadows off.
- **Headroom:** over 10 s, median frame under 11 ms, or under 19 ms with a median render-call time under 4.5 ms (a 60 Hz display can't show frames shorter than 16.7 ms, so CPU time in the render call stands in for spare time) → one step up, in the reverse order, never above the visit's starting tier, and not within 30 s of a step down. A step up that is undone within 45 s makes the next attempt wait 1, 2, 5 and then 10 minutes (the whole-tier drops use the same back-off).
- **Notes:** when Auto changes the **tier** (not the scale or shadows) `Graphics` calls the notifier set by `World.onGraphicsNote` (main.ts passes `toast`): "Graphics lowered to High for a smoother ride" or "Graphics raised to Ultra". `NoteGate` allows one per 20 s and none in the first 4 s of riding (so a second change inside 20 s is silent; Settings still shows the state). Settings reads `World.graphicsAutoLabel()` ("Auto (now: High)") and `graphicsNote()`.
- A **fixed tier** only moves the render scale (same rules), never the tier, and shows no notes.
- Dev URL parameters: `?adapt=off` freezes the controller; `?softgpu=off` makes a software renderer pass for a real GPU (so Auto starts on Ultra, as on a real device); `?jank=60` burns 60 ms in every frame and `?jank=120/8` 120 ms in every 8th (a slow or a hitchy device); `?settle=3000` shortens the 30 s settle time. The e2e tests in `tests/e2e/autoGraphics.spec.ts` use them.

`window.__afGraphics` returns `{ tier, choice, autoTier, scale, pixelRatio, fps, post, shadows, gpu, change, remembered, retest }` (`autoTier` is where Auto started this visit; `remembered` the tier read from the memory) for tests and screenshots.

**The post chain** (Medium and up) in `post.ts`: `RenderPass` → `GTAOPass` (High and up; it sees the world through a copy of the camera whose far plane is 280 m, because the depth buffer is too coarse for far hills, and the shadow map is not redrawn for its normals pass) → `UnrealBloomPass` → grade `ShaderPass` → `OutputPass` (ACES and sRGB) → `FXAAPass` or `SMAAPass`. Everything before the `OutputPass` is linear HDR, so bloom (threshold about 1.15 by day, 0.95 at night) catches only the sun disc, the Tron neon, headlight pools and glints. The addons are put in their own `vendor-three-post` chunk in `vite.config.ts`, so Low devices never download them. Until the chunk arrives the frame is drawn directly; if it fails to load (offline) the frame stays direct.

**Colour grade** (`gradeFor`): saturation, contrast about mid-grey, a gain (warm cast) and a lift (shadow tint), a vignette and the bloom settings, from how dark it is (the sun's height), how overcast, how wet and how golden the light is (sun low and clear). Gentle by design: about 1.05 saturation by day, warmer and 1.15 at dusk and dawn, 0.86× grey and flatter in cloud and rain, blue (but not crushed) at night. `Atmosphere` fills one `GradeParams` per frame and `post.ts` reads it.

**Image-based lighting** (High and up): `SkyEnvironment` renders the sky dome into a cube map and prefilters it (PMREM) into `scene.environment` at intensity 0.75. `Atmosphere.skyKey` changes when the sun's height, cloud cover, night or overcast change enough, and the map is rebuilt at most every 4 s, never every frame. The sun disc is turned down while it renders.

**Rendering from a low resolution:** the render scale multiplies the tier's pixel-ratio cap (`Graphics.resize`), and the composer, bloom chain and AO buffers follow.

## Cameras

The camera is a perspective camera with a 55° field of view, and near and far planes at 0.1 m and 6,000 m. **C** or the camera button cycles the modes in this order:

| Mode | Position | Look target |
| --- | --- | --- |
| `chase` | 5.2 m behind, 2.1 m up, 0.5 m right of the rider | Ahead on the road, blended toward the rider |
| `side` | 4.2 m to the right of the rider, 1.1 m up | The rider |
| `rider` | Just in front of the rider's head | 12 m ahead on the road |

The rider starts 1.9 m right of the centerline and can steer across the right half of the road (see below). In `rider` mode the rider model is hidden.

Chase and side views ease toward their targets. The rider's view copies the position directly, and only eases the look direction.

## Road

[`src/world/road.ts`](../../src/world/road.ts) builds the road in 100 m chunks:

- The road is 9.2 m wide (4.6 m either side of the centerline), with a shared asphalt texture. Its paint and surface depend on the stage's **road style** (below): gravel shoulders, edge lines and a dashed centre line on the US highway look.
- Each chunk covers 100 m, sampled every 2 m. Chunks are built from 150 m behind the rider to 1,600 m ahead, and removed when they fall outside that range.
- Each chunk has a white-and-red post every 100 m, and a distance sign every `markers.every` meters. On stages with a finish, signs count down to the finish. The sign is the green US board, except on the French and Italian climbs, where it is a cyclists' milestone (below).
- A **checkered line** is painted across the road at the finish distance.
- Hairpin plaques are placed at the distances the stage defines in its `signs` list. Each shows the local word (**Virage** or **Tornante**) and the number.

### Asphalt and the wet road

[`roadSurface.ts`](../../src/world/roadSurface.ts) (in the lazily loaded `roadExtras` chunk) adds to the road's material:

- **Asphalt normal map** (Medium and up; `public/textures/asphalt-n.jpg`, CC0) tiled into a canvas laid out like the colour map, with the painted lines and the gravel shoulders left flat so the lines stay crisp (the layout comes from the stage's road style). A **roughness map is derived** from it (rougher where the grain is bumpier, shinier in the wheel tracks, paint smoother than stone).
- **Wet road.** `Road.setWet()` (from the atmosphere, 0 to 1) darkens the road and lowers its roughness as before; the road shader also grows **puddles**: a noise mask over the road (about 3 m patches, more and bigger as the rain builds) where the surface goes nearly mirror-smooth, flat and darker. On High and Ultra a puddle reflects the sky through the environment map (`scene.environment`, the same PMREM that lights the bikes); on Low and Medium, which have none, a fresnel term adds the horizon colour instead.

### Road styles

`Scenery.road` (`RoadStyle`, left out = `'us-highway'`) picks the road's look. [`roadStyle.ts`](../../src/world/roadStyle.ts) holds one pure description per style (`roadPaintLayout(style)`: every painted rectangle in texels, the edge bands, the tint, repairs and wear); [`roadMap.ts`](../../src/world/roadMap.ts) draws the colour map from it and `roadSurface.ts` keeps the same rectangles flat in the normal and roughness maps, so the two cannot drift apart. `Road.setMarkers()` (called on a stage change) repaints the map when the style differs and tells `RoadExtras.setRoadLayout()`, which redraws the detail maps. The road stays 9.2 m wide; only paint and surface change.

| Style | Stages | Look |
| --- | --- | --- |
| `us-highway` | Heartland, Route 66, Morgul-Bismark, Echo Lake, uploaded GPX | Dashed double yellow centre, white edge lines, gravel shoulders (exactly as before) |
| `alpine` | Alpe d'Huez, Stelvio, Tourmalet, Ventoux | One white dashed centre line (3 m dash, 10.8 m gap), thin worn white edge lines, no gravel (a dark dirty edge instead), darker asphalt with repair patches and tar seams |
| `lane` | Monte Zoncolan | No lines; ragged dark edges (a noise width per row, periodic so it tiles) |
| `park` | Tour of the Moon | Solid double yellow, no edge lines, warm red chip-seal tint, narrow dusty-red shoulders |

A 3 m dash and a 10.8 m gap are 13.8 m, which doesn't fit the 512 px (9.2 m) texture the US styles repeat. The alpine texture is 768 px tall (13.8 m; three times the 256 px asphalt tile, so the photo still tiles) and `v` runs `d / layout.repeatM`. That keeps the dash in the one texture (wet look and flat normals like every other mark, no extra draw calls or geometry), which is why it was chosen over separate dash strips per chunk. The puddle shader scales by the `uRepeat` uniform for the same reason. Low pays nothing extra: it is the same single canvas texture.

### Milestones and parapets

- **Milestones** ([`milestones.ts`](../../src/world/milestones.ts)). `signStyleOf(stage)` gives `'fr'` for `hairpinWord === 'Virage'`, `'it'` for `'Tornante'` and `'us'` otherwise (and for stages without a finish). On a French or Italian climb each countdown sign is a low-poly white post with a yellow (France) or red (Italy) cap and a canvas face, cached per text: "ALPE D'HUEZ / Sommet 7 km / Pente moy. 8.1 %" or "STELVIO / Cima 7 km / Pendenza media 8.1 %". The gradient is the stage's `elevationAt` averaged over the next marker interval (`averageGrade()`). The post is 1.3 times life size so it reads from the chase camera.
- **Stone parapets.** `Scenery.barrier` is `'rail'` (default) or `'stone'`. With `'stone'` (Stelvio, Tourmalet, Ventoux) `barriers.ts` swaps the W-beam for `stoneGeometry()`: a 3 m section of three courses of jittered grey stones, 0.55 m high and 0.45 m thick, per-stone vertex colour and a flat-shaded material. Same sections, same instancing, same Low cost. Alpe d'Huez and Zoncolan keep rails.

### Painted words, guardrails and crowds

All three apply per 100 m chunk (`Road.buildChunk()` asks `RoadExtras.addTo()`), are built from the stage and the distance only (the same every ride), and wait for the `roadExtras` chunk, which `Road.setTier()` imports after the first frame. They apply on stages with hairpin signs and a finish (the signs need not be numbered: Ventoux's are not; `isClimb()`: the six mountain climbs, and an uploaded route that has hairpins); crowds also on any stage with a finish.

- **Painted words** ([`roadPaint.ts`](../../src/world/roadPaint.ts)). `planPaint(stage, name)` picks about 9 spots over the last 3.4 km (one every 380 m: arrows, GO GO GO, stars, VAS!, ALLEZ), "ALLEZ <NAME>" three times (190, 1,350 and 2,800 m from the finish) when the rider has a name, and a word on the straight before roughly a third of the hairpins; never on the arc of a bend. A word is a strip draped along the road (1 m rows, 6.3 m of the 9.2 m width, 4 to 6 m long, so it reads from a rider's eye height) from one atlas canvas (1,024 px a row, 512 on Low) with a little wear. `World.setRiderName()` (from `main.ts`, on sign-in) passes the account name; `paintName()` keeps the first name's letters only, upper case, at most nine, so an empty result means no name.
- **Guardrails** ([`barriers.ts`](../../src/world/barriers.ts)). `bendsOf(stage)` (in [`roadside.ts`](../../src/world/roadside.ts)) finds each hairpin from the stage's signs (where the heading turns faster than 0.04 rad/m, so a wide switchback such as Echo Lake's has none, and a named place has none); a rail goes along the outside of each (a right turn has its outside on the left) with 9 m of lead-in and out, and on any stretch where the ground 13 m from the centreline is more than 4 m below the road. One instanced 3 m section (a W-beam, a post and a reflector, 1 m outside the gravel shoulder), pitched to the grade.
- **Crowds** ([`crowds.ts`](../../src/world/crowds.ts)). `crowdNear(d)` in [`crowdZones.ts`](../../src/world/crowdZones.ts) (moved out of `main.ts`, where the sound still reads it) says how thick the crowd is: round each hairpin sign and the last 700 m of a finish. `planCrowd()` fills slots every 1.7 m on both sides, two rows deep, in clumps, thinned by the tier's `crowd` share. Spectators are low-poly (about 70 triangles) and instanced, shirt colour per instance and skin tone from a hash of their position; about one in seven waves a flag where the tier allows. The cheering is in the vertex shader: they jump, wave their arms and ripple their flags more as the rider comes within 70 m (`Road.animate()` passes the rider's position and the clock each frame), and sway a little otherwise. Their shadows are on from High; they are not animated in the shadow pass.

- **Local character** ([`crowdCulture.ts`](../../src/world/crowdCulture.ts), [`crowdFlags.ts`](../../src/world/crowdFlags.ts)). `cultureOf(stage)` reuses the hairpin word (`Virage` France, `Tornante` Italy) and gives Colorado to `hotw-*` and `hell-of-the-west`, the USA to the rest, so `stages.ts` has no crowd lists. Each culture has weighted shirt colours (France: some white polka-dot jerseys, drawn as dots in the fragment shader; Italy: lots of maglia rosa; USA/Colorado: team colours) and up to 8 flag designs (tricolour, polka dot, Breton, Basque; tricolour and Giro pink; stars and stripes, Colorado). The flag cloth is one small canvas atlas (a row per design), sampled in the shader; each culture's flag-wavers use their own material (a table of rows in a uniform), so there is one mesh per culture present per chunk and no per-instance attribute. From High, spectators also get caps (on about half of them, in the shader) and a bigger flag (`Scenery.crowdDetail`).
- **Crowd hotspots** (`crowdZones.ts`). A `CrowdHotspot` is `{ d, radius, density, culture }`, placed from a hairpin sign's label by the small `HOTSPOT_SPECS` table (the Alpe's hairpin `7`, the Dutch Corner: radius 130 m, density 1.35, culture `nl`). Inside it `planCrowd()` fills gaps, adds a third row, raises the flag share and dresses most people in the hotspot's culture (orange shirts, Dutch and orange flags). `crowdAt(stage, d)` is the pure form of `crowdNear()`; it can exceed 1 in a hotspot, so the crowd roar is louder there.
- **Roadside camp** ([`campers.ts`](../../src/world/campers.ts)), on the `isClimb()` stages. `planCampers()` tries a spot every 22 m where `crowdAt` is at least 0.12, thinned by the tier's `crowd` share, never in the first 60 m or the last 160 m: a motorhome, a ridge tent or a parasol with a table and two folding chairs, 8 to 14 m from the centreline on the uphill side (the other now and then). A spot is rejected unless all its footprint corners are at least 6.2 m from every stretch of road within 200 m (so never on the other leg of a hairpin, and clear of the rails at 5.6 m), the ground under it varies by less than 0.6 to 0.9 m and is within 3 m of the road's height (not a drop), and no guardrail or parapet section (`barrierSections()`) is alongside on that side. They stand on `groundSampler()` heights, one instanced mesh per kind per chunk, tinted per instance (orange at the Dutch Corner), shadows from High.

| Tier | Terrain layers (size) | Normals | Triplanar rock | Anisotropy | Road normal | Crowd share | Flags | Crowd shadows | Guardrails and paint | Detailed trees | Ground cover |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Low | 3 (512) | no | no | 2 | no | 0.35 | no | no | yes | no | none |
| Medium | 8 (1K) | no | yes | 4 | yes | 0.7 | yes | no | yes | yes | none |
| High | 8 (1K) | yes | yes | 8 | yes | 1 | yes | yes | yes | yes | half |
| Ultra | 8 (1K) | yes | yes | 16 | yes | 1 | yes | yes | yes | yes | full |


## Terrain

[`src/world/terrain.ts`](../../src/world/terrain.ts) builds the ground in **200 m square tiles**, on a 4 m grid. Tiles whose center is within **1,150 m** of the rider are kept.

- **Height** is a function of world position only, so neighboring tiles always line up.
- **Near the road** (within about 260 m), the ground follows the road's own elevation, blending out to the stage's "wild" terrain. Where two stretches of road are close together (stacked hairpins), the height blends between them.
- **Color** depends on height and slope: grass, fields (where the stage allows), rock above the rock line, pale limestone scree above a stage's optional `screeLine` (Mont Ventoux's bald summit, which sets `snowLine: 1e9` because it is summer), and snow above the snow line. Steep ground darkens, and cliffs turn to rock (paler among scree). The tiles are smooth-shaded.
- **Desert palette.** A stage whose scenery has `palette: 'desert'` (the Tour of the Moon) colours the ground in thin bands of red, orange and tan sandstone with sand and sage patches, turns cliffs dark red, and plants sparse junipers (70 candidate points per tile) instead of forest. Its wild terrain is stepped into mesas by `terrace()` in `stages.ts`.
- **Canyons beside the road.** A stage's optional `Scenery.roadside(d, lateral, plain)` hook (pure shapes in [`canyon.ts`](../../src/world/canyon.ts)) replaces the plain blend near the road. `Near` carries the signed `lateral` of the closest road point, and the terrain, candidate scan and nearest-road limit reach 900 m instead of 260 m on such a stage. The Tour of the Moon lists `RIM_ROCK_SECTIONS` (left, right, both or no canyon over stretches of 2 to 4 km, fading over 520 m at each end, so the cliff grows out of the plain ground). On the canyon side: a level ledge to a lip 10.6 to 12.2 m from the centreline, a stepped cliff of 120 to 220 m (a big Wingate face, then ledges), a talus slope, a gently rolling floor to 370 to 510 m out, then ledges climbing back to the wild terrain by about 800 m. On the other side of a one-sided canyon the rock climbs 45 to 70 m in ledges before blending to the wild terrain. `roadsideSlope()` gives the slope across the road there, because the 4 m grid cannot see a cliff: no tree grows on slopes steeper than 0.6 and no ground cover on slopes steeper than 0.5 (`GroundHit.slope`). Stages with a hook get barriers on the drops (`hasBarriers()`), stone parapets on the Tour of the Moon.
- **Monoliths.** [`monoliths.ts`](../../src/world/monoliths.ts) builds Independence Monument, the Coke Ovens and the Kissing Couple (about 1,000 to 2,500 triangles each; a lathe of rings with ledges, a ragged outline, banded vertex colours and a talus skirt, flat-shaded), placed from `MONOLITHS[stageId]` by course distance and lateral offset on the canyon floor and stood on `groundSampler()`'s height. Built when the rider is within 2.6 km, dropped 1.5 km behind; shadows on High and Ultra only.
- **Trees** are scattered at 260 candidate points per tile (70 in the desert). Forests are dense where the forest noise is high; elsewhere a lone tree grows at `loneTreeShare(forestCover)` of the points (6%, fewer on open grassland). Trees are removed within 12 m of the road and near landmarks, and above the scree line. See [Trees](#trees).
- **Standing things on the ground.** `groundSampler(minX, maxX, minZ, maxZ)` returns a height lookup for a box, for things placed beside the road (guardrails use it to find drops).

The first frame builds every tile in range at once. After that, at most two tiles are built per frame.

### Trees

[`src/world/trees.ts`](../../src/world/trees.ts) owns the tree geometry, the one material, and the pure rules for what grows where; `terrain.ts` scatters and draws them.

- **Nine species, one style** (faceted low-poly, per-vertex colour darker at the bottom and inside of the crown and lighter at the tips, up-facing faces a little lighter): spruce (several drooping, jagged tiers), pine (ponderosa or lodgepole: tall bare trunk, a clumped crown of flat tufts), larch (lighter conifer), oak (broad crown of several lumps), beech (also stands for maple: rounder and denser), aspen (pale banded trunk, slim light-green crown; summer green, never gold), cottonwood (big riverside broadleaf), juniper (also pinyon: squat, grey-green) and shrub (low clumps; the krummholz at the tree line). The shapes are built in code, with jitter seeded per species, so the trees are the same every ride.
- **Which species.** `Scenery.trees` is a stage's relative weights (see [Stages and GPX](stages-and-gpx.md)); a stage without one (an uploaded route) gets `defaultMix(coniferBias, desert)`. `pickSpecies()` multiplies each weight by `habitat()` (oaks and cottonwoods fade out with height, beeches and aspens thin before the tree line, larches need some height), and 60% of the trees in a 45 m square share the cell's roll, so stands of one kind form. `treeLineRule()` replaces the old hard cut: shrubs take over over the last 80 m below the tree line and grow up to 25 m above it, then nothing.
- **Two levels of detail.** Near geometry is 70 to 130 triangles, far is 28 to 44 with the same silhouette and colours. Every tile's trees are one InstancedMesh per species; `Terrain.update()` swaps a tile's meshes between the two geometries (the instance matrices stay) by distance from the rider: near inside 400 m, far beyond 440 m (`chooseLod()`, with hysteresis so a tile on the boundary does not flicker). Only near tiles cast and receive shadows (the shadow box is 60 m wide anyway). **Low always draws the far geometry** (`SceneryTier.nearTrees`); tiles are built with the far geometry and swapped on the frame they are created.
- **Triangles** in the trees of every tile in range (the rider's view is about a quarter of them), before and after, on the Alpe at km 3: about 889,000 before (all 16,767 trees at 52 to 64 triangles; about 219,000 in the rider's view); after, High is about 695,000 (-22%; about 161,000 in view) and Low about 604,000 (-32%; about 149,000 in view), since only the tiles within 400 m use the detailed geometry.
- **Variation.** `treeTint()` gives each instance a colour multiplier that shifts brightness, hue (warmer or cooler) and saturation, not only brightness; the vertex colours multiply it.
- **Wind sway.** The tree material and its shadow twin (`customDepthMaterial`, so the shadows sway too) are patched with `onBeforeCompile` to replace `project_vertex`: each vertex is offset by `afSway()` from [`sway.ts`](../../src/world/sway.ts) for its height above the tree's base (local y times the instance's scale), with the phase taken from the tree's base so a crown moves as one. One material and one depth material serve every tile and both LODs, so nothing recompiles per tile.

### Texture splatting

Each vertex also carries **eight layer weights** (`aWa`, `aWb`, one byte each): grass, dry grass, dirt, rock, snow, sandstone, sand, scree. `groundColor()` fills them from the same logic as the colour, so a stage still looks like itself: grass with dry grass in the bright patches and wherever the stage has fields; the verge (within 6 to 9 m of the road) is dirt; rock, scree and snow take over by height and the stage's `rockLine`, `screeLine` and `snowLine` (scree has a noisy edge like the snow line, its verge stays mostly scree rather than dirt, and the rock fades out under it); the desert is sandstone under a skin of sand, with sage patches as dry ground.

The splatting itself is [`src/world/ground.ts`](../../src/world/ground.ts), a lazily loaded chunk (`Terrain.setScenery()` imports it after the first frame; until then, and if it fails to load, the plain vertex colours show). It patches the terrain's `MeshStandardMaterial` (`onBeforeCompile`):

- **The vertex colour stays.** Each layer's texture is divided by its own average colour, greyed a little and scaled by a per-layer contrast, and the blend multiplies the vertex colour. The photographs add grain, never a different hue, so the palettes survive.
- **Textures** come from one `DataArrayTexture` (8 layers, mipmapped, anisotropic) for the colour and one for the detail normals (512 px). Ground layers are projected from above at 4 to 6 m per repeat. A large-scale noise tint (90 m and 26 m) hides the tiling from a distance, and the grain fades out beyond about 160 to 600 m.
- **Rock is triplanar**, and any pixel steeper than about 40° turns to rock (judged per pixel from the smooth normal), so cliffs never stretch. With normals (High and up) rock's normal map is blended triplanar (whiteout) and the other layers' normals are projected from above and fade out beyond 60 to 260 m.
- **Lazy and per stage.** One JPEG per layer in `public/textures/terrain/` (`grass.jpg`, `grass-n.jpg` …), fetched and decoded a layer at a time, then uploaded once. Only the layers a stage can show are fetched (`layersFor()`: no sandstone on the Alpe, no snow where the snow line is out of reach, no scree unless the stage has a `screeLine`, no grass in the desert). Sources and licences are in [`public/textures/README.md`](../../public/textures/README.md); all are CC0 (Poly Haven).
- **Per tier** (`TIER_SPECS[tier].scenery`, see [`scenery.ts`](../../src/world/scenery.ts)): Low fetches **three layers** (grass and rock plus snow or scree, or sandstone and rock in the desert; dry grass and dirt fold into grass, sand into sandstone), shrinks them to 512 px while decoding, has no normals and projects rock along one horizontal axis instead of three. Medium has every layer the stage needs (the array holds eight) at 1K with triplanar rock. High and Ultra add the detail normals. Anisotropy is capped at 2, 4, 8 and 16.

### Ground cover

[`src/world/groundCover.ts`](../../src/world/groundCover.ts) puts small instanced plants and stones on the flat verges and fields beside the road: grass tufts, wildflowers, stones and, in the desert, sage bushes. **High draws half of it, Ultra all of it** (`SceneryTier.groundCover`: 0, 0.5 or 1); Low and Medium draw nothing and never download the chunk. `World.syncCover()` imports it after the first frame, `World.update()` calls `update()` each frame next to the terrain, and a tier change goes through `applyScenery()`: Auto stepping down to Medium disposes the cover (meshes, geometry, materials and instance buffers), stepping back up makes it again.

- **Cells.** The ground beside the road is cut into cells keyed by road distance, like road chunks: 10 m along the road, three bands across it from 5.6 m from the centreline (just outside the gravel shoulder) to 30 m. Cells whose middle is within 104 m of the rider are built, nearest first and at most about 4 ms of work a frame, and dropped beyond 114 m. The search covers 700 m of road either way, so the next leg of a hairpin is found too. In steady state a frame only moves the fade centre; cells change every 10 m of riding.
- **Placement is deterministic.** Each cell tries a fixed number of jittered candidate points, hashed from the cell, the candidate and the stage (`hash2`). A candidate survives a draw against the density at its distance from the road (2.2 per m² at the verge, falling to nothing at 30 m) times a patchiness noise and the tier's share, so High's items are a subset of Ultra's. Ground the road is nearer to another leg of (the inside of a hairpin) is skipped.
- **What grows follows the ground.** `groundProbe()` in `terrain.ts` (next to `groundColor()`) gives the ground height and the same layer weights the splatting uses; `pickCover()` treats the weights as odds. Grass: green tufts, a few white, yellow and purple wildflowers in drifts, the odd stone. Dry grass and fields: straw tufts. The dirt verge: sparse tufts and pebbles. Rock: stones and tiny alpine flowers. Snow: nothing. The desert palette: sage bushes (more on the sage patches) and red stones. Heights are the terrain's own, so items sit on the ground.
- **Geometry.** A tuft is seven bent, tapered blades (3 triangles each, 21 in all; real geometry, no alpha-tested textures); a flower a crossed stem, a six-sided head and a centre (15); a stone a jittered icosahedron squashed by its instance scale (20); a bush three lumps (60). Vertex colours run dark at the base to light at the tip and are multiplied by a per-instance colour; a per-vertex `aTint` lets a flower's stem and centre keep their own colour.
- **Drawing.** One `InstancedMesh` per kind, four draw calls for the whole cover, on camera layer 1 (the ambient-occlusion pass's own camera has layer 0 only, so it does not redraw the blades for their normals), receiving shadows and casting none. Built cells keep their matrices; when the set of cells changes they are copied side by side into the instance buffers and only the used range is uploaded. About 2,500 tufts, 200 flowers and 450 stones are in view at Ultra on Heartland (about 64,000 triangles; half that on High).
- **Wind and fade, in the vertex shader.** Plants take `afSway()` from `sway.ts` (stiffness 0.25, and four times their height as its height argument, because the bend grows with the square of height and was tuned for trees); stones do not move. Everything scales to nothing between 75 m and 90 m from the rider, so the edge of the cover never pops. Rain darkens it with the ground (`setWet`).

## Rider and bike

[`src/world/rider.ts`](../../src/world/rider.ts) builds the bike from primitives: frame tubes, wheels that turn at the virtual speed, drop bars, saddle, cranks and pedals.

The rider is loaded from `models/rider.glb`. The model has a 24-bone skeleton, and the app poses it every frame with two-bone inverse kinematics:

- **Arms** reach to the hoods, with the elbow bending down and out.
- **Legs** follow the pedals, turned by the virtual drivetrain (see [Physics and stats](physics-and-stats.md#virtual-drivetrain-and-shifting)), with the ball of the foot on the pedal. The model's foot bone runs above the sole, so the toe target sits 4.5 cm below the pedal to keep the shoe level, dipping a little more through the bottom of the stroke (ankling).
- **Torso** leans forward on the bike, and the head tilts up to look along the road.

The rig needs these bone names: `Hips`, `Spine02`, `Spine01`, `Spine`, `neck`, `Head`, `head_end`, `Left` and `Right` `Arm`, `ForeArm`, `Hand`, `UpLeg`, `Leg`, `Foot` and `ToeBase`. A missing bone throws an error, so keep the names when you replace the model.

If `rider.glb` fails to load, the built-in primitive rider is used instead. The console logs *Rider model not found* and carries on.

`rider.glb` is loaded once and cloned (with `SkeletonUtils.clone`) for every rider on the road. `RiderModel` takes an optional look: a frame and jersey colour (other riders get one picked from their id), a `kit` (the rigged rider's navy and red become two chosen colours), or `ghost`, which makes every material see-through and blue-tinted and turns off its shadows.

### Changing a rider's look at runtime

`RiderModel.setLook({ frame, jersey, kit })` changes colours without reloading the model: the frame and jersey materials are recoloured in place (a shared default material is first swapped for the rider's own), and the kit is re-applied to the rigged rider (`null` restores the stars and stripes; each mesh remembers its original material). `World.setPlayerLook()` calls it for your rider. [`src/kit.ts`](../../src/kit.ts) holds your kit and a tour-jersey override: `setTourJersey([main, second])` lays a jersey over the saved kit, `setTourJersey(null)` removes it, and `onLookChange()` (used by `main.ts`) hands the result to the world. The look sent to other riders includes the tour jersey.

## Other riders and ghosts

[`src/world/others.ts`](../../src/world/others.ts) draws everyone else on the road: live riders from riding together, and the ghost.

- Up to 12 riders are drawn, the nearest first, from 300 m behind to 900 m ahead.
- Each rider moves on at their reported speed, then eases onto the latest predicted position (over about 0.9 s), so the 2-second updates don't show. A jump of over 150 m snaps.
- Each has their own drivetrain, so their legs turn at their speed and cadence, and the bike rocks with their power.
- Lanes are spread across the right half of the road from the rider's id. `update()` takes your current lane (`playerLane`): a rider within 1.9 m of you, and near your line, moves out a lane to pass; a live rider 1.9–14 m ahead whose line is within 1.3 m of yours lines up in your lane, so drafting looks like it should. Pro team riders keep their own two-by-two lanes. The ghost rides a lane to your left. `lateralOf(id)` returns a drawn rider's current lane, which the lateral draft uses.
- Name tags are canvas sprites that stay the same size on screen. They're hidden within 3.5 m of the camera and beyond 260 m.
- Posing the rigged rider is the costly part, so riders more than 220 m away aren't re-posed.
- A live rider's kit comes with their position (`jersey`, `accent`, `frame` on `OtherRider`); if it changes while they're on the road, `setLook()` updates their model. Riders without a kit get colours picked from their id.
- `showEmote(id, emoji)` floats an emoji sprite (one shared canvas texture per emoji) up from a rider's head over about 2.6 s, for ride-ons. It returns false if that rider isn't drawn.
- Riders not heard from are removed, and their materials and textures disposed.

## Steering

The bike's lane is `World.lane`, metres right of the centre line (default 1.9, limits 0.5–4.0, from `src/steering.ts`). `world.setLane(target)` sets where it's going; each frame the lane eases there with a time constant of 0.27 s (about 0.8 s to settle), and the bike and cameras are placed from the eased lane. `Steering` in `src/steering.ts` owns the target: **←** / **→** (and the `#steer-left` / `#steer-right` buttons, shown for `pointer: coarse`) call `press()`, which steps 0.7 m and repeats while held; auto-steer slides the target towards the nearest rider within 12 m ahead after 3 s without input. The draft uses the eased lane (see [Physics and stats](physics-and-stats.md#drafting)).

## Atmosphere: time of day and weather

[`src/world/atmosphere.ts`](../../src/world/atmosphere.ts) owns everything that changes with the light. It holds a *look* (sky and horizon colours, sun or moon colour, intensity and direction, hemisphere light, fog colour and far distance, tone-mapping exposure, stars, cloud cover and colours, mountain tint, wetness, rain level, overcast). Each frame it builds a *target* look from the clock and the weather, then eases the current look towards it (time constant 1.6 s, so any change settles in about 5 s). Nothing is allocated per frame.

- **Time:** a 24-hour keyframe table (night, dawn at 6.3 h, day from 8.6 h to 17 h, dusk at 19.3 h, night from 21 h). Fixed choices map to an hour (dawn 6.3, day 10, dusk 19.3, night 22.5). On **Auto** the clock starts at the stage's `timeOfDay` (default day) and advances one hour per 120 s while the bike is moving. The sun's elevation and azimuth follow from the hour; the moon is fixed. The shadow-casting light is the sun, handing over to the moon as the stars come in.
- **Weather:** `clear`, `cloudy` or `rain` greys the sky, dims the sun, thickens the fog and adds cloud (and, for rain, wetness and rain). On **Auto** it starts at the stage's `weather` (default clear) and every 4–8 minutes of riding may drift (clear → cloudy; cloudy → clear or rain; rain → cloudy).
- **Night:** a `SpotLight` on the rider (always in the scene, intensity 0 by day, so the shader never recompiles) lights the road ahead. Stars and the moon are drawn in the sky-dome shader.
- **Rain:** [`src/world/rain.ts`](../../src/world/rain.ts) is one `LineSegments` of 3,600 streaks (1,300 with `prefers-reduced-motion`, slower and fainter) in a 44 × 26 × 44 m box that moves with the camera. The vertex shader wraps each streak round the box from a time uniform, so the CPU does no per-drop work. `Road.setWet()` and `Terrain.setWet()` darken surfaces and lower their roughness. `Sound.setRain()` fades in a hiss.
- **Settings and API:** `settings.timeOfDay` (`auto | dawn | day | dusk | night`) and `settings.weather` (`auto | clear | cloudy | rain`); `world.setAtmosphere(time, weather)` applies them, and `world.restage()` resets the Auto clock and weather from the new stage. `Stage` has optional `timeOfDay` and `weather` defaults. The menu dialog is `src/atmosphereUi.ts`.

From the current look `apply()` also writes the height-fog numbers (`fog.ts`'s `setFog`), the sky's look, the `GradeParams` (`grade.ts`), and `skyKey` (what the reflections watch). `Graphics` sets two of its fields from the tier: `cloudShadows` and `hemiScale`.

To add a look, add a `Keyframe` to `KEYS` and put it on the `TIMELINE`.

## Sky

[`src/world/sky.ts`](../../src/world/sky.ts) builds three things, all following the camera:

- **A sky dome**, one fragment shader. The gradient from horizon to zenith is still the time-of-day and weather preset, and on top of it `skyBase()` adds the scattering that depends on where the sun is: a warm band along the horizon on the sun's side at low sun, and the pink belt of Venus opposite it (both strength `band`, from the atmosphere's golden-hour amount). The sun is a hot disc (30× white, so it feeds bloom) with a forward-scattering Henyey-Greenstein halo and a wide glow, hidden by cloud and by overcast. Stars and the moon at night, and a little dither against banding. Its colours and the sun direction are the shared `ZENITH_COLOR`, `HORIZON_COLOR`, `SUN_DIRECTION` and so on, which the atmosphere updates in place. (This is an analytic approximation tuned to the existing presets, not three's `Sky` addon, which would have added weight to the first download and ignored the presets.)
- **Clouds**, in the same shader: a noise layer 1,500 m above the camera (shapes 650 m across at the largest), sampled at world position (so you ride under them) plus a drift that follows the wind. Density is fractal noise (`afCloud`, in `fog.ts`, 3 to 5 octaves by tier); `cloudThr` (from the atmosphere's cloud cover) decides how much sky is cloud. Each cloud is lit by a second, shorter sample towards the sun: thick parts are shaded with the preset's `cloudGlow` colour, edges facing the sun bright with a silver lining, and everything thins into the haze near the horizon.
- **A mountain ring** of 160 segments at radius 3,600 m. Its height is set per stage by `mountainScale`, and its peaks lighten toward snow. A tint (set by the atmosphere) darkens it at dusk and night. Its own shader buries the foot of each mountain in the same haze colour as the sky's horizon (`hazeD`, the fog's optical depth at 3.6 km, falling off over 150 m of height), so peaks stand clear of a hazy base.

The sky group follows the camera, but sits 60 m lower, so the horizon stays put on climbs. The dome's vertex shader puts it on the far plane, so it is drawn after the opaque scenery (`renderOrder` 1) and only the sky pixels pay for the shader.

## Haze and height fog

[`src/world/fog.ts`](../../src/world/fog.ts) overrides three's `fog_*` shader chunks once (`installFog()`, called in the `World` constructor before anything compiles), so every built-in material (terrain, road, trees, riders, landmarks, signs) gets the same fog without touching its material. `scene.fog` is still a `THREE.Fog`, but only to switch fog on and carry its colour (the horizon colour).

- **Height fog.** Exponential density falling with height (`k` = 1/110 per metre above a base 28 m under the rider), integrated exactly along the view ray, so the valley below you is hazier than the ridge above. Nothing within 70 m of the camera is fogged. The density is about 1.45 / `fogFar` (about 1.5 optical depths over the old fog distance; thicker at dawn and dusk, and in rain through the weather's shorter `fogFar`), and a smoothstep forces full fog from 80 % to 100 % of `fogFar`, so the edge of the terrain tiles never shows.
- **In-scattering.** The haze takes on the sun's colour towards the sun (forward scatter) and along the sunset horizon (the same band as the sky dome's), so the distance meets the sky at the same colour.
- **Tone mapping.** Fog is mixed after tone mapping on the direct (Low) path, which reads thinner than the post-processed path, where fog is mixed in linear HDR before it. The Low path therefore tone-maps the fog colour and thickens the fog by 1.3×.
- **The shared uniform.** One `Float32Array` (`vec4 afFog[4]`) is added to every `ShaderLib` entry that has fog. `UniformsUtils.clone()` copies typed arrays by reference, so one write per frame (`setFog`) reaches every material. The layout is documented at the top of the file.
- **Cloud shadows** (High and up). The sun's `directLight.color` is multiplied by `afCloudShade()`, which looks along the sun ray to the cloud layer and reads the same noise and drift as the sky: a cloud above casts its shadow on the land. Strength 0.6, less under cloud, none at night.

Also: `world.ts` patches nothing else. A new material needs nothing to get fog; a custom `ShaderMaterial` must set `fog: false` (as the dome, mountains and rain do) or include the fog chunks.

## Landmarks

[`src/world/landmarks.ts`](../../src/world/landmarks.ts) places landmarks along the road. A landmark is either a GLB model loaded from `public/models/`, or a **monument built in code** from primitives (below).

Each stage lists its landmark kinds in `src/stages.ts`. A kind is a `LandmarkKind`:

| Field | Meaning |
| --- | --- |
| `file` or `model` | Exactly one (the type enforces it). `file`: the GLB in `public/models/`. `model`: a `MonumentId` built in code. |
| `options` | For a monument: its words and looks (`lines`, `style`, `seed`; see below). |
| `every` | Meters between repeats (`1e9` for a one-off at `first`). |
| `first` | Distance of the first one. |
| `side` | `-1` left, `1` right, `0` on the road. |
| `span` | For `side: 0` only: `across` for an arch, `along` for a bridge the road runs through. |
| `offset` | Meters from the centerline. |
| `size` | Target height in meters (or width, for road-spanning kinds). |
| `yaw` | Extra turn after facing the road. A negative `yaw × side` turns the front towards oncoming riders. |
| `clearance` | Meters of tree-free space around it. |
| `reach` | Optional: meters of course either side within which it is placed (default 250 behind, 1,500 ahead). For huge, distant things (the Flatirons use 7,000). |

Models are scaled to `size`, centered, and stood on the ground. Landmarks are placed between 250 m behind and 1,500 m ahead. A model file is fetched the first time a landmark that uses it comes into that range, not all at start-up (the nine files are 7.5 MB, and a stage uses only some of them), so a rider only downloads the models for the stages they ride. A missing file is skipped, and the console logs *Landmark model not found*.

The farm landmarks used on lowland stages and most GPX routes are in `FARM_LANDMARKS` in `src/stages.ts`. `monumentAt()` writes a one-off monument kind; a climb's `ClimbSpec.landmarks` (a list, or a function given `at.hairpin('7')`, the apex distance and outside of a numbered hairpin found from the stage's own signs) adds landmarks after the start and finish arches.

### Monuments built in code

Landmarks that would otherwise need a generated model are built from primitives in a **lazy chunk**: [`monuments.ts`](../../src/world/monuments.ts) (the registry, signs, memorial and Le Géant), [`monumentBuildings.ts`](../../src/world/monumentBuildings.ts) (the buildings), [`flatirons.ts`](../../src/world/flatirons.ts) and the shared toolkit [`monumentKit.ts`](../../src/world/monumentKit.ts). `landmarks.ts` imports the chunk the first time a monument comes into range (stages without any never download it) and builds each kind once; placements are clones sharing geometry and material.

- **The look.** Low-poly, flat-shaded, vertex-coloured, like the trees. A `Kit` collects boxes, gabled and pyramid roofs, cylinders, tilted bars (`bar()`), rings and tapered slabs, each with its colour baked in and a slight darkening towards its foot, and `build()` merges them into **one mesh with one shared material**. Signs and plaques are a few textured quads (`boardMaterial()`, a cached canvas texture; plain colour without a DOM, as in unit tests). Each monument is under about 6,000 triangles (most under 2,000) in one to three draw calls.
- **Scale and placement.** A builder works in metres, stands on y = 0 (footings go below it, so a monument on a slope has no gap) and faces +z. `landmarks.ts` scales it so its height is `size` (set to the builder's natural height, which a unit test checks), without re-centring, and turns it to face the road like a model. Small monuments cast and receive shadows; the Flatirons do not (`userData.shadows`).
- **Where they are.**

| Monument | Where |
| --- | --- |
| `ventoux-observatory` | Ventoux summit: pale concrete building and the banded red-and-white mast (about 52 m), left. |
| `simpson-memorial` | Ventoux, 1.3 km before the summit, right: granite stele, plaque, cairn. |
| `chalet` | Ventoux at Chalet Reynard (15.6 km); `lines[0]` is the name board. |
| `alpine-church` | Alpe d'Huez, on the outside of hairpin 7 (found from the stage's signs). |
| `ski-apartments` | Alpe d'Huez near the finish; La Mongie on the Tourmalet (15 km). 3 to 5 blocks, varied by `seed`. |
| `geant-tourmalet` | Col du Tourmalet: the dark steel cyclist on a plinth, right. |
| `pass-buildings` | Stelvio summit: a row of hotels, with Italian flags for `style: 'it'`. |
| `col-sign` | Summit board before every European finish: `lines` (name, altitude) and `style` `'fr'` (brown) or `'it'` (green). |
| `log-lodge` | Echo Lake: log lodge with a green roof, `lines[0]` on the porch. |
| `flatirons` | Morgul-Bismark: see below. |
| `washington-summit`, `diablo-summit`, `crest-house-ruins`, `summit-sign-us` | Built and tested, not placed yet (for the American stages that come later). |

- **The Flatirons** are 2.5 km west of Highway 93, once a lap, with `reach: 7000` so they are in view along much of the circuit. They stand beyond the terrain tiles, so the model brings its own forested ridge (a coarse vertex-coloured heightfield, `mountainHeight()`) with six or seven red-tan slabs leaning on its face. Height fog would hide anything this far away, so the model uses `farMaterial`: its vertex shader shrinks `vFogRel` (see [Haze and height fog](#haze-and-height-fog)) by 0.22, so the fog treats it as about a quarter of its distance and it is hazy, in the scene's own haze colours, rather than fogged out. In rain, where the fog is shorter, it still disappears.

### Adding a model

For a GLB:

1. Put the `.glb` file in `public/models/`. Keep it under about 15,000 triangles, as [`public/models/README.md`](../../public/models/README.md) suggests.
2. Add a `LandmarkKind` for it to the `landmarks` array of the stages where it should appear, or to `FARM_LANDMARKS` if it belongs on every lowland stage. The file name must match exactly.
3. Load the page and check the model appears at the right place. It appears only once it's referenced by a stage.

`public/models/README.md` says files placed in that folder "appear beside the road". That's only true for files a stage refers to. A GLB in the folder does nothing on its own.

For a monument built in code: write a builder returning a `THREE.Group` (use `Kit`; stand it on y = 0, front towards +z, end with `finish(group, shadows)`), add its id to `MonumentId` in [`monumentTypes.ts`](../../src/world/monumentTypes.ts) and to the registry in `monuments.ts`, and add a kind with `model` (or `monumentAt()`) to the stage. `tests/unit/monuments.test.ts` checks every builder's triangle budget and that a kind's `size` matches the builder's natural height.

## Performance

- Terrain and road are built in chunks and tiles, and only the ones near the rider exist. Tiles, road chunks and landmarks are created as the rider approaches and removed once they fall behind.
- Shadows are limited to a 60 m box around the rider.
- Relative frame cost per tier, measured in headless Chromium's software renderer at 800 × 500 (so a guide to the extra work, not to a real GPU): Low 1.0, Medium 1.2, High 1.8, Ultra 2.3.
- Quality is per device (see [Graphics tiers and post-processing](#graphics-tiers-and-post-processing)): Low draws straight to the screen with no post-processing, and the whole post chunk (about 50 kB gzip of three addons plus 2 kB of ours) is only fetched on Medium and up.
- Changing stage clears the terrain, landmarks and ground cover, and rebuilds them for the new stage.
- Ground cover is High and Ultra only; it adds four draw calls and about 30,000 (High) to 65,000 (Ultra) triangles on a grass stage (see [Ground cover](#ground-cover)).
