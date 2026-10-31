# Backend and database

This page covers how the browser talks to Neon: the Auth and Data API clients, the tables and what they hold, row-level security, triggers, the admin functions, the sync rules between the browser and the account, the shape of saved activities, and the `.tcx` export.

For column-by-column detail, see [Database schema](../reference/database-schema.md). The source of truth is [`db/schema.sql`](../../db/schema.sql).

## The Neon project

The backend is a Neon project called `americanflyers`, in the `eu-west-2` region. `CLAUDE.md` records the project ID, branch and database name (`neondb`). The app uses:

- **Neon Auth** for sign-in with Google and Apple. It's managed Better Auth, and keeps its users in `neon_auth."user"` and its sessions in `neon_auth.session`.
- **The Data API**, a REST interface over the `public` schema. The browser calls it with `@neon/neon-js` as the `authenticated` role.

The two endpoints are in [`src/cloud/client.ts`](../../src/cloud/client.ts). They're public, and they're not secrets. Row-level security is what protects the data. The endpoints can be overridden with `VITE_NEON_AUTH_URL` and `VITE_NEON_DATA_API_URL`.

`createClient()` returns a `neon` object with `neon.auth` (session, sign-in, sign-out, update user) and `neon.from(table)` and `neon.rpc(name, args)` for the Data API.

## Tables

| Table | Holds | Written by |
| --- | --- | --- |
| `profiles` | One row per rider: their settings as JSON. | Settings sync, and sign-in. |
| `workouts` | The rider's own workouts, as JSON. | Save, delete. |
| `routes` | The rider's uploaded GPX routes, as JSON. | Upload, delete. |
| `activities` | Saved rides: summary columns, best efforts, zones and per-second samples. | Ride save. |
| `ftp_history` | Each FTP entry, with its source. | FTP changes, sign-up. |
| `feedback` | Ideas and bug reports, with status and reply. | Riders (insert). Admins (update, delete). |
| `admins` | Admin email addresses. | Owner, through SQL only. |

Every rider table has a `user_id` column, filled from `auth.user_id()`, which is the signed-in user's ID.

## Row-level security

RLS is enabled on every table:

- **Rider tables** (`profiles`, `workouts`, `routes`, `activities`, `ftp_history`) have one policy, `<table>_owner`, for all commands to `authenticated`. It requires `user_id = auth.user_id()` both to read and to write. Those tables grant `select`, `insert`, `update` and `delete` to `authenticated`, and revoke everything from `anonymous`.
- **`feedback`** has four policies: riders insert their own rows; riders and admins can read; admins can update; admins can delete. Riders have no update or delete policy, so they can't change or remove feedback after sending it.
- **`admins`** has RLS enabled and no policies, and the schema grants nothing on it. The app's roles can't read it. Only the security-definer functions do, and the owner through SQL.

For the full list, see [Security](security.md).

## Triggers on feedback

Two `BEFORE` triggers keep feedback honest:

- **`feedback_on_insert`** sets `user_id` to the signed-in user, sets `status` to `new`, clears `admin_reply`, and sets `created_at` and `updated_at` to now. A rider can't choose any of these.
- **`feedback_on_update`** keeps `user_id`, `message`, `category` and `created_at` as they were, and sets `updated_at`. An admin can change the status and the reply, but not the message.

## Admin functions

These are `security definer` functions with `search_path = ''`. Each one checks `public.is_admin()` first, except `is_admin()` itself. Execute is revoked from `public` and `anonymous`, and granted to `authenticated`.

| Function | Returns | What it does |
| --- | --- | --- |
| `is_admin()` | boolean | True if the signed-in user is listed in `admins` by email (case-insensitive), has a verified email, and isn't banned. |
| `admin_overview()` | jsonb | Site totals, the last 30 days of signups and rides per day, and the top stages and workouts. |
| `admin_users()` | table | One row per account, with ride, hour, distance and feedback counts, and whether they're an admin or banned. |
| `admin_set_ban(target, ban, reason)` | void | Bans or unbans an account. Refuses to ban yourself. When banning, it removes that account's sessions. |
| `admin_feedback()` | table | Up to 500 feedback items, new ones first, with the rider's name and email. |

The client calls these with `neon.rpc()`. Admin writes to feedback (status, reply, delete) go straight to the `feedback` table through the Data API, and RLS allows them only for admins.

The admin dashboard is described in [Admin dashboard](../admin-guide/admin-dashboard.md).

## Sync rules

The browser keeps working copies in `localStorage`. The account is the source of truth once you're signed in.

### On sign-in

`syncOnSignIn()` in [`src/cloud/sync.ts`](../../src/cloud/sync.ts) runs when the session becomes signed in:

1. **Settings.** If `profiles.settings` for the user has any keys, those settings are returned and replace the browser's. If not, the browser's settings are upserted to `profiles`, and a `signup` entry is written to `ftp_history`.
2. **Workouts.** The account's workouts are read. Browser workouts that the account doesn't have are inserted. The browser's copy becomes the account's workouts plus the new ones.
3. **Routes.** The same, for routes.
4. **Pending ride.** If a ride was held back in `americanflyers.pendingRide`, it's saved, and the key is cleared.

### On sign-out

The browser's workouts and routes are cleared. Settings stay in the browser. Saved rides are never kept locally, apart from the single held-back ride described under [On sign-in](#on-sign-in).

### Write-through

- **Settings** are upserted to `profiles` 800 ms after the last change. Only the last change is sent.
- **Workouts and routes** are upserted or deleted as soon as they change, if signed in.
- **Rides** are upserted to `activities` on each save. The ride's ID is a UUID created when recording starts, so saving again replaces the same row.
- **FTP changes** are inserted to `ftp_history`.
- **Feedback** is inserted to `feedback`.

Failed settings, workout and route writes report through `onSyncError`, which shows a toast. The local copy is kept, and a failed write isn't retried automatically; the next change sends it again. Ride saves and FTP writes report their own errors, in the summary or as a toast.

## Activities

Each saved ride is one row in `activities`. The columns are the ride summary, plus two JSON columns for zones and best efforts, and one for samples.

| Column | Example content |
| --- | --- |
| `id` | A UUID, generated in the browser. |
| `started_at` | When the first moving second was recorded. |
| `title` | The stage name, or *Workout · Stage* when riding a workout. |
| `stage_id`, `stage_name` | The stage's ID and name. |
| `finished` | True when the stage's finish line was crossed. |
| `workout_name` | The workout completed in the ride, if any. |
| `duration_s`, `distance_m`, `climbed_m` | Moving time, distance and climbing. |
| `avg_power`, `np`, `max_power`, `avg_hr`, `max_hr`, `avg_cadence`, `kj`, `tss` | As described in [Physics and stats](physics-and-stats.md). |
| `ftp`, `max_hr_setting` | The FTP and max heart rate the ride was worked out from. |
| `best_power` | `{"5": W, "60": W, "300": W, "1200": W}`. |
| `hr_zones`, `power_zones` | Seconds in each zone. |
| `samples` | Per-second arrays, described below. |

The list of rides uses the summary columns only. `samples` is loaded when a ride is opened, so the profile stays quick. The list loads the newest 1,000 rides.

### The samples format

`samples` is an object of equal-length arrays, one entry per recorded second of moving time:

| Key | Unit | Notes |
| --- | --- | --- |
| `power` | W | Rounded. |
| `cadence` | rpm | Rounded. |
| `hr` | bpm | `0` when there was no reading. |
| `speed` | m/s × 10 | Stored as an integer. |
| `distance` | m | Since the start of the ride, rounded. |
| `elevation` | m × 10 | Altitude above sea level on stages with a base altitude, otherwise height above the start. |

The recorder samples only while moving, so a long pause doesn't add rows. The JSON can get large for long rides. There's no size limit in the app.

## TCX export

`toTcx()` in [`src/cloud/recorder.ts`](../../src/cloud/recorder.ts) writes a Garmin Training Center Database v2 file:

- One `Activity` with `Sport="Biking"`, whose `Id` and `Lap` start time come from the ride.
- A `Lap` with total time, distance, and calories (from kJ), and `Intensity` `Active`, `TriggerMethod` `Manual`.
- One `Trackpoint` per second, with time, altitude, distance, heart rate (only when non-zero), cadence (capped at 254), and the `ns3:TPX` extension holding speed and watts.
- `Notes` with the ride title and *(American Flyers)*.

The file is downloaded as `<title> <date>.tcx`. The title is stripped of most punctuation.

## Feedback context

When a rider sends feedback, the app attaches a context object: stage name, workout name, trainer name (or `demo`), browser user agent, screen size, and the app version. The version comes from `VITE_VERCEL_GIT_COMMIT_SHA`, or `dev`. Admins see the context under each item in the inbox.

## Where to look next

- [Database schema](../reference/database-schema.md) for every column and constraint.
- [Security](security.md) for what protects what.
- [Admin guide](../admin-guide/managing-admins.md) for how admins are granted access.
