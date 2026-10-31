# FAQ

This page answers common questions about the app, trainers, accounts, data and what the app can and can't do.

## Do I need an account?

No. You can ride, use the demo ride, upload routes and workouts, and change settings without signing in. Your settings, routes and workouts stay in the browser. Signing in adds saved rides, profile stats, achievements, feedback and sync between devices. See [Accounts and profile](accounts-and-profile.md).

## Which trainers work?

The README names Wahoo KICKR, KICKR CORE and KICKR SNAP on current firmware. Most other trainers that support the standard FTMS profile should work with full resistance control. A trainer that only offers Cycling Power works in power-only mode, where the resistance doesn't change. See [Connecting devices](connecting-devices.md).

## Does it work on a phone?

On Android, use Chrome. On iPhone or iPad, use the free Bluefy browser, because Safari doesn't support Web Bluetooth. Other phone browsers may not connect to a trainer.

## Does it work offline?

No. The app is loaded from the web each time you open it, and it doesn't include an offline mode.

## Why does the hill feel too easy or too hard?

The trainer simulates a share of the road's grade, set by **Trainer difficulty** in Settings. The default is 50%. Set it to 100% to match the real grade, or lower it for an easier ride. See [Settings](settings.md#the-settings).

## Why is my power or speed zero?

Power and cadence drop to zero if the app hasn't had a reading from the trainer for 3 seconds. Check the trainer is connected and pedaling. See [Connecting devices](connecting-devices.md#trainer-status-and-data-freshness).

## Why isn't my ride saved?

The usual reasons are that you're not signed in, or the ride was under a minute. See [Troubleshooting](troubleshooting.md#a-ride-wasnt-saved) and [When rides are saved](accounts-and-profile.md#when-rides-are-saved).

## Can I import rides from another app?

Not directly. You can upload GPX routes to practice (see [Stages and routes](stages-and-routes.md)), and workout files in `.zwo`, `.erg` and `.mrc` formats (see [Workouts](workouts.md)). The app doesn't import activity files.

## Can I export my rides?

Yes. Open a ride in your profile's **Rides** tab and click **⬇ Export .tcx**. The file imports into Strava, TrainingPeaks and Garmin Connect. See [Accounts and profile](accounts-and-profile.md#export-a-ride-as-tcx).

## Can I export my workouts?

Yes, as `.zwo` files, from the library or the workout creator. See [Workouts](workouts.md#export-a-workout-as-zwo).

## Can I delete my account?

The app has no option to delete an account. You can delete individual rides from your profile, and the **Rides** tab lists them. To remove the account itself, contact the site's owner.

## Are my rides private?

Your rides, settings, workouts, routes and FTP history can only be read by your account. Admins can see totals and the rider list, but not your individual rides. See [Security](../developer-guide/security.md).

## Where are my settings kept?

In this browser, always. When you're signed in, they're also kept in your account. See [Settings](settings.md#where-settings-are-kept).

## How accurate are the built-in stages?

Alpe d'Huez uses published per-kilometer gradients from swi-cycling.com. Stelvio Pass has the published totals, but its per-kilometer shape is an approximation, because no per-kilometer source was found. Heartland Rollers is endless and rolling, and Route 66 Flats is flat. GPX routes follow the shape of your file, with gradients capped at 25%. See [Stages and routes](stages-and-routes.md#built-in-stages).

## Why is there no scenery or a landmark I expected?

Landmarks are 3D models that the site serves from its models folder. A landmark only appears when its model is available. The developer guide explains how models are added: [3D world](../developer-guide/3d-world.md).

## Can I change the units?

Yes. Choose Metric or Imperial in [Settings](settings.md#the-settings). This changes every distance, speed and height on screen, and the ride summaries.

## Where do I report a bug?

Use the **💬** button while signed in. See [Feedback](feedback.md).
