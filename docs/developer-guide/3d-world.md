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
| [`quality.ts`](../../src/world/quality.ts) | The tiers and `TIER_SPECS` (what each switches on), the render scales, the saved choice, and `pickAutoTier(signals)`. Pure. |
| [`adapt.ts`](../../src/world/adapt.ts) | `Adapter`, the frame-time controller. Pure; its own small chunk, loaded just after the first frame. |
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

**Auto: the starting tier** (`pickAutoTier`, from `Signals`):

- Software renderers (the WebGL renderer string contains SwiftShader, llvmpipe, lavapipe, software…) → **Low**, with shadows off.
- Phones (touch screen, short side under 700 px) and mobile GPU strings (Mali, Adreno, PowerVR, Apple GPU…) → **Low**; a phone with 8+ cores and 6+ GB → Medium. Tablets (touch, bigger screen) and integrated Intel/old AMD/NVIDIA GPUs → **Medium**.
- Other desktops → **High**; a strong GPU (RTX 20-series 60/70/80 and 30/40/50, RX 5700 and up, Apple M Pro/Max/Ultra, Arc A5xx and up, GTX 1060 and up) with 8+ cores and 8+ GB → **Ultra**.
- Then caps: 2 cores or less, or 2 GB or less → Low; 4 cores or less, or 4 GB or less → at most Medium; a canvas over 8 million physical pixels (4K) without a strong GPU → one tier lower.

**Auto: adapting** (`Adapter.push(now, frameMs, workMs)`, one call per drawn frame):

- Frame times are not judged during a 4 s warm-up, after a change (6 s cool-down), after a resize, in the hub orbit (its frames are throttled on purpose) or in a hidden tab; gaps over 400 ms are dropped.
- **Slow:** median frame over the last 3 s above 22 ms → one step down: render scale 1 → 0.85 → 0.7, then the next tier down (scale back to 1), then shadows off.
- **Headroom:** over 10 s, median frame under 11 ms, or under 19 ms with a median render-call time under 4.5 ms (a 60 Hz display can't show frames shorter than 16.7 ms, so CPU time in the render call stands in for spare time) → one step up, in the reverse order, never above the Auto pick, and not within 30 s of a step down. A step up that is undone within 45 s makes the next attempt wait 1, 2, 5 and then 10 minutes.
- A **fixed tier** only moves the render scale (same rules), never the tier.
- `?adapt=off` freezes the controller (for measuring a tier as it is).

`window.__afGraphics` returns `{ tier, choice, autoTier, scale, pixelRatio, fps, post, shadows, gpu, change }` for tests and screenshots.

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

- The road is 9.2 m wide (4.6 m either side of the centerline), with a shared asphalt texture. Gravel shoulders, edge lines and a dashed center line are painted into the texture.
- Each chunk covers 100 m, sampled every 2 m. Chunks are built from 150 m behind the rider to 1,600 m ahead, and removed when they fall outside that range.
- Each chunk has a white-and-red post every 100 m, and a distance sign every `markers.every` meters. On stages with a finish, signs count down to the finish.
- A **checkered line** is painted across the road at the finish distance.
- Hairpin plaques are placed at the distances the stage defines in its `signs` list. Each shows the local word (**Virage** or **Tornante**) and the number.

## Terrain

[`src/world/terrain.ts`](../../src/world/terrain.ts) builds the ground in **200 m square tiles**, on a 4 m grid. Tiles whose center is within **1,150 m** of the rider are kept.

- **Height** is a function of world position only, so neighboring tiles always line up.
- **Near the road** (within about 260 m), the ground follows the road's own elevation, blending out to the stage's "wild" terrain. Where two stretches of road are close together (stacked hairpins), the height blends between them.
- **Color** depends on height and slope: grass, fields (where the stage allows), rock above the rock line, and snow above the snow line. Steep ground darkens, and cliffs turn to rock.
- **Desert palette.** A stage whose scenery has `palette: 'desert'` (the Tour of the Moon) colours the ground in thin bands of red, orange and tan sandstone with sand and sage patches, turns cliffs dark red, and plants sparse junipers (70 candidate points per tile) instead of forest. Its wild terrain is stepped into mesas by `terrace()` in `stages.ts`.
- **Trees** are scattered at 260 candidate points per tile. Forests are dense where the forest noise is high. Trees are removed within 12 m of the road and near landmarks, and above the tree line.

The first frame builds every tile in range at once. After that, at most two tiles are built per frame.

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
