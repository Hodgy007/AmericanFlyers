# 3D world

This page covers the Three.js setup in `src/world/`: the renderer and lights, the cameras, the terrain tiles, the road, the rider rig, the sky, the landmarks, and how to add a model.

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

All three apply per 100 m chunk (`Road.buildChunk()` asks `RoadExtras.addTo()`), are built from the stage and the distance only (the same every ride), and wait for the `roadExtras` chunk, which `Road.setTier()` imports after the first frame. They apply on stages with numbered hairpins and a finish (`isClimb()`: the six mountain climbs, and an uploaded route that has hairpins); crowds also on any stage with a finish.

- **Painted words** ([`roadPaint.ts`](../../src/world/roadPaint.ts)). `planPaint(stage, name)` picks about 9 spots over the last 3.4 km (one every 380 m: arrows, GO GO GO, stars, VAS!, ALLEZ), "ALLEZ <NAME>" three times (190, 1,350 and 2,800 m from the finish) when the rider has a name, and a word on the straight before roughly a third of the hairpins; never on the arc of a bend. A word is a strip draped along the road (1 m rows, 6.3 m of the 9.2 m width, 4 to 6 m long, so it reads from a rider's eye height) from one atlas canvas (1,024 px a row, 512 on Low) with a little wear. `World.setRiderName()` (from `main.ts`, on sign-in) passes the account name; `paintName()` keeps the first name's letters only, upper case, at most nine, so an empty result means no name.
- **Guardrails** ([`barriers.ts`](../../src/world/barriers.ts)). `bendsOf(stage)` (in [`roadside.ts`](../../src/world/roadside.ts)) finds each hairpin from the stage's signs (where the heading turns faster than 0.04 rad/m); a rail goes along the outside of each (a right turn has its outside on the left) with 9 m of lead-in and out, and on any stretch where the ground 13 m from the centreline is more than 4 m below the road. One instanced 3 m section (a W-beam, a post and a reflector, 1 m outside the gravel shoulder), pitched to the grade.
- **Crowds** ([`crowds.ts`](../../src/world/crowds.ts)). `crowdNear(d)` in [`crowdZones.ts`](../../src/world/crowdZones.ts) (moved out of `main.ts`, where the sound still reads it) says how thick the crowd is: round each hairpin sign and the last 700 m of a finish. `planCrowd()` fills slots every 1.7 m on both sides, two rows deep, in clumps, thinned by the tier's `crowd` share. Spectators are low-poly (about 70 triangles) and instanced, shirt colour per instance and skin tone from a hash of their position; about one in seven waves a flag where the tier allows. The cheering is in the vertex shader: they jump, wave their arms and ripple their flags more as the rider comes within 70 m (`Road.animate()` passes the rider's position and the clock each frame), and sway a little otherwise. Their shadows are on from High; they are not animated in the shadow pass.

| Tier | Terrain layers (size) | Normals | Triplanar rock | Anisotropy | Road normal | Crowd share | Flags | Crowd shadows | Guardrails and paint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Low | 3 (512) | no | no | 2 | no | 0.35 | no | no | yes |
| Medium | 7 (1K) | no | yes | 4 | yes | 0.7 | yes | no | yes |
| High | 7 (1K) | yes | yes | 8 | yes | 1 | yes | yes | yes |
| Ultra | 7 (1K) | yes | yes | 16 | yes | 1 | yes | yes | yes |


## Terrain

[`src/world/terrain.ts`](../../src/world/terrain.ts) builds the ground in **200 m square tiles**, on a 4 m grid. Tiles whose center is within **1,150 m** of the rider are kept.

- **Height** is a function of world position only, so neighboring tiles always line up.
- **Near the road** (within about 260 m), the ground follows the road's own elevation, blending out to the stage's "wild" terrain. Where two stretches of road are close together (stacked hairpins), the height blends between them.
- **Color** depends on height and slope: grass, fields (where the stage allows), rock above the rock line, and snow above the snow line. Steep ground darkens, and cliffs turn to rock. The tiles are smooth-shaded.
- **Desert palette.** A stage whose scenery has `palette: 'desert'` (the Tour of the Moon) colours the ground in thin bands of red, orange and tan sandstone with sand and sage patches, turns cliffs dark red, and plants sparse junipers (70 candidate points per tile) instead of forest. Its wild terrain is stepped into mesas by `terrace()` in `stages.ts`.
- **Trees** are scattered at 260 candidate points per tile. Forests are dense where the forest noise is high. Trees are removed within 12 m of the road and near landmarks, and above the tree line.
- **Standing things on the ground.** `groundSampler(minX, maxX, minZ, maxZ)` returns a height lookup for a box, for things placed beside the road (guardrails use it to find drops).

The first frame builds every tile in range at once. After that, at most two tiles are built per frame.

### Texture splatting

Each vertex also carries **seven layer weights** (`aWa`, `aWb`, one byte each): grass, dry grass, dirt, rock, snow, sandstone, sand. `groundColor()` fills them from the same logic as the colour, so a stage still looks like itself: grass with dry grass in the bright patches and wherever the stage has fields; the verge (within 6 to 9 m of the road) is dirt; rock and snow take over by height and the stage's `rockLine` and `snowLine`; the desert is sandstone under a skin of sand, with sage patches as dry ground.

The splatting itself is [`src/world/ground.ts`](../../src/world/ground.ts), a lazily loaded chunk (`Terrain.setScenery()` imports it after the first frame; until then, and if it fails to load, the plain vertex colours show). It patches the terrain's `MeshStandardMaterial` (`onBeforeCompile`):

- **The vertex colour stays.** Each layer's texture is divided by its own average colour, greyed a little and scaled by a per-layer contrast, and the blend multiplies the vertex colour. The photographs add grain, never a different hue, so the palettes survive.
- **Textures** come from one `DataArrayTexture` (7 layers, mipmapped, anisotropic) for the colour and one for the detail normals (512 px). Ground layers are projected from above at 4 to 6 m per repeat. A large-scale noise tint (90 m and 26 m) hides the tiling from a distance, and the grain fades out beyond about 160 to 600 m.
- **Rock is triplanar**, and any pixel steeper than about 40° turns to rock (judged per pixel from the smooth normal), so cliffs never stretch. With normals (High and up) rock's normal map is blended triplanar (whiteout) and the other layers' normals are projected from above and fade out beyond 60 to 260 m.
- **Lazy and per stage.** One JPEG per layer in `public/textures/terrain/` (`grass.jpg`, `grass-n.jpg` …), fetched and decoded a layer at a time, then uploaded once. Only the layers a stage can show are fetched (`layersFor()`: no sandstone on the Alpe, no snow where the snow line is out of reach, no grass in the desert). Sources and licences are in [`public/textures/README.md`](../../public/textures/README.md); all are CC0 (Poly Haven).
- **Per tier** (`TIER_SPECS[tier].scenery`, see [`scenery.ts`](../../src/world/scenery.ts)): Low fetches **three layers** (grass, rock and snow, or sandstone and rock in the desert; dry grass and dirt fold into grass, sand into sandstone), shrinks them to 512 px while decoding, has no normals and projects rock along one horizontal axis instead of three. Medium has all seven layers at 1K with triplanar rock. High and Ultra add the detail normals. Anisotropy is capped at 2, 4, 8 and 16.

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

[`src/world/landmarks.ts`](../../src/world/landmarks.ts) loads the GLB models and places them along the road.

Each stage lists its landmark kinds in `src/stages.ts`. A kind is a `LandmarkKind`:

| Field | Meaning |
| --- | --- |
| `file` | The GLB file in `public/models/`. |
| `every` | Meters between repeats. |
| `first` | Distance of the first one. |
| `side` | `-1` left, `1` right, `0` on the road. |
| `span` | For `side: 0` only: `across` for an arch, `along` for a bridge the road runs through. |
| `offset` | Meters from the centerline. |
| `size` | Target height in meters (or width, for road-spanning kinds). |
| `yaw` | Extra turn after facing the road. |
| `clearance` | Meters of tree-free space around it. |

Models are scaled to `size`, centered, and stood on the ground. Models are placed between 250 m behind and 1,500 m ahead. A model file is fetched the first time a landmark that uses it comes into that range, not all at start-up (the nine files are 7.5 MB, and a stage uses only some of them), so a rider only downloads the models for the stages they ride. A missing file is skipped, and the console logs *Landmark model not found*.

The farm landmarks used on lowland stages and most GPX routes are in `FARM_LANDMARKS` in `src/stages.ts`.

### Adding a model

1. Put the `.glb` file in `public/models/`. Keep it under about 15,000 triangles, as [`public/models/README.md`](../../public/models/README.md) suggests.
2. Add a `LandmarkKind` for it to the `landmarks` array of the stages where it should appear, or to `FARM_LANDMARKS` if it belongs on every lowland stage. The file name must match exactly.
3. Load the page and check the model appears at the right place. It appears only once it's referenced by a stage.

`public/models/README.md` says files placed in that folder "appear beside the road". That's only true for files a stage refers to. A GLB in the folder does nothing on its own.

## Performance

- Terrain and road are built in chunks and tiles, and only the ones near the rider exist. Tiles, road chunks and landmarks are created as the rider approaches and removed once they fall behind.
- Shadows are limited to a 60 m box around the rider.
- Relative frame cost per tier, measured in headless Chromium's software renderer at 800 × 500 (so a guide to the extra work, not to a real GPU): Low 1.0, Medium 1.2, High 1.8, Ultra 2.3.
- Quality is per device (see [Graphics tiers and post-processing](#graphics-tiers-and-post-processing)): Low draws straight to the screen with no post-processing, and the whole post chunk (about 50 kB gzip of three addons plus 2 kB of ours) is only fetched on Medium and up.
- Changing stage clears the terrain and landmarks, and rebuilds them for the new stage.
