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
| Ride-ons | `neon.rpc('send_ride_on', { p_to, p_emote })` and `neon.rpc('my_ride_ons', { p_since })` in `src/cloud/rideOns.ts` |
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
| `kit` | `text` | Nullable. The rider's kit as `#jersey,#accent,#frame` (three `#rrggbb` colours, lower case). `ride_presence()` stores it only if it matches that pattern; otherwise null (the default kit). |
| `updated_at` | `timestamptz` | Set on every update. |

### `ride_ons`

Ride-ons: a quick emoji from one rider to another. No direct access: row-level security is on with no grants (on the table and its sequence), and only `send_ride_on()` and `my_ride_ons()` read or write it.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `bigserial` | Primary key. |
| `from_user` | `text` | The sender's user id. |
| `to_user` | `text` | The receiver's user id. |
| `emote` | `text` | One of 👍 🔥 💪 👋 (check constraint). |
| `created_at` | `timestamptz` | Default `now()`. |

Indexes on `(to_user, created_at)` and `(from_user, created_at)`.

### `activities.finish_s`

`integer`, nullable, greater than 0. Moving time in seconds from the start line to the finish line, set only for whole-stage rides. Indexed with `stage_id` where not null.

### Functions

| Function | Who | What it does |
| --- | --- | --- |
| `ride_presence(p_stage, p_distance, p_speed, p_power, p_cadence, p_visible default true, p_kit default null)` | Signed in | Records the caller's position and kit (or removes the row when `p_visible` is false), deletes rows older than 10 minutes, and returns up to 30 other riders on the stage seen in the last 15 s: `md5` of their id, short name, distance, speed, power, cadence, the age of the position in ms and `kit`. Banned riders are left out. The six-argument call from before kits still works. |
| `send_ride_on(p_to, p_emote)` | Signed in | Records a ride-on to the rider whose `md5` id is `p_to` and who was seen in the last 15 s. Raises an error for an unknown emoji, an unknown, stale or banned target, yourself, a second ride-on to the same rider within 20 s, or more than 20 in a minute. Returns nothing. |
| `my_ride_ons(p_since default now() - 1 minute)` | Signed in | Ride-ons sent to the caller after `p_since`, oldest first, up to 20: `id`, `from_id` (`md5` of the sender, as in `ride_presence()`), `name` (short name), `emote` and `created_at`. Also deletes rows older than 1 day. |
| `leave_ride()` | Signed in | Removes the caller's row. |
| `short_name(full_name)` | Internal | *First L.*, or *Rider* when empty. |
| `stage_leaderboard(p_stage, p_since)` | Signed in | Each rider's fastest `finish_s` on the stage (since `p_since` if given), ranked, top 25 plus the caller. Returns rank, activity id, short name, time, average power, date and `is_me`. |
| `stage_ghost(p_activity)` | Signed in | For a finished whole-stage ride: short name, `finish_s`, the 1 s distance trace (`samples -> 'distance'`) and `is_me`. Nothing else from the ride is returned. |

## Trust and safety

### `public.stage_limits`

One row per built-in stage with a finish line: `stage_id` (primary key), `distance_m`, `min_finish_s` (the fastest believable time) and `max_avg_kmh`. The floor is 80% of the time a 60 kg rider on an 8 kg bike (CdA 0.25) takes at a steady 6.5 W/kg through the app's own physics, so drafting and tucking are allowed for. Row-level security is on and nothing is granted: only the security-definer functions read it. Stages that aren't listed (uploaded GPX routes) get only the power check.

### `activities.demo`

`boolean`, default `false`. Set by the app when a ride used the demo power slider or `?timescale`. Such rides never count for leaderboards or ghosts.
## Scheduled group rides and races

No direct table access: `events`, `event_results` and `event_stage_pool` have row-level security on and no grants. Everything goes through the functions below (all `security definer`, `search_path = ''`, executable by signed-in riders only).

### Tables

| Table | Columns |
| --- | --- |
| `event_stage_pool` | `stage_id` (primary key), `name`, `length_m`, `position`: the nine stages the evening race rotates through, in order. |
| `events` | `id` (uuid), `kind` (`race` or `group_ride`), `stage_id`, `starts_at`, `title` (3 to 80 characters), `created_by` (the admin, or null for the automatic schedule), `seed` (seeds the computer-ridden field, so everyone sees the same bots), `pace_wkg` (group rides, 1 to 6), `created_at`. Unique on `(kind, stage_id, starts_at)`. |
| `event_results` | `event_id` (cascades), `user_id`, `finish_s`, `avg_power`, `created_at`. Primary key `(event_id, user_id)`: one result per rider per event. |

### Functions

| Function | Who | What it does |
| --- | --- | --- |
| `ride_is_plausible(p_stage, p_finish_s, p_avg_power, p_demo)` | Internal | True when a ride may be ranked: it has a time, isn't a demo ride, averaged at most 2000 W, and isn't faster than the stage's `min_finish_s` or `max_avg_kmh`; a ride with no power data must also be at least 1.5 times the floor. Not callable from the browser. |
| `stage_leaderboard(...)`, `stage_ghost(...)` | Signed in | Unchanged signatures and columns; both now skip rides that fail `ride_is_plausible()`. |
| `my_data_extras()` | Signed in | JSON for "Download my data": the caller's account (id, name, email, verified, created), live position, ride-ons sent and received (emoji and time only, no names) and the rows of any other table with a text `user_id` column. |
| `delete_my_account()` | Signed in | Deletes the caller's rows from every public table with a text `user_id` (plus ride-ons in both directions), their pending verification codes, and their Neon Auth user (sessions, linked accounts and memberships go with it by foreign-key cascade). Refuses accounts whose email is in `public.admins`. Only ever touches the caller's own data. |
| `server_now()` | Signed in | The database's clock, so the browser can line its start up (offset = server minus local). |
| `upcoming_events(p_hours default 48)` | Signed in | Creates the recurring schedule on demand (a race at 19:30 UTC on `event_stage_pool[(days since 1970) mod 9]`, and a 2.6 W/kg group ride at 12:30 UTC on `heartland`), then returns events from 12 hours ago to `p_hours` ahead (at most 14 days): `id`, `kind`, `stage_id`, `title`, `starts_at`, `seed`, `pace_wkg`, `duration_min` (150 for a race, 90 for a ride), `waiting` (riders in its presence room in the last 15 s), `results` and the caller's `my_finish_s`. |
| `admin_create_event(p_kind, p_stage, p_starts_at, p_title, p_pace_wkg default null)` | Admins | Adds a one-off event (start within 1 hour ago to 90 days ahead) and returns its id. Checks `is_admin()`. |
| `admin_delete_event(p_event)` | Admins | Removes an event that has no results. |
| `submit_event_result(p_event, p_finish_s, p_avg_power default null)` | Signed in, not banned | Records the caller's time for a race, once. Raises an error before the start or more than 4 hours after it, for a time longer than has passed (plus 20 s), for no power or more than 2,000 W, and for a time faster than the stage allows (the stage length at 22 m/s, or `stage_limits.min_finish_s` if that table exists). Returns true if stored, false if the caller already had a result. |
| `event_results(p_event)` | Signed in | The real riders' results, fastest first, up to 100: `rank`, short name, `finish_s`, `avg_power`, `is_me`. Banned riders are left out. |

Riders in an event share a presence room: the client calls `ride_presence()` with the stage key `<stage_id>#event-<event id>` (at most 80 characters), so event riders only see each other.

## Changing the schema

When you change a table or function, update this page and `db/schema.sql` in the same change. See [Contributing](../developer-guide/contributing.md#keep-the-schema-in-sync).
