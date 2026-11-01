# Deployment

This page covers how the app is deployed: the Vercel project and automatic deploys from `main`, environment variables, and the Deployment Protection setting.

## Vercel

The live site is built and hosted by a Vercel project called `americanflyers`, in the team "hodgy007's projects".

- **Trigger:** every push to `main` builds and deploys the app automatically.
- **Build:** `npm run build`, which type-checks with `tsc --noEmit` and then runs `vite build` to produce `dist/`. See [Local development](../developer-guide/local-development.md#build).
- **Live address:** https://americanflyers.vercel.app

The repository has no `vercel.json`, so the project's settings live in the Vercel dashboard.

### Preview deployments

Vercel also builds other branches. These are preview deployments, with their own addresses, and the repository doesn't configure them. Preview addresses only work for sign-in if they're on the trusted domains list (see [Authentication setup](authentication-setup.md#1-add-trusted-domains)).

### Deployment Protection

Vercel's Deployment Protection can require a login to view deployments. It must be **off** for public sign-ups to work. Check it in the Vercel dashboard for the `americanflyers` project. The repository doesn't set this, so this is a dashboard check.

Vercel is the only deploy target. (An earlier GitHub Pages workflow was removed.)

## Environment variables

The app reads two Vite variables. Both are optional, because each has a default that points to the production Neon project.

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_NEON_AUTH_URL` | The production Neon Auth endpoint in `src/cloud/client.ts` | Sign-in endpoint. |
| `VITE_NEON_DATA_API_URL` | The production Neon Data API endpoint in `src/cloud/client.ts` | Data API endpoint for the browser. |

Set them in Vercel's environment settings for the project, or in a local `.env` file, if you want a different Neon project or branch. Vite only exposes variables that start with `VITE_`.

The app also reads `VITE_VERCEL_GIT_COMMIT_SHA` to show the version in feedback reports. The repository doesn't set it. Vercel's built-in commit variable is `VERCEL_GIT_COMMIT_SHA`, without the `VITE_` prefix, so reports show `dev` unless you provide a `VITE_` copy.

### The AI function (server-side)

`api/ai.ts` is a Vercel serverless function (the one piece of server code). It reads these variables from the Vercel project's environment (they are **secrets, not `VITE_`**, and never reach the browser):

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | none (required) | Lets the function call Claude. Without it the AI answers `503 not_configured` and riders see the built-in tips and lines. Removing it turns the AI off for everyone. |
| `AI_MODEL` | `claude-opus-5-5` | The Claude model. `claude-haiku-5-5` is a much cheaper choice. |
| `VITE_NEON_DATA_API_URL` | The production Data API | The function uses the same Data API URL as the app. |

After changing a variable, redeploy. Riders have daily limits per kind of AI message (see [AI coach and rivals](../developer-guide/ai.md)), enforced in the database. Each call logs one line with token counts in the Vercel function logs.

The endpoints are public. They're not secrets, because row-level security protects the data. See [Security](../developer-guide/security.md).

## Checklist for a release

1. The build passes locally (`npm run build`).
2. The branch is merged to `main` (see [Contributing](../developer-guide/contributing.md)).
3. The Vercel deployment for `main` finishes and the live site loads.
4. If the database changed, `db/schema.sql` is updated in the same change.
5. Sign-in works on the live address.

## Error reporting (Sentry)

The app reports crashes to Sentry (organisation `hodgy007`, project `sentry-byzantium-car`) using `@sentry/browser` ([`src/monitoring.ts`](../../src/monitoring.ts)).

- **It's off unless the build has a DSN.** `vite.config.ts` reads it at build time from `VITE_SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` or `SENTRY_DSN`; the Vercel Sentry integration normally sets one of these on the project. The DSN is public by design: it only lets the browser send reports.
- **Source maps** upload automatically when `SENTRY_AUTH_TOKEN` is set (also from the integration), so stack traces show the TypeScript. They're deleted from the build afterwards, so they aren't published.
- **What's sent:** the error and stack trace, the stage, the release (git commit) and, for signed-in riders, their account id only. No names, emails, cookies, headers, request bodies or URL query strings (a password reset token is scrubbed), and no session replays. 10% of page loads send a performance trace.
- **Ignored:** closing the Bluetooth device chooser, and browsers blocking autoplay or audio.
- To check it's working, open the site, then in the browser console run `setTimeout(() => { throw new Error('Sentry test') })` and look for the issue in Sentry.

If the integration didn't add a DSN, copy it from Sentry (**Settings → Projects → sentry-byzantium-car → Client Keys (DSN)**) into a Vercel environment variable named `VITE_SENTRY_DSN`, and redeploy.
