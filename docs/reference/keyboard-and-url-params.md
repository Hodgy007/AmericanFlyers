# Keyboard and URL parameters

This page lists every keyboard shortcut and URL parameter the app reads, with what each does. It's taken from `src/main.ts` and the sign-in code in `src/cloud/ui.ts`.

## Keyboard shortcuts

| Key | When | What it does |
| --- | --- | --- |
| **C** (or **c**) | Anywhere on the page, except inside a dialog | Cycles the camera: Chase view, Side view, Rider's view. |
| **←** / **→** | Anywhere on the page, except inside a dialog | Steers left or right across the road, 0.7 m a press; hold to keep going. |
| **R** (or **r**) | Anywhere on the page, except inside a dialog | Sends a 👍 ride-on to the rider just ahead of you (a live rider or a pro team rider). See [Riding together](../user-guide/riding-together.md#ride-ons). |
| **↑** | Demo ride on, not inside a dialog | Adds 10 W to the demo power, up to 600 W. |
| **↓** | Demo ride on, not inside a dialog | Takes 10 W from the demo power, down to 0 W. |

Keys pressed inside a dialog (such as a form field in Settings or the workout creator) don't trigger these shortcuts.

The app adds no other shortcuts. Dialogs use the browser's own behavior, for example **Esc** closes a dialog.

## URL parameters

The app reads these parameters when it loads.

| Parameter | Example | What it does |
| --- | --- | --- |
| `stage` | `?stage=alpe-dhuez` | Starts on the stage with that ID. Accepts `heartland`, `route66`, `hotw-morgul-bismark`, `hotw-tour-of-the-moon`, `hell-of-the-west`, `alpe-dhuez`, `stelvio`, `ventoux`, `tourmalet` and `zoncolan`, and the ID of an uploaded GPX route (for example `gpx-…`) saved in this browser. Any other value starts on Heartland Rollers. |
| `start` | `?start=6` | Starts the ride this many kilometers into the stage. Decimal values work, for example `6.5`. Values of zero or less are ignored. |
| `timescale` | `?timescale=8` | Runs the ride clock this many times faster (1 to 20), for testing whole races quickly. Not for normal riding: the physics and the field step in bigger jumps. |
| `error` | `?error=access_denied` | Set by the sign-in provider when sign-in fails. The app shows *Sign-in didn't finish* with the message, then removes the parameter from the address bar. |
| `error_description` | `?error_description=…` | The message that goes with `error`. Shown and removed the same way. |

### Parameters the app writes

When you choose a stage, the app sets `stage` in the address bar to that stage's ID, and removes `start`. You can copy the address to share the stage.

### Combining

`stage` and `start` work together:

- `https://americanflyers.vercel.app/?stage=stelvio&start=10` starts the Stelvio Pass ride 10 km in.
- `http://localhost:5173/?stage=alpe-dhuez&start=6` starts halfway up Alpe d'Huez in local development. See [Local development](../developer-guide/local-development.md#test-without-a-trainer).

### Notes

- Uploaded route IDs only work on the browser that holds the route. They're stored in that browser's storage, so the same link doesn't work elsewhere.
- `start` is applied when the page loads. Choosing a new stage clears it.

## More keys

| Key | What it does |
| --- | --- |
| **M** | Sound on or off. |
| **F** | Full screen on or off. |
| **−** or **[** | Easier gear (with virtual shifting on). |
| **+**, **=** or **]** | Harder gear (with virtual shifting on). |
