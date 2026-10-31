# Data blocks

This page explains how to choose and order the numbers across the top of the screen, and what each of the 24 fields shows.

## Choose and order your blocks

1. Click the **✎** button at the right of the data blocks.
2. Tick the fields you want. Untick a field to remove it.
3. Use the **↑** and **↓** arrows to move a selected field up or down. The first field is shown large, and the list shows its position (**Large**, **#2**, **#3** and so on).
4. Click **Reset** to go back to the default eight, or **Save** to keep your choice.

You can show up to **12** blocks. The counter at the top of the dialog shows how many you've chosen. Your choice is saved in this browser, and in your account when you're signed in.

The default blocks are **Power, Cadence, Speed, Heart rate, Distance, Time, Grade** and **Climbed**.

With more than eight blocks, the row wraps onto two lines, and the large block spans both.

## The 24 fields

Power is shown as the average over the last 3 seconds, unless the field says otherwise. Units follow your setting in [Settings](settings.md): km or mi, km/h or mph, m or ft.

| Field | What it shows |
| --- | --- |
| Power | Your average power over the last 3 seconds, in watts. The tile is colored by power zone, and the zone name is shown underneath. |
| Power (1 s) | Your power from the latest reading, in watts. Colored by power zone. |
| W/kg | Your 3-second power divided by your rider weight, to one decimal place. |
| Avg power | Average power over your moving time, in watts. |
| Norm. power | Normalized power for the ride so far, in watts. See [Physics and stats](../developer-guide/physics-and-stats.md). |
| Max power | The highest 1-second average power in the ride, in watts. |
| Target | The current workout's target, in watts. Shows `--` when there's no target. The tile is colored by zone and the step name is shown underneath. |
| Interval left | Time left in the current workout step. |
| Workout left | Time left in the current workout. |
| Cadence | Current cadence, in rpm. |
| Avg cadence | Average cadence while pedaling, in rpm. |
| Speed | Current speed, in km/h or mph. |
| Avg speed | Distance divided by moving time, in km/h or mph. |
| Heart rate | Current heart rate, in bpm. Shows `--` when there's no recent reading. |
| Avg HR | Average heart rate over the ride, in bpm. |
| Max HR | Highest heart rate in the ride, in bpm. |
| Distance | Distance ridden since you started (or since the `?start=` point), in km or mi. |
| To go | Distance left to the finish line, in km or mi. Shows `--` on endless stages. |
| Time | Moving time for the ride, as `m:ss` or `h:mm:ss`. |
| Grade | The road's grade where you are, as a percentage. The tile is colored by grade. |
| Climbed | Total height gained so far, in meters or feet. |
| Elevation | Your altitude, in meters or feet. On Alpe d'Huez, Stelvio Pass and GPX routes this is real altitude; on other stages it's height above the start. |
| Energy | Work done so far, in kilojoules. |
| TSS | Training stress score for the ride so far, estimated from normalized power and your FTP. |

## Tips

- Put the number you watch most in the first position. It's the big one.
- **Target**, **Interval left** and **Workout left** are only useful during a workout. They show `--` otherwise.
- **To go** only has a value on stages with a finish line.
