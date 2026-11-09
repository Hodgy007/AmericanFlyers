# Textures

## `terrain/` and `asphalt-n.jpg` (round 6): Poly Haven, CC0

All of these are from [Poly Haven](https://polyhaven.com/), released under
[CC0 1.0](https://polyhaven.com/license) (public domain: free for any use, no attribution
required; the authors are credited here anyway). Downloaded as the 1K JPEG maps, then
re-encoded with ImageMagick (`-strip -interlace JPEG`, sRGB):

| File here | Poly Haven asset | Author(s) | Used as | Processing |
| --- | --- | --- | --- | --- |
| `terrain/grass.jpg`, `grass-n.jpg` | [Grass Ground](https://polyhaven.com/a/grass_ground) | Charlotte Baglioni | terrain layer 0, grass | diffuse 1024², JPEG q80, 4:2:0; normal (OpenGL) 512², q70, 4:4:4 |
| `terrain/dry.jpg`, `dry-n.jpg` | [Park Dirt](https://polyhaven.com/a/park_dirt) | Christopher Melani | layer 1, dry grass and fields | same |
| `terrain/dirt.jpg`, `dirt-n.jpg` | [Forest Ground 05](https://polyhaven.com/a/forest_ground_05) | Charlotte Baglioni | layer 2, dirt (the verge) | same |
| `terrain/rock.jpg`, `rock-n.jpg` | [Rock Face 03](https://polyhaven.com/a/rock_face_03) | Dario Barresi (photography), Rico Cilliers (processing) | layer 3, rock (triplanar on cliffs) | same |
| `terrain/snow.jpg`, `snow-n.jpg` | [Snow 02](https://polyhaven.com/a/snow_02) | Rob Tuytel | layer 4, snow | same |
| `terrain/sandstone.jpg`, `sandstone-n.jpg` | [Sandstone Cracks](https://polyhaven.com/a/sandstone_cracks) | Rob Tuytel | layer 5, red sandstone (desert) | same |
| `terrain/sand.jpg`, `sand-n.jpg` | [Sand 01](https://polyhaven.com/a/sand_01) | Rob Tuytel | layer 6, sand (desert) | same |
| `terrain/scree.jpg`, `scree-n.jpg` | [Gray Rocks](https://polyhaven.com/a/gray_rocks) | Dimitrios Savva | layer 7, scree (the bare limestone summit of Mont Ventoux) | same |
| `asphalt-n.jpg` | [Asphalt 01](https://polyhaven.com/a/asphalt_01) | Dario Barresi (processing), Charlotte Baglioni (photography) | the road's normal map | normal (OpenGL) 512², q72, 4:4:4 |

The terrain shader (`src/world/ground.ts`) uses each diffuse map only for its grain: the
texture divided by its own average colour, laid over the stage's own vertex colours. So the
photographs' hues don't matter and the stages keep their palettes.

The road's roughness is not a texture: `src/world/roadSurface.ts` derives it from the normal
map when the road is built (Poly Haven's roughness map for this asphalt is a flat grey).

The `-n` normal maps are only fetched on High and Ultra (the asphalt one from Medium up). On
Low the 1K diffuse files are shrunk to 512 as they decode, and only three layers are fetched.

## `asphalt.jpg` (earlier)

The road's colour texture, generated with Higgsfield for this project (see the changelog).
(The generated `grass.jpg` that used to sit beside it was replaced by the terrain layers above.)

## `horizon/` (panoramas)

`alps`, `pyrenees`, `rockies`, `desert` and `hills` (`.webp`, 1344x576 RGBA, plus `-low` at half size): far-mountain panoramas with the sky keyed out, generated with Higgsfield for this project and cleaned by `scripts/prep-horizon.py` (alpha eroded and softened, colour flooded under the transparent pixels, lossy WebP q80 with lossless alpha). Used by `src/world/horizon.ts` and `sky.ts`.
