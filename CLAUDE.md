# American Flyers

Browser-based 3D indoor cycling app (Vite + TypeScript + Three.js) that connects to a Wahoo / FTMS smart trainer over Web Bluetooth. See README.md for features and layout.

## Working preferences

- **Plan with Opus, write code with Sonnet.** The main session (Opus) plans, reviews, integrates and tests; hand code-writing to subagents with `model: sonnet`, each with a written brief. Small fixes found while integrating can stay on the main model.
- **Use the Haiku model for repository activities.** Delegate git and GitHub housekeeping — staging, committing, pushing, branching, rebasing, opening/merging pull requests, checking CI or deploy status — to a subagent with `model: haiku`. Keep design, review and debugging on the main session.
- **Commit as you go.** This Cloud sandbox resets between turns and wipes uncommitted work, including untracked generated assets and caches. Commit and push each finished, verified step straight away instead of leaving changes in the tree.

## Commands

- `npm run dev` — local dev server (Chrome on http://localhost:5173; Web Bluetooth needs localhost or https)
- `npm run build` — type-check the app, `api/` and the tests, then build to `dist/` (`npm run typecheck:tests` checks the tests alone)

## Deployment

- Vercel project `americanflyers` (team "hodgy007's projects") builds `main` automatically on every push.
- Google sign-in on Vercel previews: Neon Auth only redirects to trusted domains, and wildcards must be a whole leftmost label. When opening a PR, add that branch's fixed preview URL (`https://americanflyers-git-<branch-with-slashes-as-dashes>-hodgy007s-projects.vercel.app`) to Neon Auth's trusted domains, and remove it after merging.

## Backend

- Neon project `americanflyers` (`quiet-morning-27044210`, branch `br-wandering-queen-zaoadzw1`, db `neondb`): Neon Auth (Google, and email and password sign-in) and the Data API, called from the browser via `@neon/neon-js` (`src/cloud/`). The branch is the project's default branch: don't assume the id fixed. Auth is reached through our own origin at `/api/auth` (passed to Neon Auth by the `api/auth-proxy.ts` function in production — a plain rewrite won't do, Neon rejects its `X-Forwarded-Host` — and by `vite.config.ts` locally) so its cookie is first-party for Safari; don't point the client at Neon's auth domain directly.
- Every table has row-level security; admin-only data goes through security-definer functions that check `public.is_admin()`. Keep `db/schema.sql` in step with any database change (its header carries a schema version; the file is re-runnable).

## Higgsfield (generated art assets)

Models and textures in `public/models/` and `public/textures/` come from Higgsfield (see `public/models/README.md`). Use the **Higgsfield CLI**, not the MCP server, from a Cloud workspace:

1. `npm install -g @higgsfield/cli` (sandboxes are ephemeral: expect to reinstall).
2. `higgsfield auth login` **as a persistent background process** (`background_process` with `persistent: true`). Session-lifetime processes are killed at the end of a turn and the PKCE verifier goes with them, so a login started normally always fails when the user replies a minute later.
3. The CLI prints `Waiting for approval…` and writes `~/higgsfield-auth-*/sign-in.html`; read the `clerk.higgsfield.ai/oauth/authorize?...` URL out of it (decode `&amp;`) and give it to the user in a fenced code block, so chat clients don't mangle `&`/`%3A`. They sign in, land on `http://localhost:8765/callback?code=…&state=…` (which cannot load on their machine — that is expected) and paste that URL back; replay it inside the sandbox: `curl 'http://localhost:8765/callback?code=…&state=…'`. The page says "Device authorized".
4. `higgsfield workspace set <id>` if it says "No workspace selected" (`higgsfield workspace list`); `higgsfield account status` shows plan and credits.
5. Pick and price before spending: `higgsfield model get <job_type> --json`, `higgsfield generate cost <job_type> --prompt … --image-references <file>`, then `higgsfield generate create <job_type> … --wait --json`. Confirm the credit spend with the user first.

The asset pipeline that matches `public/models/README.md`: `gpt_image_2_5` (front view, plain background, orthographic; 0.25–1 credit) → `tripo_h3_1_image_to_3d` (9 credits, `geometry_quality detailed`, `face_limit` ~15000) or `tripo_h3_1_multiview_to_3d` (9) with views from `3d_jutsu_angles` (2.5). Then shrink with `npx @gltf-transform/cli resize`/`webp`/`simplify` — no Draco or Meshopt, the app has no decoder.

Credentials live at `~/.config/higgsfield/credentials.json` (`HIGGSFIELD_CREDENTIALS_PATH` overrides it) and last about a day; never copy them, tokens or auth codes into the repo, `kilo.json` or a commit. `kilo.json`'s `higgsfield` MCP entry is for users' local clients only; it needs a browser for OAuth and is not how Cloud workspaces generate. Keep generated originals in `scripts/.cache/` (gitignored), and only the final `.glb` in `public/models/`.
