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

## Content-Security-Policy

`vercel.json` sends `Content-Security-Policy-Report-Only`, so a violation is logged in the browser console and blocks nothing. The policy is built by [`csp.mjs`](../../csp.mjs) from `index.html`; `vite.config.ts` sends the same header from `vite preview` and `vite dev` (the dev one adds its HMR websocket and style injection), and `tests/unit/csp.test.ts` fails if `vercel.json` differs from what `csp.mjs` builds. After changing `csp.mjs` or an inline script in `index.html`, run `npm run csp:sync`. `tests/e2e/csp.spec.ts` loads the home page, then a signed-in session through the hub, a Medium-graphics ride at Kestrel Vale's village (a `.glb` hero model, the post-processing chunk) and every main dialog, and fails on any violation.

| Directive | Allows | Why |
| --- | --- | --- |
| `default-src 'none'` | nothing | Everything the app loads is listed below; anything new has to be added on purpose. |
| `script-src 'self' 'wasm-unsafe-eval' 'sha256-…'` | our bundles, the two inline scripts in `index.html` by hash, WebAssembly | The inline scripts set `data-hero` and `data-start` before first paint, which an external file would delay by a request, so they are allowed by sha256 (computed from `index.html`, so editing one needs `npm run csp:sync`). The Meshopt decoder that reads the `.glb` models compiles WebAssembly. No `'unsafe-inline'`, no `'unsafe-eval'`. |
| `style-src 'self' https://fonts.googleapis.com` | our stylesheet, Google Fonts' CSS | No inline `<style>` and no `style=""` attributes: the few that existed (the hub skeleton in `index.html`, the kit swatches, the garage level bar) now use classes or the CSSOM (`el.style.x = …`, which a CSP allows). New code must not write `style="…"` into `innerHTML`. |
| `font-src https://fonts.gstatic.com` | the font files | Barlow Condensed and Inter. |
| `img-src 'self' data: blob:` | our images, `data:` and `blob:` | `data:` is the select arrow in `style.css`; `blob:` is for textures decoded from the models (the browser test fails without it). Google profile pictures are not shown anywhere, so no third-party image host is allowed. |
| `media-src 'self'` | the hero clips and commentary audio | Both are ours. |
| `connect-src 'self' blob: <Neon Data API> <Sentry ingest>` | `/api/auth` and `/api/ai` (our origin), `blob:` (three.js's image loader fetches the textures it makes from blob URLs: the browser test fails without it), the Neon Data API host the browser calls directly (`src/cloud/client.ts`), and Sentry's ingest hosts (`*.ingest.sentry.io`, `*.ingest.us.sentry.io`, `*.ingest.de.sentry.io`: the DSN is only known at build time, so the regions are listed). The Google sign-in redirect is a navigation, not a connection, so it needs nothing. | A `VITE_NEON_DATA_API_URL` override is added to the dev and preview header (not to `vercel.json`). |
| `worker-src 'self' blob:` | the service worker, and blob workers | `/sw.js`; the ride-clock tick worker (`src/tickWorker.ts`) and the Meshopt decoder's workers are created from blob URLs. |
| `manifest-src 'self'` | `manifest.webmanifest` | |
| `base-uri 'self'`, `form-action 'self'`, `object-src 'none'` | | Nothing here needs a different base, a form posting elsewhere or a plugin. |
| `frame-ancestors 'none'` | | The same as `X-Frame-Options: DENY`. |

Nothing needs `'unsafe-inline'` or `'unsafe-eval'` in production. One third-party behaviour had to be handled: zod (inside the Neon SDK) probes `new Function('')` to speed up validation, which a strict policy reports as a violation even though zod copes with the refusal. `src/cloud/client.ts` therefore switches zod's JIT off (`config({ jitless: true })`) before the SDK loads, which is why zod has a chunk of its own (`vendor-zod` in `vite.config.ts`).

**Not enforcing yet, and no report endpoint.** The policy is report-only and has no `report-uri` / `report-to`, so only the rider's own console sees a violation: nobody finds out about one in production. What has to be true before it is switched to enforcing is in the [improvement plan](improvement-plan.md#c-security-header-dependencies-and-docs).

## No secrets in the client

The app bundles these values, and they're all public:

- the Neon Auth and Data API endpoints in `src/cloud/client.ts`,
- the settings, workout and route data in `localStorage`, and
- the Google and email sign-in flows, which run through Neon Auth.

Passwords go straight to Neon Auth and are never stored by the app. OAuth client secrets (for example your own Google client) belong only in the Neon Console, never in the repository, chat, or any file the app reads.

Don't add a service-role key, a database password or an API key to the client code. Anything in the bundle can be read by anyone who opens the page.

## The AI function

`api/ai.ts` is the only server code. The Anthropic key (`ANTHROPIC_API_KEY`) lives only in the Vercel environment. The function never trusts the browser about who the rider is: it forwards the rider's own Neon token to the database function `ai_claim()`, which checks sign-in, opt-in (`ai_consent`), ban and the daily quota (`ai_usage`), and returns the first name, FTP, weight and rival memory for the prompt (never the email). A bad token is a 401, no opt-in or a ban a 403, over quota a 429. The request body is size-capped and validated with zod; text that reaches a prompt (a route's name) is reduced to plain characters; replies are length-limited and checked before they are shown. Rival memory notes are trimmed in the database. The function logs token counts, never names, ids or tokens. See [AI coach and rivals](ai.md).

## What the browser stores

`localStorage` holds settings, workouts, routes, and rides waiting to upload (the offline queue). It's readable by any script on the same origin, so don't store secrets there. Routes include GPS coordinates, which are personal data. They stay on the device unless you're signed in, and then they're in your account.

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
- **The Content-Security-Policy only reports.** It is not enforced yet (see above).
- **No rate limiting in the app.** The app doesn't limit how often riders send feedback, save rides or sync. Any limits come from the database and Neon.

## Reviewing a change

When you change the schema, check that:

- every new table has RLS enabled and a policy for each command it allows,
- no new grant goes to `anonymous`,
- every new security-definer function sets `search_path = ''`, checks `is_admin()` (or the caller's identity), and has its execute grants set, and
- `db/schema.sql` matches the database. See [Contributing](contributing.md#keep-the-schema-in-sync).
