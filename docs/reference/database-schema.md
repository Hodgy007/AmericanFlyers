# Database schema

This page is the table-by-table reference for the `public` schema, with columns, types, defaults and constraints, plus the policies, triggers, grants and the admin functions. It follows [`db/schema.sql`](../../db/schema.sql).

The schema lives in the `americanflyers` Neon project, in the `neondb` database. `auth.user_id()` and the `neon_auth` schema are provided by Neon Auth.

## Rider tables

### `public.profiles`

One row per rider.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `user_id` | `text` | no | `auth.user_id()` | **Primary key.** |
| `settings` | `jsonb` | no | `'{}'` | The rider's settings. |
| `updated_at` | `timestamptz` | no | `now()` | |

### `public.workouts`

The rider's own workouts (uploaded or created). Built-ins aren't stored.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `text` | no | | **Primary key.** Set by the app. |
| `user_id` | `text` | no | `auth.user_id()` | Index `workouts_user_idx` on `user_id`. |
| `data` | `jsonb` | no | | The whole workout (see [Workouts format](../developer-guide/workouts-format.md)). |
| `updated_at` | `timestamptz` | no | `now()` | |

### `public.routes`

The rider's uploaded GPX routes.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `text` | no | | **Primary key.** Set by the app (`gpx-…`). |
| `user_id` | `text` | no | `auth.user_id()` | Index `routes_user_idx` on `user_id`. |
| `name` | `text` | no | | The route's name. |
| `data` | `jsonb` | no | | The stored route: name, points as `[lat, lon, elevation]`, and `hasElevation`. |
| `updated_at` | `timestamptz` | no | `now()` | |

### `public.activities`

Saved rides.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | no | `gen_random_uuid()` | **Primary key.** Set by the app. |
| `user_id` | `text` | no | `auth.user_id()` | Index `activities_user_started_idx` on `(user_id, started_at desc)`. |
| `started_at` | `timestamptz` | no | | |
| `title` | `text` | no | | |
| `stage_id` | `text` | yes | | |
| `stage_name` | `text` | yes | | |
| `finished` | `boolean` | no | `false` | |
| `workout_name` | `text` | yes | | |
| `duration_s` | `integer` | no | | Moving time, in seconds. |
| `distance_m` | `real` | no | `0` | |
| `climbed_m` | `real` | no | `0` | |
| `avg_power` | `real` | yes | | Watts. |
| `np` | `real` | yes | | Normalized power, watts. |
| `max_power` | `real` | yes | | Watts. |
| `avg_hr` | `real` | yes | | bpm. |
| `max_hr` | `real` | yes | | bpm. |
| `avg_cadence` | `real` | yes | | rpm. |
| `kj` | `real` | yes | | Kilojoules. |
| `tss` | `real` | yes | | |
| `ftp` | `integer` | yes | | FTP the ride was worked out from. |
| `best_power` | `jsonb` | yes | | Keys `"5"`, `"60"`, `"300"`, `"1200"`; values in watts. |
| `hr_zones` | `jsonb` | yes | | Seconds in each of 5 heart-rate zones. |
| `power_zones` | `jsonb` | yes | | Seconds in each of 6 power zones. |
| `max_hr_setting` | `integer` | yes | | Max heart rate the zones were worked out from. |
| `samples` | `jsonb` | yes | | Per-second arrays. See [Backend and database](../developer-guide/backend-and-database.md#the-samples-format). |
| `created_at` | `timestamptz` | no | `now()` | |

### `public.ftp_history`

Each FTP entry.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `bigint` | no | identity (`generated always`) | **Primary key.** |
| `user_id` | `text` | no | `auth.user_id()` | Index `ftp_history_user_idx` on `(user_id, recorded_at)`. |
| `ftp` | `integer` | no | | Check: `between 30 and 800`. |
| `source` | `text` | no | `'manual'` | Check: one of `manual`, `ramp_test`, `signup`. |
| `recorded_at` | `timestamptz` | no | `now()` | |

A ramp test result outside 30–800 W is rejected by the check constraint, and the app shows *Couldn't save your FTP history*.

## Feedback

### `public.feedback`

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | no | `gen_random_uuid()` | **Primary key.** |
| `user_id` | `text` | no | `auth.user_id()` | Index `feedback_user_idx` on `(user_id, created_at desc)`. Forced by the insert trigger. |
| `category` | `text` | no | | Check: one of `idea`, `bug`, `other`. Locked by the update trigger. |
| `message` | `text` | no | | Check: 3 to 4,000 characters. Locked by the update trigger. |
| `context` | `jsonb` | yes | | Attached by the app: stage, workout, trainer, browser, screen, version. |
| `status` | `text` | no | `'new'` | Check: one of `new`, `planned`, `in_progress`, `done`, `declined`. Set to `new` by the insert trigger. |
| `admin_reply` | `text` | yes | | Check: at most 4,000 characters. Cleared by the insert trigger. |
| `created_at` | `timestamptz` | no | `now()` | Set by the insert trigger. Locked by the update trigger. |
| `updated_at` | `timestamptz` | no | `now()` | Set by the update trigger. |

## Admin

### `public.admins`

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `email` | `text` | no | | **Primary key.** Compared case-insensitively. |

RLS is enabled, there are no policies, and the schema grants nothing on this table. The first row is seeded by the schema file. See [Managing admins](../admin-guide/managing-admins.md).

## Row-level security

| Table | Policy | Commands | Rule |
| --- | --- | --- | --- |
| `profiles`, `workouts`, `routes`, `activities`, `ftp_history` | `<table>_owner` | all, to `authenticated` | `using` and `with check`: `user_id = (select auth.user_id())` |
| `feedback` | `feedback_insert_own` | insert, to `authenticated` | `with check`: `user_id = (select auth.user_id())` |
| `feedback` | `feedback_read` | select, to `authenticated` | `user_id = auth.user_id()`, or `is_admin()` |
| `feedback` | `feedback_admin_update` | update, to `authenticated` | `is_admin()` in `using` and `with check` |
| `feedback` | `feedback_admin_delete` | delete, to `authenticated` | `is_admin()` |
| `admins` | none | | RLS enabled, no policies |

Riders have no update or delete policy on `feedback`.

## Grants

| Table | To `authenticated` | To `anonymous` |
| --- | --- | --- |
| `profiles`, `workouts`, `routes`, `activities`, `ftp_history` | `select, insert, update, delete` | revoked (all) |
| `feedback` | `select, insert, update, delete` | revoked (all) |
| `admins` | none | none |

## Triggers

| Trigger | Table | Timing | Function | Effect |
| --- | --- | --- | --- | --- |
| `feedback_on_insert` | `feedback` | `before insert`, each row | `public.feedback_on_insert()` | Sets `user_id` to `auth.user_id()`, `status` to `new`, `admin_reply` to null, and `created_at` and `updated_at` to `now()`. |
| `feedback_on_update` | `feedback` | `before update`, each row | `public.feedback_on_update()` | Keeps `user_id`, `message`, `category` and `created_at`. Sets `updated_at` to `now()`. |

## Functions

All functions are `security definer` with `search_path = ''`. Execute is revoked from `public` and `anonymous`, and granted to `authenticated`.

### `public.is_admin()`

| | |
| --- | --- |
| Returns | `boolean` |
| Stability | `stable` |
| Logic | True when a row in `public.admins` matches the email of a `neon_auth."user"` row whose `id` is the caller's `auth.user_id()`, that user's `emailVerified` is true, and `banned` is not true. |

### `public.admin_overview()`

| | |
| --- | --- |
| Returns | `jsonb` |
| Raises | `Admins only` (`42501`) for non-admins. |
| Keys | `users_total`, `users_7d`, `users_30d`, `banned`, `active_7d`, `active_30d`, `activities_total`, `activities_7d`, `hours_total`, `km_total`, `climbed_total`, `kj_total`, `workouts_saved`, `routes_saved`, `feedback_new`, `feedback_total`, `signups_by_day`, `rides_by_day`, `top_stages`, `top_workouts`. |

`signups_by_day` and `rides_by_day` cover the last 30 days, as `{ "day", "n" }` objects. `top_stages` is the top 8 by ride count (`name`, `rides`, `riders`, `finishes`). `top_workouts` is the top 8 (`name`, `rides`, `riders`).

### `public.admin_users()`

| | |
| --- | --- |
| Returns | `table (id text, name text, email text, joined timestamptz, banned boolean, admin boolean, rides bigint, hours numeric, km numeric, last_ride timestamptz, feedback bigint)` |
| Raises | `Admins only` for non-admins. |
| Order | Newest account first. |

### `public.admin_set_ban(target text, ban boolean, reason text default null)`

| | |
| --- | --- |
| Returns | `void` |
| Raises | `Admins only`; `You can't ban yourself` when `target` is the caller. |
| Effect | Sets `banned`, `banReason` (only when banning) and clears `banExpires` on `neon_auth."user"`. When banning, deletes that user's rows in `neon_auth.session`. |

Banning another admin is allowed by this function. See [Security](../developer-guide/security.md#known-gaps).

### `public.admin_feedback()`

| | |
| --- | --- |
| Returns | `table (id uuid, category text, message text, context jsonb, status text, admin_reply text, created_at timestamptz, user_name text, user_email text)` |
| Raises | `Admins only` for non-admins. |
| Order | New items first, then newest. |
| Limit | 500 rows. |

## Client calls

| Operation | Call in `src/cloud/sync.ts` |
| --- | --- |
| Admin check | `neon.rpc('is_admin')` |
| Overview | `neon.rpc('admin_overview')` |
| Rider list | `neon.rpc('admin_users')` |
| Feedback list | `neon.rpc('admin_feedback')` |
| Ban or unban | `neon.rpc('admin_set_ban', { target, ban, reason })` |
| Set status or reply | `neon.from('feedback').update(...)` |
| Delete feedback | `neon.from('feedback').delete()` |
| Riding together | `neon.rpc('ride_presence', …)` and `neon.rpc('leave_ride')` in `src/cloud/presence.ts` |
| Leaderboard | `neon.rpc('stage_leaderboard', { p_stage, p_since })` |
| Ghost | `neon.rpc('stage_ghost', { p_activity })` |

## Riding together, leaderboards and ghosts

### `live_riders`

Where each signed-in rider is right now. No direct access: row-level security is on with no grants, and only the functions below read or write it.

| Column | Type | Notes |
| --- | --- | --- |
| `user_id` | `text` | Primary key. |
| `stage_id` | `text` | Up to 80 characters. |
| `distance` | `real` | Metres along the stage, clamped to −1,000 to 1,000,000. |
| `speed` | `real` | m/s, clamped to 0–40. |
| `power` | `smallint` | Watts, clamped to 0–3,000. |
| `cadence` | `smallint` | rpm, clamped to 0–250. |
| `updated_at` | `timestamptz` | Set on every update. |

### `activities.finish_s`

`integer`, nullable, greater than 0. Moving time in seconds from the start line to the finish line, set only for whole-stage rides. Indexed with `stage_id` where not null.

### Functions

| Function | Who | What it does |
| --- | --- | --- |
| `ride_presence(p_stage, p_distance, p_speed, p_power, p_cadence, p_visible)` | Signed in | Records the caller's position (or removes it when `p_visible` is false), deletes rows older than 10 minutes, and returns up to 30 other riders on the stage seen in the last 15 s: `md5` of their id, short name, distance, speed, power, cadence and the age of the position in ms. Banned riders are left out. |
| `leave_ride()` | Signed in | Removes the caller's row. |
| `short_name(full_name)` | Internal | *First L.*, or *Rider* when empty. |
| `stage_leaderboard(p_stage, p_since)` | Signed in | Each rider's fastest `finish_s` on the stage (since `p_since` if given), ranked, top 25 plus the caller. Returns rank, activity id, short name, time, average power, date and `is_me`. |
| `stage_ghost(p_activity)` | Signed in | For a finished whole-stage ride: short name, `finish_s`, the 1 s distance trace (`samples -> 'distance'`) and `is_me`. Nothing else from the ride is returned. |

## Changing the schema

When you change a table or function, update this page and `db/schema.sql` in the same change. See [Contributing](../developer-guide/contributing.md#keep-the-schema-in-sync).
