# Stages and routes

This page covers the built-in stages, how finish lines work, how to upload your own GPX routes, and how to delete them.

## Choosing a stage

Click **🏁 Stage** to open the stage picker. Each card shows the stage's profile, name, distance, climbing and a one-line description. The stage you're on is highlighted. Click a card to ride it.

Choosing a stage resets the ride. If your current ride is at least a minute long and not yet saved, it's saved first (when you're signed in).

## Built-in stages

| Stage | Distance | What it is |
| --- | --- | --- |
| **Heartland Rollers** | Endless | Rolling farmland with no finish line. A free ride. Farm buildings, a covered bridge and a start arch line the road. |
| **Route 66 Flats** | 25 km | A time-trial along a flat, fast stretch of highway past diners and gas stations. Finishes at a checkered line under an arch. |
| **Hell of the West** | 20.8 km | The final stage of the 1985 film *American Flyers*, filmed on Colorado 103 from Idaho Springs (2,293 m) up Chicago Creek to the sprint at Echo Lake (3,235 m), below Mount Evans. About 3.5% for the first 11 km, then 5.8%, with switchbacks in the upper half and a flat finish at the lake. Totals from published figures; the per-kilometer shape is approximated. |
| **Alpe d'Huez** | 14 km | Climbs from Le Bourg-d'Oisans (723 m) up 1,118 m of gain, at an average of about 8%. It has 21 numbered hairpins, marked with **Virage** plaques. The gradients follow published per-kilometer figures from swi-cycling.com. |
| **Stelvio Pass** | 24.5 km | Climbs from Prato allo Stelvio (about 915 m) at an average of 7.5%, through 48 numbered hairpins marked **Tornante**. The summit is at 2,758 m. The per-kilometer shape is an approximation, because no per-kilometer source was found. |

| **Mont Ventoux** | 21.4 km | From Bédoin (300 m) to the summit (1,910 m) at 7.5%: vineyards, then 9–10% through the forest to Chalet Reynard, then the bare white limestone to the top. Per-kilometer shape approximated. |
| **Col du Tourmalet** | 19 km | From Luz-Saint-Sauveur (711 m) to the col (2,115 m) at 7.4%, steeper through the hairpins above Barèges (**Virage**). Per-kilometer shape approximated. |
| **Monte Zoncolan** | 10.1 km | From Ovaro (525 m) to 1,735 m at 11.9%, with long stretches at 13–15% and hairpins marked **Tornante**. Per-kilometer shape approximated. |

On every climb the elevation readout shows real altitude. Hairpins count down from the bottom: the first you reach is the highest number.

## Finish lines

On a stage with a finish line:

- The status line counts down the distance to go, and shows the next numbered hairpin with the distance to it.
- The **To go** data block shows the same distance, if you've added it.
- A checkered line runs across the road under the finish arch.
- Crowds cheer over the last 700 m, and a fanfare plays at the line.
- When you cross the line, the ride ends with a finish screen. The ride is saved when you're signed in.
- If you rode from the start line, your time goes on the stage's leaderboard, and the summary compares it with the ghost you were racing. See [Leaderboards and ghosts](leaderboards-and-ghosts.md).

You can carry on riding after the finish screen with **Keep riding**. **Ride it again** starts the stage over.

## Your own routes (GPX)

You can practice any route you've exported as a GPX file.

### Upload a route

1. Export the route as a GPX file from your app. The README names Strava, Komoot, RideWithGPS and Garmin. Menu names change, so look for the export or download option in each app's help.
2. Click **🏁 Stage**, then **⬆ Upload GPX route**.
3. Choose one or more `.gpx` files.

The last route you upload becomes your current stage straight away. Routes are listed under **Your routes**, below the built-in stages.

### What the app does with a route

- **Bends:** the road follows the route's track.
- **Elevation:** the height profile is smoothed, so GPS jitter doesn't create fake hills. Gradients are capped at **25%** in either direction.
- **Scenery:** lowland routes get farmland and farm buildings. Routes whose highest point is above about 1,400 m get rock, snow and forest at their real altitudes, and no farm buildings.
- **Finish:** the route ends at its last point, with a start arch, a finish arch and a checkered line.
- **Name:** taken from the file's name or track name, or from the file name.

### Limits

- **A usable track is required.** The file needs track points (`<trkpt>`) or route points (`<rtept>`). A file with only waypoints won't load.
- **Two points at least.** Points closer than 5 m to the last kept point are dropped. If fewer than two remain, the app says the route is too short.
- **Elevation is used when it's there.** If at least 80% of points have elevation, the app uses it. If not, the route rides flat and the summary says *No elevation in the file, so it rides flat*.
- **Gradient cap.** Gradients are capped at 25%, so very steep GPS spikes won't feel unfair.
- **Storage.** Routes are saved in this browser's storage. If a route is too large to save, the app shows *Route too large to save in this browser; it's rideable until you reload*. You can still ride it until the page reloads. Deleting routes you don't need frees up room.
- **Not a valid GPX.** Files that aren't valid XML are rejected with *This file is not valid GPX (XML)*.

When you're signed in, saved routes sync to your account. See [Accounts and profile](accounts-and-profile.md).

## Deleting a route

1. Open **🏁 Stage**.
2. Click the **🗑** on the route's card.
3. Confirm.

If the route is your current stage, the app switches back to Heartland Rollers. Built-in stages can't be deleted.

## Sharing a stage link

When you choose a stage, the address bar updates to include `?stage=` and the stage's ID, so you can bookmark it. See [Keyboard and URL parameters](../reference/keyboard-and-url-params.md).
