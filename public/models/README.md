# Landmark models

GLB files placed here appear beside the road (see `src/world/landmarks.ts`).
Any that are missing are skipped.

| File | What | Where |
| --- | --- | --- |
| `gantry.glb` | Start/finish arch spanning the road | Just past the start, then every 5 km |
| `windmill.glb` | Farm windmill | Left, every 1.9 km |
| `barn.glb` | Red barn | Right, every 2.3 km |
| `farmhouse.glb` | Farmhouse | Left, every 2.3 km |
| `diner.glb` | Retro roadside diner | Left, every 3.7 km |
| `water-tower.glb` | Water tower | Right, every 4.1 km |
| `gas-station.glb` | Retro gas station | Right, every 4.3 km |
| `silos.glb` | Grain silos | Right, every 3.1 km |
| `covered-bridge.glb` | Covered bridge the road runs through | Every 6 km, from 4 km |

| `geant.glb` | Le Géant du Tourmalet: a steel cyclist out of the saddle on a rock plinth (11k triangles, 0.86 MB) | The Tourmalet's landmark (`monumentAt('geant-tourmalet', ...)`); the code-built statue in `monuments.ts` stands in if the file is missing |
| `camper.glb` | White camper van (4.4k triangles, 0.4 MB, cab at +x) | The roadside camp's vans on Medium and up, instanced (`campers.ts`); the box vans are used on Low and until it loads |
| `ventoux-summit.glb` | Mont Ventoux's weather station and the red-and-white banded mast (20k triangles, 1 MB) | The Ventoux observatory landmark (`monumentAt('ventoux-observatory', ...)`); the code-built one in `monuments.ts` stands in if the file is missing |

`geant.glb`, `camper.glb` and `ventoux-summit.glb` were generated with Higgsfield (Tripo meshes) and shrunk with `npx @gltf-transform/cli resize` (textures to 1024 and 512, 512 for the Géant's roughness map); the app's `GLTFLoader` has no Draco or Meshopt decoder, so they use no mesh compression. `ventoux-summit.glb` was also run through `simplify` (1.99M triangles to 20k).

Not everything is a GLB: the summit buildings, memorials, village church, ski apartments, summit signs
and the Flatirons are built in code from primitives (see `src/world/monuments.ts`), so no file
here belongs to them.

Models are scaled automatically (height for buildings, width for the gantry),
so any units work. Keep each under ~15k triangles for smooth riding.
