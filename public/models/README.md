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

Models are scaled automatically (height for buildings, width for the gantry),
so any units work. Keep each under ~15k triangles for smooth riding.
