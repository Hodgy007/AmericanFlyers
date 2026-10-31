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
