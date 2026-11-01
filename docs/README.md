# American Flyers documentation

This library covers the American Flyers app: what it does, how to ride with it, how to run and administer the account backend, and how the code is put together.

## What the app is

American Flyers is a browser-based indoor cycling app. It connects to a Wahoo KICKR (or any smart trainer that speaks the standard FTMS profile) over Bluetooth, and puts you on a 3D bike on a winding road. The trainer's resistance follows the hills. You can ride built-in stages such as the Hell of the West (the film's final stage), Alpe d'Huez, the Stelvio and Mont Ventoux, ride with other people and draft behind them, race ghosts and leaderboards, upload your own GPX routes, follow structured workouts and training plans, and keep your rides in an account (Google, or email and password) with stats, achievements and a feedback channel.

The live app is at https://americanflyers.vercel.app. It's written in TypeScript, HTML and CSS, built with Vite and Three.js, uses Web Bluetooth for the trainer and Web Audio for sound, and stores accounts, rides and feedback in Neon (Postgres with Neon Auth and a Data API, with SQL for the schema). See [Architecture](developer-guide/architecture.md#languages-and-technologies).

## Who each section is for

| Section | For | Start here |
| --- | --- | --- |
| [User guide](user-guide/getting-started.md) | Riders using the app | [Getting started](user-guide/getting-started.md) |
| [Admin guide](admin-guide/admin-dashboard.md) | People who run the site and its database | [Admin dashboard](admin-guide/admin-dashboard.md) |
| [Developer guide](developer-guide/architecture.md) | People changing the code | [Architecture](developer-guide/architecture.md) |
| [Reference](reference/database-schema.md) | Anyone who needs exact names, values and formats | [Database schema](reference/database-schema.md) |

## User guide

- [Getting started](user-guide/getting-started.md): requirements, browsers, your first ride and the demo ride.
- [The hub](user-guide/the-hub.md): the screen before you ride: choose a route or workout, see your plan, badges, garage, stats and the next event, and how to get back to it.
- [Connecting devices](user-guide/connecting-devices.md): the trainer (full control or power only), heart-rate straps, and how ERG and grade modes differ.
- [Riding](user-guide/riding.md): the top bar, data blocks, the elevation strip, camera views, demo controls, and Reset and the ride summary.
- [Stages and routes](user-guide/stages-and-routes.md): each built-in stage, finish lines, uploading GPX routes, and deleting routes.
- [Racing and the tour](user-guide/racing-and-the-tour.md): racing the pro teams, the race panel, points and jerseys, and the three-stage Hell of the West tour.
- [Group rides, races and the commentator](user-guide/events-and-commentary.md): the scheduled Events (a race every evening, a group ride at midday), the synchronised start, results, and the race commentator.
- [Workouts](user-guide/workouts.md): built-in workouts, ERG mode, uploading `.zwo`, `.erg` and `.mrc` files, the ramp test, the workout creator, and `.zwo` export.
- [Riding together](user-guide/riding-together.md): other riders on your stage, drafting and the draft gauge, the Riding now list, Ride with, and privacy.
- [My kit](user-guide/my-kit.md): design your jersey and bike colours, presets, and how other riders see them.
- [Garage, credits and challenges](user-guide/garage-and-credits.md): levels, credits, the bike store, the Tron bike, weekly challenges and the share card.
- [AI coach and AI rivals](user-guide/ai-coach-and-rivals.md): Coach Marty's tips and debriefs, the four rivals who remember you, turning them on, and the daily limits.
- [Leaderboards and ghosts](user-guide/leaderboards-and-ghosts.md): what counts, the 🏆 leaderboard, and racing ghosts.
- [Training plans](user-guide/training-plans.md): the three plans and how sessions tick off.
- [Sound and virtual shifting](user-guide/sound-and-shifting.md): ride sounds, and choosing your own gears.
- [Installing the app](user-guide/installing-the-app.md): the first-ride setup guide, installing as an app, full screen and TVs.
- [Data blocks](user-guide/data-blocks.md): choosing and ordering the numbers on screen, with a table of all 24 fields.
- [Settings](user-guide/settings.md): every setting, its default and what it changes.
- [Accounts and profile](user-guide/accounts-and-profile.md): signing in, what syncs, when rides are saved, the profile tabs, `.tcx` export, and signing out.
- [Privacy and your data](user-guide/privacy-and-your-data.md): what other riders see, downloading your data, and deleting your account.
- [Zones and FTP](user-guide/zones-and-ftp.md): heart-rate and power zones, how time in zone is counted, and FTP history.
- [Achievements](user-guide/achievements.md): every badge and how to earn it.
- [Feedback](user-guide/feedback.md): sending ideas and bug reports, statuses and replies.
- [Troubleshooting](user-guide/troubleshooting.md): common problems and fixes.
- [FAQ](user-guide/faq.md): short answers to common questions.

## Admin guide

- [Admin dashboard](admin-guide/admin-dashboard.md): every tile, chart, table and action on the Admin tab, including banning and the feedback inbox.
- [Managing admins](admin-guide/managing-admins.md): how admin access is decided, and the SQL to add or remove an admin.
- [Authentication setup](admin-guide/authentication-setup.md): Neon Auth, trusted domains, Google, and email and password sign-in with password reset.
- [Deployment](admin-guide/deployment.md): Vercel, automatic deploys from `main`, environment variables and Deployment Protection.

## Developer guide

- [AI coach and rivals](developer-guide/ai.md): the `/api/ai` Vercel function, prompts, models, caching, quotas in the database, and how to test without Anthropic.
- [Architecture](developer-guide/architecture.md): how the pieces fit together, with a module diagram.
- [Project structure](developer-guide/project-structure.md): every file in `src/` and what it does.
- [Local development](developer-guide/local-development.md): install, run, build, and testing without a trainer.
- [Bluetooth and FTMS](developer-guide/bluetooth-and-ftms.md): services, characteristics, opcodes, parsing and the control loop.
- [Physics and stats](developer-guide/physics-and-stats.md): the power-to-speed model and how ride statistics are computed.
- [3D world](developer-guide/3d-world.md): renderer, terrain, road, rider, sky, landmarks and cameras.
- [Stages and GPX](developer-guide/stages-and-gpx.md): stage definitions, how the climbs are built, the tour stages, and GPX parsing.
- [Racing and the tour](developer-guide/racing-and-tour.md): the race engine, the live race, the classifications and the tour.
- [Workouts format](developer-guide/workouts-format.md): the workout model, file import rules and `.zwo` export.
- [Backend and database](developer-guide/backend-and-database.md): Neon, the browser client, sync rules, activities and `.tcx` export.
- [Security](developer-guide/security.md): what protects what, and what doesn't.
- [Testing](developer-guide/testing.md): the build check, and headless UI checks.
- [Contributing](developer-guide/contributing.md): branches, commits, the Haiku preference, and keeping the schema in sync.

## Reference

- [Database schema](reference/database-schema.md): table-by-table columns, constraints, policies and the admin functions.
- [Keyboard and URL parameters](reference/keyboard-and-url-params.md): every shortcut and URL parameter the app reads.
- [Changelog](reference/changelog.md): the history of merged work, grouped by pull request.
