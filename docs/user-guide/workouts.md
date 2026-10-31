# Workouts

This page covers the built-in workouts, how a workout runs in ERG mode, the workout panel, the ramp test that estimates your FTP, uploading workout files, the workout creator and `.zwo` export.

## The workout library

Click **🏋 Workouts** to open the library. Every workout shows its name, length, estimated TSS and a small graph of its shape. Each card has these buttons:

- **Ride** starts the workout.
- **Copy & edit** (built-ins) or **Edit** (your own) opens the creator.
- **.zwo** downloads the workout as a Zwift-compatible file.
- **🗑** deletes a workout you uploaded or created. Built-in workouts can't be deleted.

Each card is badged **Built-in**, **Uploaded** or **My workout**.

Workouts are percentages of your FTP, so they scale to you. Set your FTP in [Settings](settings.md) first.

## Built-in workouts

| Workout | Length | What it is |
| --- | --- | --- |
| **Endurance 45** | 45 min | A ramp up, 32 minutes steady at 68% of FTP, then a ramp down. Mostly zone 2. |
| **Sweet Spot 3×10** | 60 min | Three 10-minute efforts at 90% of FTP, with 5-minute recoveries at 55%. |
| **VO2 Max 5×3** | 50 min | Two short warm-up efforts at 110% (30 seconds each), then five 3-minute efforts at 115% with equal recoveries. |
| **Over-Unders 3×9** | 51 min | Three sets of three over-unders: 2 minutes at 95% and 1 minute at 105%, with 4-minute steady recoveries between sets. |
| **Ramp FTP Test** | 27 min | Five minutes at 45%, then one-minute steps that rise by 6% of FTP each minute until you can't hold it. |

## Ride a workout

1. Click **Ride** on a workout card. The library closes.
2. The workout panel opens below the data blocks.
3. The workout clock runs only while you're pedaling and not paused.

If your trainer can take power targets, the app runs in **ERG mode**: the trainer holds the target power whatever your cadence, and the panel says so. If your trainer can't, the panel says *ride to the numbers*, and you match the target yourself. In demo mode the demo rider follows the target.

### The workout panel

| Control | What it does |
| --- | --- |
| Target | The current target in watts, with the step's name underneath. |
| Time left in step | The time left in the current step. |
| Next | The next step, its target and the workout's time left. |
| **⏸ / ▶** | Pauses or resumes the workout clock. |
| **⏭** | Skips to the next step. |
| **−5% / +5%** | Makes the target easier or harder, between 50% and 150% of the workout's intensity. |
| **✕** | Ends the workout after you confirm. The ride carries on as a free ride. |

Changing intensity scales every target, including the ones still to come.

### Finish a workout

When the last step ends, the summary shows the workout's time, average power, normalized power, TSS, energy and average heart rate. If you're signed in, the ride is saved with the workout's name.

## The ramp test and setting your FTP

The **Ramp FTP Test** estimates your FTP. It's 75% of your best one-minute power.

When the ramp test finishes, the summary shows **Est. FTP**, **Best minute** and a button, **Set my FTP to** the estimated value. Click it to save the new FTP. The change is recorded in your FTP history when you're signed in. See [Zones and FTP](zones-and-ftp.md).

The estimate only appears when the test runs to the end of its steps. If you stop early with **✕**, no summary appears and no estimate is offered. The clock only runs while you pedal, so keep pedaling, at any power, to reach the end.

## Upload a workout

Click **⬆ Upload** in the library, and choose one or more files:

- **`.zwo`**: Zwift workout files.
- **`.erg`** and **`.mrc`**: text workout files.

Uploaded workouts are saved in this browser, and synced to your account when you're signed in. A message names any file that can't be read, and gives the reason. For example, *Unsupported file type*, or *No power data found in this file*.

### How the files are read

- **`.zwo`** files: warm-ups, cool-downs and ramps become ramps. Steady and solid-state blocks become steady power. Interval blocks become intervals. Free-ride and max-effort blocks become free rides. Text messages and other elements are ignored.
- **`.erg`** and **`.mrc`** files: the power points define the workout, and power changes in a straight line between points. If the file has a `PERCENT` header, values are percentages. Otherwise they're watts, converted to a percentage of the file's FTP (or your FTP when the file has none).

## The workout creator

Click **＋ Create** in the library to build a workout from scratch, or **Copy & edit** to change a built-in one.

1. Enter a **Name** (up to 80 characters) and a **Description** (up to 300 characters).
2. Add blocks with **Steady**, **Ramp**, **Intervals** or **Free ride**.
3. Set each block's times and powers. Times can be typed as minutes (`5`), as `m:ss` (`1:30`), in seconds (`45s`), or as `h:mm:ss`. Powers are percentages of FTP, and the watts are shown next to them.
4. Reorder blocks with **↑** and **↓**, duplicate with **⧉**, or remove with **✕**.

The graph and summary update as you edit. The summary shows the total time, an estimated TSS and the average power in watts at your FTP.

When you're done:

- **Save** keeps the workout in your library.
- **Save & ride** saves it and starts it straight away.
- **Export .zwo** downloads it as a Zwift file.

A workout needs at least one block to be saved.

## Export a workout as .zwo

Use the **.zwo** button on a library card, or **Export .zwo** in the creator. The file uses Zwift's format, so it can be loaded into Zwift and other apps that read `.zwo`.

## Turn off ERG

Workouts control the trainer only while they run. When a workout ends, or you end it with **✕**, the trainer goes back to grade mode.
