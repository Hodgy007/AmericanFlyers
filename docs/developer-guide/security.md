# Security

This page explains what protects what in American Flyers: row-level security, security-definer functions, the feedback triggers, the admin checks, trusted domains, and the rule that no secrets live in the client. It also lists the gaps you should know about.

## The model in one paragraph

The browser is trusted to do what its user asks, and no more. Everything that matters is enforced in Postgres. Each rider can only reach their own rows, through row-level security. Admin actions are functions that check the caller is an admin before they do anything. The browser's checks are for the user experience, not for security.

## What protects what

| Asset | Protection | Where |
| --- | --- | --- |
| A rider's settings, workouts, routes, rides, FTP history | RLS policy `<table>_owner`: `user_id = auth.user_id()` for reads and writes. | `db/schema.sql` |
| Feedback | RLS policies: riders insert and read their own; admins read, update and delete all. | `db/schema.sql` |
| Feedback message and identity | Trigger `feedback_on_update` keeps `user_id`, `message`, `category` and `created_at`. Insert trigger sets `user_id` and `status`. | `db/schema.sql` |
| The admin list | RLS with no policies, and no grants. Read only by security-definer functions. | `db/schema.sql` |
| Admin dashboard data | Functions that call `is_admin()` and raise *Admins only*. | `db/schema.sql` |
| Ban | `admin_set_ban` checks `is_admin()` and refuses self-bans. | `db/schema.sql` |
| Sign-in return addresses | Neon Auth's trusted domains. | Neon Console |
| Anonymous access | `revoke all … from anonymous` on the rider and feedback tables. | `db/schema.sql` |

## Row-level security

RLS is enabled on every table in the `public` schema that the browser can reach. The rider tables use a single policy each, so there's no path to another rider's rows through the Data API. The policy checks `user_id` on both `using` (reads, updates and deletes) and `with check` (inserts and updates), so a rider can't insert a row for someone else or move a row to another account.

`auth.user_id()` is provided by Neon Auth and returns the signed-in user's ID. A request without a session has no user ID, so it can't match any rider row.

## Security-definer functions

The admin functions are `security definer`, so they run with the owner's privileges, and can read `neon_auth."user"` and `public.admins`. That makes them careful about three things:

- **`search_path = ''`** is set on every function, so names resolve to schema-qualified objects only. This stops a caller from putting a look-alike function earlier in the path.
- **Explicit checks.** Each function calls `public.is_admin()` first and raises an error if it's false.
- **Explicit grants.** Execute is revoked from `public` and `anonymous`, and granted to `authenticated`.

`is_admin()` itself requires the account's email to be verified and the account not to be banned, so banned admins lose access at once.

## Feedback triggers

The insert trigger means a rider can't submit feedback with a status other than `new`, a reply, or someone else's user ID. The update trigger means that even an admin can't rewrite a rider's message or change who wrote it. Riders have no update or delete policy, so they can't edit or remove feedback either.

## Trusted domains

Neon Auth only returns users to trusted domains. Add the live site and any local addresses in the Neon Console. This prevents sign-in from sending users back to an unknown site. See [Authentication setup](../admin-guide/authentication-setup.md).

## No secrets in the client

The app bundles these values, and they're all public:

- the Neon Auth and Data API endpoints in `src/cloud/client.ts`,
- the settings, workout and route data in `localStorage`, and
- the Google and email sign-in flows, which run through Neon Auth.

Passwords go straight to Neon Auth and are never stored by the app. OAuth client secrets (for example your own Google client) belong only in the Neon Console, never in the repository, chat, or any file the app reads.

Don't add a service-role key, a database password or an API key to the client code. Anything in the bundle can be read by anyone who opens the page.

## What the browser stores

`localStorage` holds settings, workouts, routes, and a ride held back until sign-in. It's readable by any script on the same origin, so don't store secrets there. Routes include GPS coordinates, which are personal data. They stay on the device unless you're signed in, and then they're in your account.

## Riding together, leaderboards and ghosts

- `live_riders` can't be read or written directly. `ride_presence()` writes only the caller's own row, clamps every value, and returns other riders' **hashed** ids and **short names** (*First L.*), never emails or full names.
- `ride_ons` can't be read or written directly. `send_ride_on()` takes only a hashed id and one of four emoji, resolves it against riders seen in the last 15 s, and rate-limits the caller. `my_ride_ons()` returns only the caller's own ride-ons, with the sender's hashed id and short name. There is no free text.
- A rider's kit is stored as `#rrggbb,#rrggbb,#rrggbb`; `ride_presence()` keeps it only if it matches that pattern, and the browser re-checks it before drawing.
- `stage_ghost()` returns only a ride's distance trace and time, never its power, heart rate or other samples.
- Positions are shared only while a rider is signed in, on a stage, and has **Ride together** on. Hiding the tab removes the row; stale rows are deleted after 10 minutes.

## Email accounts

- Sign-up asks only for a rider name, email, password, weight and (optionally) FTP. No phone number or address is collected anywhere.
- Passwords are handled by Neon Auth (Better Auth); the app never stores them.
- **Email verification is off**, so an email account doesn't prove the rider owns the address. Admin access needs a verified email (`is_admin()` checks `emailVerified`), so an email account can't become an admin by using an admin's address. Turn on verification in Neon Auth if that matters for other features.

## Known gaps

These are things the code doesn't enforce. Fix them or work around them before relying on the behavior.

- **The ban relies on Neon Auth.** The app sets the `banned` flag and removes sessions. Whether the banned rider can sign in again depends on Neon Auth honoring that flag.
- **No account deletion.** Riders can delete their own rides, but nothing in the app removes the account or its rows.
- **Feedback context is sent with every report.** It includes the browser user agent and screen size. That's useful for debugging, but it's visible to admins.
- **Riding together trusts the client's position and speed.** Values are clamped, but a rider could report a made-up position. Leaderboard times also come from the client.
- **No rate limiting in the app.** The app doesn't limit how often riders send feedback, save rides or sync. Any limits come from the database and Neon.

## Reviewing a change

When you change the schema, check that:

- every new table has RLS enabled and a policy for each command it allows,
- no new grant goes to `anonymous`,
- every new security-definer function sets `search_path = ''`, checks `is_admin()` (or the caller's identity), and has its execute grants set, and
- `db/schema.sql` matches the database. See [Contributing](contributing.md#keep-the-schema-in-sync).
