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
| `rider.glb` | The rider: a rigged cyclist (24-bone skeleton, 14.8k triangles, 0.9 MB, 1.78 m, facing +z) in the navy-and-red kit the kit shader recolours | Every rider on the road, cloned per rider and posed by IK (`world/rider.ts`); the primitive rider stands in if the file is missing |
| `camper.glb` | White camper van (4.4k triangles, 0.4 MB, cab at +x) | The roadside camp's vans on Medium and up, instanced (`campers.ts`); the box vans are used on Low and until it loads |
| `ventoux-summit.glb` | Mont Ventoux's weather station and the red-and-white banded mast (20k triangles, 1 MB) | The Ventoux observatory landmark (`monumentAt('ventoux-observatory', ...)`); the code-built one in `monuments.ts` stands in if the file is missing |
| `raven-keep.glb` | Raven Keep: a ruined three-storey limestone tower with a broken top corner, ivy and an arched door, on its own rocky outcrop (14.4k triangles, 0.51 MB; 14.4 m by 14 m by 20 m as placed) | Kestrel Vale: a `world` landmark on a crag 26 m above the slope, 130 m beyond the outside of hairpin 5 of the Raven Scar climb and some 30 m above it, seen ahead from Scar 2 and Scar 4 (`cragGround` in `worlds/kestrelVale.ts`); door to the zigzag below |
| `kestrel-boathouse.glb` | A small stone boathouse, slate roof, a big arched timber water door in the front gable (12.6k triangles, 0.47 MB; 9.2 m wide, 10.7 deep, 8.5 high as placed) | Kestrel Vale: at the shore of Kestrel Water 110 m before the jetty (lap metre 2,140), the front half over the water line and the door turned 0.6 rad back towards oncoming riders |
| `hollins-cross-inn.glb` | The Hollins Cross Inn: a two-storey Dales stone pub, slate roof, two chimneys, sash windows, a porch, "THE HOLLINS CROSS INN" board and a hanging sign (12.5k triangles, 0.45 MB; 12.1 m wide, 9.6 deep, 10.5 high as placed) | Kestrel Vale: first building on the left of the high street after the market cross (lap metre 40), its front in line with the terraces' (16.5 m from the centreline) |

`rider.glb` was designed as front, side and back views with Higgsfield (GPT Image), built from all four views with Tripo H3.1 multiview (detailed), turned to face +z and scaled to 1.78 m, rigged with Meshy's humanoid rigging (the same bone names as before), then shrunk with `npx @gltf-transform/cli resize` (1024) and `webp`, its metal/roughness map dropped for a matte roughness 0.8 like the old model. `geant.glb`, `camper.glb` and `ventoux-summit.glb` were generated with Higgsfield (Tripo meshes) and shrunk with `npx @gltf-transform/cli resize` (textures to 1024 and 512, 512 for the Géant's roughness map); at that time the app's `GLTFLoader` had no mesh decoder. `ventoux-summit.glb` was also run through `simplify` (1.99M triangles to 20k).

`raven-keep.glb`, `kestrel-boathouse.glb` and `hollins-cross-inn.glb` were made for Kestrel Vale (milestone 5 of its plan) with Higgsfield: a GPT Image 2.5 front view of each on a plain background (0.25 credits each), turned into a mesh with Tripo H3.1 image-to-3D (standard geometry, face limit 15k; 9 credits each; 27.75 credits in all), then shrunk with `npx @gltf-transform/cli resize 1024`, `webp --quality 82` and `meshopt --level medium` (the same packing as above). Tripo's models come out facing +x; each was **turned -90 degrees about y in its file** (one `rotation` on the root node, so the front faces +z as the app's landmarks expect and `yaw` and `side` work as they do for every other model) with the glTF-Transform API, which keeps the Meshopt and WebP packing.

Not everything is a GLB: the summit buildings, memorials, village church, ski apartments, summit signs
and the Flatirons are built in code from primitives (see `src/world/monuments.ts`), so no file
here belongs to them.

Models are scaled automatically (height for buildings, width for the gantry),
so any units work. Keep each under ~15k triangles for smooth riding.

## Compression

Every model except `rider.glb` is packed with Meshopt and WebP textures, which roughly halves it (the twelve files went from 9.4 MB to 4.1 MB):

```bash
npx @gltf-transform/cli webp in.glb tmp.glb --quality 82
npx @gltf-transform/cli meshopt tmp.glb out.glb --level medium
```

The app loads every `.glb` through `gltfLoader()` in `src/world/gltf.ts`, which has the Meshopt decoder, so packed and plain files both work. `rider.glb` is left unpacked: Meshopt quantizes texture coordinates, and the kit shader that draws the jersey and the stars on the shorts reads them raw.
