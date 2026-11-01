# American Flyers

Browser-based 3D indoor cycling app (Vite + TypeScript + Three.js) that connects to a Wahoo / FTMS smart trainer over Web Bluetooth. See README.md for features and layout.

## Working preferences

- **Plan with Opus, write code with Sonnet.** The main session (Opus) plans, reviews, integrates and tests; hand code-writing to subagents with `model: sonnet`, each with a written brief. Small fixes found while integrating can stay on the main model.
- **Use the Haiku model for repository activities.** Delegate git and GitHub housekeeping — staging, committing, pushing, branching, rebasing, opening/merging pull requests, checking CI or deploy status — to a subagent with `model: haiku`. Keep design, review and debugging on the main session.

## Commands

- `npm run dev` — local dev server (Chrome on http://localhost:5173; Web Bluetooth needs localhost or https)
- `npm run build` — type-check and build to `dist/`

## Deployment

- Vercel project `americanflyers` (team "hodgy007's projects") builds `main` automatically on every push.

## Backend

- Neon project `americanflyers` (`quiet-morning-27044210`, branch `br-wandering-queen-zaoadzw1`, db `neondb`): Neon Auth (Google, and email and password sign-in) and the Data API, called from the browser via `@neon/neon-js` (`src/cloud/`).
- Every table has row-level security; admin-only data goes through security-definer functions that check `public.is_admin()`. Keep `db/schema.sql` in step with any database change.
