# 3D world

This page covers the Three.js setup in `src/world/`: the renderer and lights, the cameras, the terrain tiles, the road, the rider rig, the sky, the landmarks, and how to add a model.

Source: [`src/world/`](../../src/world/).

## Renderer and lights

`World` in [`src/world/world.ts`](../../src/world/world.ts) creates the renderer:

- `WebGLRenderer` with antialiasing and a high-performance preference.
- Pixel ratio capped at 2.
- Soft shadows (`PCFShadowMap`).
- ACES filmic tone mapping, with exposure 1.05.

Lighting:

- A **hemisphere light** (sky blue above, green-brown below, intensity 1.1).
- A **directional sun** (`#fff4e0`, intensity 2.6). Its shadow map is 2048 × 2048, and covers a 60 m box centered on the rider. The sun's position follows the rider each frame.

Fog runs from 180 m to 1,150 m, in the horizon color, so distant terrain fades into the haze.

## Cameras

The camera is a perspective camera with a 55° field of view, and near and far planes at 0.1 m and 6,000 m. **C** or the camera button cycles the modes in this order:

| Mode | Position | Look target |
| --- | --- | --- |
| `chase` | 5.2 m behind, 2.1 m up, 0.5 m right of the rider | Ahead on the road, blended toward the rider |
| `side` | 4.2 m to the right of the rider, 1.1 m up | The rider |
| `rider` | Just in front of the rider's head | 12 m ahead on the road |

The rider rides on the right of the road, 1.9 m from the centerline. In `rider` mode the rider model is hidden.

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
- **Trees** are scattered at 260 candidate points per tile. Forests are dense where the forest noise is high. Trees are removed within 12 m of the road and near landmarks, and above the tree line.

The first frame builds every tile in range at once. After that, at most two tiles are built per frame.

## Rider and bike

[`src/world/rider.ts`](../../src/world/rider.ts) builds the bike from primitives: frame tubes, wheels that turn at the virtual speed, drop bars, saddle, cranks and pedals.

The rider is loaded from `models/rider.glb`. The model has a 24-bone skeleton, and the app poses it every frame with two-bone inverse kinematics:

- **Arms** reach to the hoods, with the elbow bending down and out.
- **Legs** follow the pedals at the rider's cadence, with the foot on the pedal.
- **Torso** leans forward on the bike, and the head tilts up to look along the road.

The rig needs these bone names: `Hips`, `Spine02`, `Spine01`, `Spine`, `neck`, `Head`, `head_end`, `Left` and `Right` `Arm`, `ForeArm`, `Hand`, `UpLeg`, `Leg`, `Foot` and `ToeBase`. A missing bone throws an error, so keep the names when you replace the model.

If `rider.glb` fails to load, the built-in primitive rider is used instead. The console logs *Rider model not found* and carries on.

## Sky

[`src/world/sky.ts`](../../src/world/sky.ts) builds three things, all following the camera:

- **A sky dome** with a gradient from the horizon to the zenith, and a sun glow in the sun's direction.
- **A mountain ring** of 160 segments at radius 3,600 m. Its height is set per stage by `mountainScale`, and its peaks lighten toward snow.
- **Clouds**: 26 clusters of flat-shaded spheres, 1,600 to 3,400 m from the center and 380 to 760 m up, drifting slowly.

The sky group follows the camera, but sits 60 m lower, so the horizon stays put on climbs.

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

Models are scaled to `size`, centered, and stood on the ground. Models are placed between 250 m behind and 1,500 m ahead. A missing file is skipped, and the console logs *Landmark model not found*.

The farm landmarks used on lowland stages and most GPX routes are in `FARM_LANDMARKS` in `src/stages.ts`.

### Adding a model

1. Put the `.glb` file in `public/models/`. Keep it under about 15,000 triangles, as [`public/models/README.md`](../../public/models/README.md) suggests.
2. Add a `LandmarkKind` for it to the `landmarks` array of the stages where it should appear, or to `FARM_LANDMARKS` if it belongs on every lowland stage. The file name must match exactly.
3. Load the page and check the model appears at the right place. It appears only once it's referenced by a stage.

`public/models/README.md` says files placed in that folder "appear beside the road". That's only true for files a stage refers to. A GLB in the folder does nothing on its own.

## Performance

- Terrain and road are built in chunks and tiles, and only the ones near the rider exist. Tiles, road chunks and landmarks are created as the rider approaches and removed once they fall behind.
- Shadows are limited to a 60 m box around the rider.
- Changing stage clears the terrain and landmarks, and rebuilds them for the new stage.
