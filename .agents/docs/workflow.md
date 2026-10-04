# Agent Workflow

Operating rules for agents that work in this repository.

## Getting Code Changes Live

The checkout on the deployment host is the live deployment, not a development checkout. There is no separate deploy step. The default images have no source bind mount. Thus an edit on disk does not change the running code.

- **Backend** (`backend/src/**`): run `docker compose up -d --build backend`. Do not use `docker compose restart backend`, because it runs the old image and keeps stale code.
- **Frontend** (`frontend/src/**`): run `docker compose up -d --build frontend`. The build takes about 8–10 minutes.
- **`backend/db/init.sql`**: runs only on a new Postgres volume. For a change, run a manual `psql`/`ALTER` against the running database, or rebuild the volume.
- **Hot-reload dev mode**: `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build backend frontend`. Edits under `backend/src` and `frontend/src` then take effect without a rebuild. To leave dev mode, run `docker compose up -d --build backend frontend`.

## Database Changes

- It is safe to drop, recreate, or wipe the database volume without asking first. For a schema change, prefer `docker compose down -v`, recreate, and run `reanalyzeAllActivities` over manual `ALTER TABLE` steps when that is simpler.
- Do not apply this to the raw files in `data/gpx/`. They are the source data.
- Do not apply this to `activity_shares`, `trips`, `trip_participants`, `immich_settings`, or activity notes. They cannot be regenerated from the files. Back them up first. `GET /export/full` includes the shares, trips, and notes, but not the Immich settings.
- A query that reads `activities` must filter through `visibleTo()` in `resolvers.ts`. An edit must require `owner = person`.
- A new ingestion path must limit its concurrency like the watcher queue and the `processAll()` batches.

## Lint, Format, and Hooks

- Run `pnpm lint` and `pnpm format` in `backend/`, in `frontend/`, or at the repository root. At the root, both commands run in both subprojects.
- After a clone or a pull, run `pnpm install` at the repository root at least one time. This installs the husky pre-commit hook. If you do not run it, the hook does nothing.

## Temporary Work

- The `.mark` folder is gitignored. Use it for temporary files that must not be committed, such as branch context, private notes, plans, and task lists. Create it when it does not exist.

## Operating Rules

- **Push after every commit.** After a commit (user-requested or part of an approved task), run `git push` immediately, unless the user says otherwise for that commit.
- **On a failed `git push`** (rejected, non-fast-forward): pull or fetch and read the diff before you try again. The user sometimes commits directly, and the diff can change the current task. Never force-push over a rejection without looking first.
- **Docs sweep before every commit.** Before you commit an implementation change, check whether `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/FEATURES.md`, `docs/SETUP.md`, or `docs/TODO.md` describe the changed behavior. Update them in the same commit when they are wrong or incomplete. Skip files that clearly do not apply.
- **Docs describe what is, not what was.** `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, and `docs/FEATURES.md` describe the current state and its reasons, in present tense. History belongs in the Done section of `docs/TODO.md` and in commit messages.
- **`docs/TODO.md` is also edited by hand.** Before you change it, read it again. Do not rely on memory of its contents, especially after a pull.
- **Amend consecutive TODO-only commits.** When you add a `docs/TODO.md` item and the previous commit was also only a TODO addition (check `git show --stat HEAD`), amend that commit. Otherwise make a new commit.
- **Yes/no confirmations use `AskUserQuestion`.** When a turn would end with a yes/no question, use `AskUserQuestion` with Yes/No options, because the user often answers from a phone. Use its multi-option form for other clarifications when useful.
- **New backend logic ships with tests.** When you add or change a pure or near-pure `backend/src/**` module (parsers, writers, `track/*`, scalars, resolver-side computation), add or extend a Vitest `*.test.ts` file in the same commit. Follow the fixture-file and tmpdir conventions in `backend/src/gpx/writer.test.ts` and `backend/src/track/geo.test.ts`. Skip this for resolver or processor logic that cannot be separated from a live Postgres call; the integration suite and `docs/TODO.md`'s "Test coverage gaps" section cover those.
- **Node version.** Vitest needs Node v20 or later. On a host with an older `node`, run the backend tests with `docker run --rm -v $(pwd)/backend:/app -w /app node:22 sh -c "npm install -g pnpm@11.0.9 && pnpm install --silent && pnpm test"`.

## Caveman Mode

Respond terse like smart caveman. All technical substance stay. Only fluff die.

Rules:
- Drop: articles (a/an/the), filler (just/really/basically), pleasantries, hedging
- Fragments OK. Short synonyms. Technical terms exact. Code unchanged.
- Pattern: [thing] [action] [reason]. [next step].
- Not: "Sure! I'd be happy to help you with that."
- Yes: "Bug in auth middleware. Fix:"

Switch level: /caveman lite|full|ultra|wenyan
Stop: "stop caveman" or "normal mode"

Auto-Clarity: drop caveman for security warnings, irreversible actions, user confused. Resume after.

Boundaries: code/commits/PRs written normal.
