# Deployment

This page covers how the app is deployed: the Vercel project and automatic deploys from `main`, the GitHub Pages workflow that's also in the repository, environment variables, and the Deployment Protection setting.

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

## GitHub Pages workflow

The repository also contains a GitHub Actions workflow, `.github/workflows/deploy.yml`. On every push to `main` it runs `npm ci`, `npm run build`, and publishes `dist/` to GitHub Pages. The build uses a relative base (`base: './'` in `vite.config.ts`), so it works under a sub-path.

The README and `CLAUDE.md` name Vercel as the deploy target. The GitHub Pages workflow is also active in the repository, so a push to `main` triggers both. Check that GitHub Pages is still wanted before you rely on either address.

## Environment variables

The app reads two Vite variables. Both are optional, because each has a default that points to the production Neon project.

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_NEON_AUTH_URL` | The production Neon Auth endpoint in `src/cloud/client.ts` | Sign-in endpoint. |
| `VITE_NEON_DATA_API_URL` | The production Neon Data API endpoint in `src/cloud/client.ts` | Data API endpoint for the browser. |

Set them in Vercel's environment settings for the project, or in a local `.env` file, if you want a different Neon project or branch. Vite only exposes variables that start with `VITE_`.

The app also reads `VITE_VERCEL_GIT_COMMIT_SHA` to show the version in feedback reports. The repository doesn't set it. Vercel's built-in commit variable is `VERCEL_GIT_COMMIT_SHA`, without the `VITE_` prefix, so reports show `dev` unless you provide a `VITE_` copy.

The endpoints are public. They're not secrets, because row-level security protects the data. See [Security](../developer-guide/security.md).

## Checklist for a release

1. The build passes locally (`npm run build`).
2. The branch is merged to `main` (see [Contributing](../developer-guide/contributing.md)).
3. The Vercel deployment for `main` finishes and the live site loads.
4. If the database changed, `db/schema.sql` is updated in the same change.
5. Sign-in works on the live address.
