# Physics and stats

This page documents the power-to-speed model in `src/physics.ts`, and how ride statistics are computed in `src/stats.ts`: averages, normalized power, TSS, best efforts, max values and zone accounting.

## Power to speed

`stepSpeed()` in `src/physics.ts` advances the rider's speed by one time step. It integrates the forces, rather than solving for steady-state speed. That's what gives momentum: you coast over a crest and gain speed on a descent, even with no power.

The constants:

| Constant | Value | Meaning |
| --- | --- | --- |
| `G` | 9.81 m/s² | Gravity. |
| `AIR_DENSITY` | 1.225 kg/m³ | Air density at sea level. |
| `DRIVETRAIN_EFFICIENCY` | 0.976 | Share of power that reaches the wheel. |
| `DEFAULT_PARAMS.cda` | 0.32 m² | Drag area, on the hoods. |
| `DEFAULT_PARAMS.crr` | 0.004 | Rolling resistance coefficient. |
| Wheel inertia | +1.5 kg | Added to the mass in the acceleration term. |

`DEFAULT_PARAMS.massKg` is 83, but the frame loop overrides it with your rider weight plus your bike weight (both from [Settings](../user-guide/settings.md)).

The forces each step:

- **Propulsion:** `P × 0.976 / max(v, 1.5)`. Dividing by speed would blow up at standstill, so speed is floored at 1.5 m/s for this term.
- **Gravity:** `m × g × sin(θ)`, where `θ = atan(grade)`.
- **Rolling resistance:** `crr × m × g × cos(θ)`, applied only above 0.01 m/s.
- **Air drag:** `½ × ρ × CdA × v²`.

The acceleration is `(propulsion − gravity − rolling − drag) / (m + 1.5)`, and the new speed is `v + a × dt`. Speed never goes below zero.

The grade is read from `course.ts` with a central difference over ±2 m, so a steep section that changes in a few meters still shows the right slope at the rider's position.

## Drafting

[`src/draft.ts`](../../src/draft.ts) works out how much air drag you save behind another live rider (ghosts make no wind). The gap is wheel to wheel: their distance minus yours minus a bike length (1.75 m). Riders alongside you (gap below 0) give no draft.

The saving follows wind-tunnel and CFD studies of two riders in line: about a third of the drag right on the wheel, falling to roughly a quarter at 2–3 m and fading to nothing by 12 m:

`saving = 0.36 × e^(−(gap − 0.3) / 4.2)`, eased to zero between 8 and 12 m.

| Gap | Drag saved |
| --- | --- |
| 0.5 m | 34% |
| 1 m | 31% |
| 2 m | 24% |
| 3 m | 19% |
| 5 m | 12% |
| 8 m | 6% |
| 12 m+ | 0% |

**Behind a group the draft is bigger.** Every rider from the wheel you're on to 15 m beyond it counts as the group, and the saving is scaled up from the one-wheel figure to the group's maximum:

`saving = one-wheel saving(gap) × groupMax(n) / 0.36`, with `groupMax(n) = 0.36 + 0.19 × (1 − e^(−(n − 1) / 1.6))`

| Riders in the group | Best saving | At 1 m | At 3 m |
| --- | --- | --- | --- |
| 1 | 36% | 30% | 19% |
| 2 | 45% | 38% | 24% |
| 3 | 50% | 42% | 26% |
| 4 | 52% | 44% | 27% |
| 6 | 54% | 46% | 28% |

These follow measurements of pacelines and small groups (third wheel 40–45%, back of a group of five or six 50–55%). Big pelotons shelter riders in the middle far more (90% or more), but groups here are small.

**Speed.** The percentage hardly changes with speed, but the watts it saves do, because air drag power grows with the cube of speed: on one wheel about 133 W at 45 km/h, 23 W at 25 km/h and 2 W on a 12 km/h climb.

The frame loop eases the saving over about 0.6 s (so it doesn't jump with each 2-second position update), and multiplies `cda` by `1 − saving` in `stepSpeed()`. With a smart trainer, the wind-resistance coefficient sent with the grade is scaled the same way, so the trainer gets lighter too (see [Bluetooth and FTMS](bluetooth-and-ftms.md)).

**Sideways.** `draftFrom()` takes an optional fourth argument, `{ lane, lateralOf(id) }`: your lane and a lookup of each rider's drawn lane (`OtherRiders.lateralOf`). The saving is multiplied by `lateralOverlap(offset)`: 1 within 0.3 m of their line, easing to 0 at 1.1 m. The rider you follow is the one that shelters you best, riders off your line don't count towards the group, and if nobody is on your line the nearest rider is returned with a saving of 0 and an `offset` (their lane minus yours), which the gauge uses for *Move ◀ into their wheel*. Without the argument the sideways part is ignored.

The draft gauge shows the gap to the rider ahead (within 60 m), the drag saved, and the watts that saves: `½ × ρ × CdA × v³ × saving / 0.976`. Riders you're following line up in your lane from 14 m back, as in a paceline, and pull aside when you overlap.

## Wind and echelons

[`src/world/wind.ts`](../../src/world/wind.ts) owns the wind: one shared `wind` object (`WindState`) with no DOM or Three.js. `setStage()` reads the stage's wind (optional `Stage.wind`, else the `STAGE_WINDS` table for the built-in stages, else a mild one picked from the stage id); `setWeather()` scales it (clear 0.6, cloudy 1, rain 1.5) and sets the gustiness; `update(dt)` eases the mean towards that, adds gusts (a sum of sines, so it is deterministic) and a slow swing in direction. Angles are on the ground plane like `headingAt` (0 = +x). `wind.at(heading)` returns `head` (m/s into the face, negative for a tailwind) and `cross` (m/s towards the rider's right, positive when it blows from the left). The frame loop in `main.ts` steps it with the weather being shown (`World.weather`), once per frame.

- **Drag** uses air speed: `stepSpeed(speed, power, grade, dt, params, headwindMs = 0)` computes drag from `speed + headwind`, signed so a strong tailwind pushes. The old five-argument call is unchanged.
- **Trainer**: `Trainer.setGrade(grade, windFactor = 1, headwindMs = 0)` writes the headwind (0.001 m/s units, positive = headwind) into the FTMS Indoor Bike Simulation Parameters wind-speed field. `controlTrainer()` resends when it moves by half a metre per second.
- **Echelons**: `draftShift(cross)` = 0.25 m per m/s of crosswind, capped at 0.8 m, the distance to the right of a rider's line where the shelter sits. `draftFrom(..., lateral)` takes it as the optional `lateral.shift`; the returned `offset` and `overlap` are then measured to the sheltered spot (this is what the draft gauge hint and auto-steer use). `echelonLane()` lays out the free-ride teams (`peloton.ts`) as two parallel diagonals; the race engine (`raceSim.ts`) takes an optional `wind(d)` in `SimOptions`, applies the headwind to every group and fans the lanes out into echelons of four rows. Without the option (the "simulate this stage" shortcut) the sim is in still air, as before.
- **Visuals**: clouds in `world/sky.ts` move with the wind (three times its speed, wrapping at the edge of the sky), and `world/rain.ts` slants the drops by half the wind speed. `windUi.ts` draws the wind chip.
- `?wind=<m/s>,<degrees>` forces the stage wind (the speed is the cloudy-day speed), for testing.

Wind changes leaderboard times a little, as the weather does: a stage's wind is mild by default (2–7 m/s on a cloudy day). It can be switched off in Settings.

## Mini-map and climb preview

[`src/miniMap.ts`](../../src/miniMap.ts) draws the mini-map on a canvas at about 5 Hz. For a stage with a finish it samples the centreline (`roadPoint`) once into at most about 1,500 points and keeps it; for an endless stage it draws the road from 600 m behind to 4 km ahead. North-up fits the whole route in the box; heading-up rotates the road by your heading and puts you low in the box. The orientation is remembered in `localStorage` (`americanflyers.mapMode`). [`src/climb.ts`](../../src/climb.ts) finds climbs from an elevation function (grade over 100 m of at least 3%, dips under 120 m joined, longer than 500 m, average at least 3%), and `climbStatus()` says whether one starts within 2 km or you're on one; [`src/climbUi.ts`](../../src/climbUi.ts) draws the card with `drawProfile()`. The Settings switch is `settings.miniMap`.

## Pro teams

[`src/peloton.ts`](../../src/peloton.ts) moves each team as one group with `stepSpeed()`: a 68 kg rider on a 7.5 kg bike at the team's W/kg (with slow ±5% surges), a pack drag area of 72% of a solo rider's, and 35% power on descents steeper than 4%. Riders sit two by two, 2.1 m between rows, in lanes just right of the centre line. They count as riders for drafting, so sitting on the back of a team saves you drag. Teams that pass a finish line by 120 m restart the stage. **Join** places you 2.5 m behind the last row at the group's speed.

The kits recolour the rigged rider in a fragment shader: navy texels become the team's first colour and red texels its second, keeping the texture's shading (see `applyKit()` in `src/world/rider.ts`).

## Virtual drivetrain and shifting

[`src/drivetrain.ts`](../../src/drivetrain.ts) keeps the rider's legs in step with the wheels. Normally it shifts automatically through a 50/34 × 11–34 set of gears toward your real cadence, one gear every 0.45 s with 8% hysteresis, and the cranks turn at `speed / (ratio × 2.105 m)` while you pedal. They ease to a stop when you freewheel.

With **Virtual shifting** on, the rider picks one of 24 gears from 0.75 to 4.8 (evenly spaced in ratio), and:

- the legs turn at the cadence that gear gives at your speed;
- an extra grade of `5.5 × ln(ratio / ratio of gear 12)`, clamped to −6…+9%, is added to the grade sent to the trainer, so harder gears push back harder;
- in a demo ride, the cadence shown follows the gear.

ERG workouts ignore the gear: the trainer holds the target power.

## Ride statistics

`RideStats` in `src/stats.ts` accumulates statistics while you're moving. Samples are taken each frame with the elapsed frame time (`dt`). Statistics use only moving time: `add()` returns early unless the frame counts as moving.

The frame loop calls `stats.add(dt, power, cadence, hr, moving)`, where `moving` is true when speed is above 0.3 m/s or power is above zero.

### Totals and averages

| Value | How it's computed |
| --- | --- |
| Moving time (`seconds`) | Sum of `dt` over moving frames. |
| Work (`work`, joules) | Sum of `power × dt`. |
| Average power | `work / seconds`. |
| kJ | `work / 1000`. |
| Average cadence | Time-weighted mean of cadence, over frames with cadence above zero. |
| Average HR | Time-weighted mean of heart rate, over frames with heart rate above zero. |
| Max power | Highest 1-second average (see below). |
| Max HR | Highest heart rate seen while moving. |

### One-second samples

Power is averaged into 1-second samples. Each sample is the mean power over one second of moving time. Any time beyond a full second carries into the next sample, so the averages don't drift with the frame rate. The app records these samples for normalized power, max power and best efforts.

### Normalized power

Normalized power is the fourth root of the mean of the fourth power of a 30-second rolling average:

```
NP = ( mean over samples of ( rolling30(p)^4 ) ) ^ (1/4)
```

It's calculated once 30 samples exist. Before then, NP falls back to average power.

### Best efforts

Best average power is kept for four windows: **5 s, 60 s, 300 s and 1200 s** (`BEST_WINDOWS`). For each window, the app keeps a rolling sum over the last 1,200 one-second samples, and records the highest average seen. The saved ride stores these as `best_power`, with keys `"5"`, `"60"`, `"300"` and `"1200"`.

The ramp test uses the best one-minute average. See [Workouts](../user-guide/workouts.md#the-ramp-test-and-setting-your-ftp).

### TSS

```
TSS = (moving time in hours) × (NP / FTP)² × 100
```

The saved ride stores TSS to one decimal place. Workout previews estimate TSS differently, from the targets; see [Workouts format](workouts-format.md#tss-estimate).

## Zone accounting

Each frame adds `dt` to one heart-rate zone and one power zone, based on the current reading:

- **Power zone:** `power / FTP` looked up in the power zone boundaries. Counted only when FTP is above zero.
- **Heart-rate zone:** `hr / max HR` looked up in the heart-rate boundaries. Counted only when a heart-rate reading is fresh.

The boundaries are in [`src/zones.ts`](../../src/zones.ts). See [Zones and FTP](../user-guide/zones-and-ftp.md) for the values.

Zone time is in seconds, one value per zone. It's saved with the ride as `hr_zones` and `power_zones`, and `max_hr_setting` records the max HR used, so later changes don't rewrite old rides.

## Where the numbers appear

- **HUD:** averages, NP, max, TSS and energy come straight from `RideStats`. The 3-second **Power** tile is a separate rolling average of the frame readings, not a `RideStats` value.
- **Summaries:** the ride summary and finish screen read the same `RideStats` object.
- **Workouts:** a workout has its own `RideStats` instance, which only counts while you're pedaling and not paused.

## Accuracy notes

- Speed is an estimate from the model, not a measurement. Real trainers differ, so the speed shown is only as good as the constants and your weight.
- Statistics depend on the trainer's power readings. Between readings, the app holds the last value for each frame, so a trainer that reports slowly produces flat stretches in the averages.
