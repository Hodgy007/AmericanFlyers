# Zones and FTP

This page gives the exact heart-rate and power zone boundaries, explains how time in each zone is counted, and describes the per-ride and all-time totals and the FTP history.

## Heart-rate zones

Heart-rate zones are percentages of your **max heart rate** (set in [Settings](settings.md), default 185 bpm).

| Zone | Name | From | Example at 185 bpm |
| --- | --- | --- | --- |
| Z1 | Recovery | 0% | 0 to 110 bpm |
| Z2 | Endurance | 60% | 111 to 129 bpm |
| Z3 | Tempo | 70% | 130 to 147 bpm |
| Z4 | Threshold | 80% | 148 to 166 bpm |
| Z5 | Maximum | 90% | 167 bpm and above |

## Power zones

Power zones are percentages of your **FTP** (set in [Settings](settings.md), default 200 W).

| Zone | Name | From | Example at 200 W |
| --- | --- | --- | --- |
| Z1 | Recovery | 0% | 0 to 109 W |
| Z2 | Endurance | 55% | 110 to 149 W |
| Z3 | Tempo | 75% | 150 to 179 W |
| Z4 | Threshold | 90% | 180 to 209 W |
| Z5 | VO2 max | 105% | 210 to 239 W |
| Z6 | Anaerobic | 120% | 240 W and above |

The HUD's power tiles use the same boundaries, so the zone name shown under **Power** matches the summary.

## How time in zone is counted

- Time counts only while you're **moving**: when your speed is above about 0.3 m/s, or your power is above zero.
- Each frame adds the time since the last frame to the zone that your current power (or heart rate) is in.
- Heart-rate time is only counted while a heart-rate reading is fresh. Without heart rate, the heart-rate zones stay empty.
- Power zones use your FTP as it was set during the ride.

Ride summaries show the zones for that ride as bars: the time in each zone, and its share of the total.

## Ride totals and all-time totals

- **Each ride** has its own zone bars, in its summary and in the **Rides** tab of your profile. Each ride keeps the max heart rate and FTP it was worked out from.
- **All rides** appear in the **Stats** tab of your profile. The zone bars there add up every ride's zone time. The labels show your current max heart rate and FTP, and a note under the bars says that each ride used the values it was recorded with.

## FTP history

Your FTP changes are recorded in your account when you're signed in. Each change has a source:

| Source | When it's recorded |
| --- | --- |
| **Set by hand** | You change FTP in Settings. |
| **Ramp test** | You click **Set my FTP** after a ramp test. |
| **Starting FTP** | The first time your account is created, from the settings on that browser. |

The **Stats** tab charts your FTP over time and shows the change since the first entry. Changes made while signed out aren't recorded, but your settings are.

The **Getting stronger** achievement uses this history. See [Achievements](achievements.md).

## Estimating FTP

The ramp test in [Workouts](workouts.md) estimates FTP as 75% of your best one-minute power. A ramp test is the simplest way to set a new FTP, but you can also type a number in Settings.
