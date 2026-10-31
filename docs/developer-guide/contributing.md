# Contributing

This page covers how to contribute: branch names, commit messages, the project's preference for the Haiku model on repository work, keeping `db/schema.sql` in step with the database, and the deploy flow.

## Before you start

- Read [Architecture](architecture.md) and [Project structure](project-structure.md).
- Run the app with [Local development](local-development.md).
- Check that `npm run build` and `npm test` pass on a clean checkout.

## Project preferences

`CLAUDE.md` records how this project wants work to be done:

- **Use the Haiku model for repository activities.** Git and GitHub housekeeping (staging, committing, pushing, branching, rebasing, opening and merging pull requests, and checking CI or deploy status) should go to a subagent running the Haiku model. Keep design, coding and debugging on the main model.
- **Build commands.** `npm run dev` starts the local server, `npm run build` type-checks and builds to `dist/`, `npm test` runs the unit tests, and `npm run test:e2e` runs the browser smoke test.
- **Keep `db/schema.sql` in step** with any database change.
- **Deployment.** Vercel builds `main` on every push.

## Branches

Branches in this repository's history use the `claude/` prefix, for example `claude/virtual-bike-app`. Create a new branch from `main` for each piece of work, and don't rewrite a branch that someone else has pushed.

## Commits

The commit history uses short, imperative subject lines, such as *Add GPX route upload for practicing real rides*. The body explains what changed, as a list when there are several parts. Keep subjects to one line.

End each commit message with the trailers the team uses, for example:

```
Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_…
```

Keep generated files out of commits. `dist/` and `node_modules/` are in `.gitignore`.

## Pull requests

Merge work through pull requests, as the history shows (`Merge pull request #1`, `#2`, `#3`). A pull request should:

- pass `npm run build` and `npm test` (CI runs both, plus the browser smoke test, on every pull request),
- add or update a unit test when you change pure logic (physics, drafting, stages, workouts, the race engine),
- describe what changed and why, and
- include the schema change, if there is one.

Vercel builds other branches as preview deployments. Check the preview before you merge, and check the live site after the merge to `main`. See [Deployment](../admin-guide/deployment.md).

## Keep the schema in sync

`db/schema.sql` is the reference for the database. Its header says it was applied through the Neon console or MCP, and kept for reference and to rebuild a branch. So when you change the database:

1. Make the change in a Neon branch first.
2. Update `db/schema.sql` in the same commit as the code that needs it.
3. Keep the policies, grants, triggers and functions in the file, not only in the database.
4. Update [Database schema](../reference/database-schema.md) if you changed a table or function.

Data changes, such as adding an admin, don't belong in the schema file, unless you're recording the first row of a new table.

## Code conventions

The code has no linter. Follow the style of the file you're editing:

- TypeScript in strict mode. `noUnusedLocals` and `noUnusedParameters` are on, so unused code fails the build.
- Modules are small and focused. The module boundaries are described in [Architecture](architecture.md).
- Keep the frame loop free of network calls. Saving and syncing belong in event handlers and background calls.
- Wrap every `localStorage` read and write in `try`/`catch`. Storage can be blocked, as in private browsing.

## Documentation

When you change behavior that riders or admins see, update the matching page in `docs/`. The index in [`docs/README.md`](../README.md) lists every page.

## Where to ask

Use the issues or pull request comments in the GitHub repository for questions about the code. For what riders report, see [Feedback](../user-guide/feedback.md).
