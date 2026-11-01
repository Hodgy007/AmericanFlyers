# FAQ

This page answers common questions about the app, trainers, accounts, data and what the app can and can't do.

## Do I need an account?

Yes, and it's free: no subscription, no card. You sign in with Google, or sign up with an email address, on the home page, which is the only way into the app. The account saves your rides, plans and progress and syncs them between devices. The demo ride, routes, workouts and settings are all there once you're signed in. Settings, routes and workouts you made in this browser before accounts were required are copied to your account the first time you sign in. See [Accounts and profile](accounts-and-profile.md).

## Which trainers work?

The README names Wahoo KICKR, KICKR CORE and KICKR SNAP on current firmware. Most other trainers that support the standard FTMS profile should work with full resistance control. A trainer that only offers Cycling Power works in power-only mode, where the resistance doesn't change. See [Connecting devices](connecting-devices.md).

## Does it work on a phone?

On Android, use Chrome. On iPhone or iPad, use the free Bluefy browser, because Safari doesn't support Web Bluetooth. Other phone browsers may not connect to a trainer.

## Does it work offline?

Partly. Once you've opened it, the app and its 3D models are cached on your device, so it opens quickly and can start a ride with a weak connection. Signing in, saving rides, riding together and leaderboards need the internet. You can also install it as an app: see [Installing the app](installing-the-app.md).

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

## Can I ride with my friends?

Yes. Both sign in, pick the same stage, and you'll see each other on the road. Open 👥 and press **Ride with** to start next to them. See [Riding together](riding-together.md).

## Is there drafting?

Yes. Ride close behind another rider and you save up to about a third of your air drag; a gauge shows the gap and the watts you're saving. See [Riding together](riding-together.md#drafting).

## Do I have to give my phone number or address?

No. An email account needs only a rider name, email, password, weight and (optionally) FTP. Or use Google.

## Why is the Hell of the West stage in Colorado?

It's the final stage of the 1985 film *American Flyers*, filmed between Idaho Springs and Echo Lake on the road to Mount Evans. See [Stages and routes](stages-and-routes.md).

## How do I race the pro teams?

Press **🏁 Race this stage** on a stage card, or start the Hell of the West tour from **☰ Menu → 🏆**. See [Racing and the tour](racing-and-the-tour.md).
