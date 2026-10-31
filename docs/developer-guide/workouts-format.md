# Workouts format

This page documents the internal workout model, how blocks expand into steps, the rules for importing `.zwo`, `.erg` and `.mrc` files, the `.zwo` export, and the TSS estimate.

Source: [`src/workouts/model.ts`](../../src/workouts/model.ts), [`src/workouts/player.ts`](../../src/workouts/player.ts), [`src/workouts/files.ts`](../../src/workouts/files.ts).

## The model

Power is stored as a **fraction of FTP** (0.75 means 75%). A workout is therefore independent of who rides it. The FTP is applied when the target is read.

```ts
type Block =
  | { kind: 'steady'; duration: number; power: number; cadence?: number }
  | { kind: 'ramp'; duration: number; from: number; to: number; cadence?: number }
  | { kind: 'intervals'; repeats: number; onDuration: number; onPower: number; offDuration: number; offPower: number; cadence?: number }
  | { kind: 'free'; duration: number };

interface Workout {
  id: string;
  name: string;
  description: string;
  blocks: Block[];
  source: 'builtin' | 'uploaded' | 'custom';
}
```

Durations are in seconds.

## Expansion into steps

`expand(blocks)` turns the blocks into a flat list of `Step`s, each with a start time (`at`), a duration, a start and end power fraction, a `free` flag, a label and an optional cadence:

- **steady**: one step, same start and end.
- **ramp**: one step, from `from` to `to`. Its label is *Ramp up* or *Ramp down*.
- **intervals**: `repeats` times, an *on* step (labeled *Interval r/n*) and an *off* step (labeled *Recovery r/n*, or *Surge r/n* when the off power is higher than the on power).
- **free**: one step with no target, at 50% for TSS purposes. Labeled *Free ride*.

Steps with zero duration are dropped.

`targetAt(steps, t)` returns the fraction at time `t`, interpolated along ramps. It returns `null` in free rides or after the end. `stepAt(steps, t)` finds the step at `t`.

## The player

`WorkoutPlayer` in `src/workouts/player.ts` runs the steps against the clock:

- `tick(dt, pedaling, power)` advances `elapsed` only while pedaling and not paused, and never past the end. It records a trace point every 2 seconds, with power as a fraction of FTP.
- `targetWatts()` returns `round(target × FTP × intensity)`, or `null` in free rides.
- `intensity` starts at 1. `nudge(±0.05)` changes it, clamped between 0.5 and 1.5.
- `skip()` moves `elapsed` to the end of the current step.
- `done` is true once `elapsed` reaches the duration.

## Built-in workouts

The five built-ins are defined in `BUILTIN_WORKOUTS`, with IDs `builtin-endurance-45`, `builtin-sweet-spot-3x10`, `builtin-vo2-5x3`, `builtin-over-unders` and `builtin-ramp-test`. The ramp test has the ID exported as `RAMP_TEST_ID`, and the finish screen checks it to offer the FTP estimate. The workout name *Ramp FTP Test* is also used by the **Tested** achievement.

Their durations, verified against the code, are 45, 60, 50, 51 and 27 minutes. See [Workouts](../user-guide/workouts.md#built-in-workouts) for the content.

## Import rules

`parseWorkoutFile(name, text, ftp)` picks the parser from the extension, case-insensitively, and throws *Unsupported file type* for anything else.

### `.zwo` (Zwift XML)

`parseZwo()` reads the `<workout>` element. Each child element becomes a block:

| Element | Block |
| --- | --- |
| `Warmup`, `Cooldown`, `Ramp` | `ramp`, from `PowerLow` to `PowerHigh` |
| `SteadyState`, `SolidState` | `steady`, at `Power` (or `PowerLow`) |
| `IntervalsT` | `intervals`, from `Repeat`, `OnDuration`, `OnPower` (or `PowerOnHigh`, `PowerOnLow`), `OffDuration` and `OffPower` (or `PowerOffHigh`, `PowerOffLow`) |
| `FreeRide`, `MaxEffort` | `free` |

Other elements, including text events, are ignored. Attributes are read by name, falling back to lower case. A number that comes out as `NaN` fails the import with *Couldn't read a <kind> step*. A file with no steps fails with *This .zwo file has no workout steps*. The workout's name comes from `workout_file/name`, falling back to the file name, and its description from `workout_file/description`.

Power values in `.zwo` are fractions of FTP, the same as the model.

### `.erg` and `.mrc` (text)

`parseErgMrc()` reads:

- **Header lines** `KEY = VALUE`. `FTP` sets the file's FTP. `FILE NAME` sets the name (without its extension). `DESCRIPTION` sets the description. A `MINUTES PERCENT` heading switches the values to percentages.
- **Course data** between `[COURSE DATA]` and `[END COURSE DATA]`. Each line that starts with two numbers is a point: minutes, then value.

Values are watts, converted to a fraction of the file's FTP, or of your FTP if the file has none. Power changes in a straight line between points. Points at the same time (vertical steps) are skipped. Consecutive points with equal power become a steady block; others become a ramp. A file with fewer than two points fails with *No power data found in this file*.

## `.zwo` export

`toZwo(workout)` writes:

```xml
<workout_file>
  <author>American Flyers</author>
  <name>…</name>
  <description>…</description>
  <sportType>bike</sportType>
  <workout>
    <SteadyState Duration="…" Power="…" Cadence="…"/>
    <Ramp Duration="…" PowerLow="…" PowerHigh="…"/>
    <IntervalsT Repeat="…" OnDuration="…" OffDuration="…" OnPower="…" OffPower="…"/>
    <FreeRide Duration="…"/>
  </workout>
</workout_file>
```

Power is written to three decimal places. Text fields are XML-escaped. The `Cadence` attribute is written only when the block has one. The download name removes characters that aren't allowed in file names.

## TSS estimate

`estimateTss(steps)` samples the target at every second of the workout (0.5 of FTP for free rides), and takes the fourth-power mean of those targets. With `NP` as the fourth root of that mean:

```
TSS = (duration / 3600) × NP² × 100
```

Targets are fractions of FTP, so the estimate doesn't need your FTP. The library and creator show it rounded to a whole number.

## IDs

`newId()` creates IDs of the form `w-<time in base 36>-<random>`. Imports and copies get a new ID. Editing a workout you own keeps its ID.
