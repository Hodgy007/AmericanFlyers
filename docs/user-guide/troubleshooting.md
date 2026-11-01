# Troubleshooting

This page lists common problems with the browser, the trainer, heart rate, sign-in, saving rides and routes, with the likely cause and a fix for each.

## Bluetooth is unavailable

**Symptom:** The status line says *Bluetooth unavailable in this browser*, and the **Connect trainer** and **Heart rate** buttons are greyed out.

**Cause:** The browser doesn't support Web Bluetooth. Firefox, Safari and some in-app browsers don't.

**Fix:** Open the app in Chrome or Edge on a computer or Android phone. On iPhone or iPad, use the free **Bluefy** browser. The demo ride works in any browser.

## Trainer not found

**Symptom:** Your trainer doesn't appear in the device picker.

**Causes and fixes:**

- **The trainer isn't advertising.** The picker shows only devices that offer the FTMS or Cycling Power service. Wake the trainer by turning it on or pedaling, and try again.
- **Another app has the trainer.** Close the Wahoo app and Zwift, then reconnect. A trainer can usually take commands from only one app at a time.
- **The page isn't secure.** Web Bluetooth needs `https://` or `http://localhost`. Open the live site, or run the app locally with `npm run dev`.
- **Bluetooth is off.** Turn Bluetooth on for the computer or phone.

If you cancel the picker, nothing happens. That's expected.

## Couldn't connect

**Symptom:** A toast says *Couldn't connect:* followed by a message.

**Fix:** Close other apps that may hold the trainer, then try again. The message from the browser usually says what went wrong.

## Trainer disconnected

**Symptom:** The status line says *Trainer disconnected*.

**Fix:** A remembered trainer that drops out is retried automatically (1, 2, 4, 8 and 15 seconds); the status line says *Reconnecting…* and your ride carries on. If it gives up, wake the trainer by pedalling, then tap **Reconnect** in the ☰ Menu (or the banner). Check the trainer's battery and that it's in range. The trainer's own app may also have taken control.

## It doesn't reconnect by itself when I open the app

**Cause:** Reconnecting without the picker needs a Chrome feature that is still behind a flag. Everyone else gets a **Reconnect** banner and menu item instead (one tap). To turn it on, see [Browser support for automatic reconnection](connecting-devices.md#browser-support-for-automatic-reconnection). The trainer also has to be awake and in range, and not held by another app.

**Wrong device remembered?** **☰ Menu → ✕ Forget *name***, then connect the right one.

## No resistance changes

**Symptom:** The trainer's resistance doesn't change on hills.

**Causes and fixes:**

- **Power-only mode.** The status line says *power only (no resistance control)*. Your trainer doesn't accept commands from the app. Only trainers that support FTMS control can change resistance. Power still works.
- **Trainer difficulty is 0%.** Raise it in [Settings](settings.md#the-settings).
- **Another app has control.** Close the Wahoo app and Zwift, then disconnect and reconnect.
- **You're in a workout.** Workouts hold a target power (ERG mode), so the grade isn't applied until the workout ends.

## Heart rate is missing

**Symptom:** Heart rate shows `--`, or the zones stay empty.

**Causes and fixes:**

- **No strap connected.** Click **Heart rate** and pick your strap. The button shows **HR ✓** when it's connected.
- **Strap not transmitting.** Make sure the strap is on and wet, if your model needs it.
- **Stale readings.** Heart rate older than 3 seconds counts as missing. A strap that drops out shows `--` until it reconnects.
- **Trainer doesn't relay heart rate.** Some trainers don't send heart rate. Use a strap.

## Sign-in problems

**Symptom:** *Sign-in didn't finish:* followed by a message, after you return from Google.

**Fix:** Try again. Check the message in the toast. If the same error keeps happening, the site may not be set up for sign-in. See [Authentication setup](../admin-guide/authentication-setup.md).

**Symptom:** *There's already an account with this email.*

**Fix:** You already have an account with that address (perhaps through Google). Choose **Sign in**, use **Continue with Google**, or reset your password with **Forgot password?**.

**Symptom:** *That email and password don't match.*

**Fix:** Check for typos and caps lock, or use **Forgot password?**. If you first signed up with Google, use **Continue with Google**.

**Symptom:** No password reset email.

**Fix:** Check your spam folder, and wait a minute. Links last 15 minutes; ask for a new one if it has expired.

**Symptom:** Signed in, but the profile is empty or your rides are missing.

**Fix:** Check that you're signed in to the same account on each device. Rides are only in the account they were saved to.

## A ride wasn't saved

**Possible causes:**

- **You're not signed in.** Rides are only saved to an account. Sign in, and rides from then on are saved.
- **The ride was under a minute.** Shorter rides aren't saved.
- **The ride is still going.** Rides are saved when you finish a stage or workout, when you press Reset, and every 5 minutes on long rides. Press Reset to save it now.
- **You started a new ride without signing in.** The ride wasn't kept. Sign in before you start a new one, or use **Sign in** in the summary to keep the ride.
- **A save failed.** The summary shows *Couldn't save this ride:* with the reason. Saves made in the background (the 5-minute save, and the save when you start a new ride) don't show an error. Press Reset to see the summary and check the save.

## Route too large to save

**Symptom:** *Route too large to save in this browser; it's rideable until you reload.*

**Fix:** Delete routes you no longer need (see [Stages and routes](stages-and-routes.md#deleting-a-route)). You can still ride the route until the page reloads. After a reload, it's gone unless it fits in storage next time.

## A file won't upload

**Symptom:** A toast names a file and says why it can't be read.

| Message | What to do |
| --- | --- |
| *This file is not valid GPX (XML).* | Export the route again. |
| *No track or route points found in this GPX file.* | Export the activity or route as a track, not just waypoints. |
| *This route is too short.* | The route has fewer than two usable points. |
| *Unsupported file type ".…". Use .zwo, .erg or .mrc.* | Use a supported workout file. |
| *This .zwo file is not valid XML.* / *No <workout> section found…* | The file isn't a Zwift workout. Check it opens as text. |
| *This .zwo file has no workout steps.* | The workout file is empty. |
| *No power data found in this file.* | The `.erg` or `.mrc` file has no course data. |

## Settings or data don't sync

**Symptom:** *Couldn't sync settings*, *Couldn't sync workout* or *Couldn't sync route*.

**Fix:** Check your connection. The change is still kept in this browser, so the app keeps working. Make the change again to send it to your account.

## The scene is slow or stuttery

The 3D view needs a reasonably capable graphics card. Close other tabs and apps that use the GPU, and try a smaller browser window. The data and trainer control keep working even when the picture slows down.

## Still stuck?

Send a note with the **💬** button, or check the [FAQ](faq.md).
