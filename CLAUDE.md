# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal, self-hosted alternative to Strava. Users drop `.gpx` files into `data/gpx/` (synced from a phone via Syncthing, or manually), and a Node backend parses and stores them in PostGIS-backed Postgres. A React frontend renders a dashboard, per-activity map/elevation views, and a settings page for re-analysis.

## Running the stack

```
cp .env.example .env
docker compose up --build
```

- Frontend: http://localhost:3000
- GraphQL API (Apollo Server on Express): http://localhost:4000/graphql
- Postgres/PostGIS: localhost:5432
- Syncthing GUI (GPX sync from phone, optional): http://localhost:8384 — start separately with `docker compose up -d syncthing`

The backend has a Vitest suite covering the GPX/IGC/`.skiz` parsers (`backend/src/{gpx,igc,skiz}/parser.test.js`) — run with `cd backend && npm test`. Nothing else in the repo (resolvers, processor, frontend) has test coverage yet. ESLint (flat config, `backend/eslint.config.js` and `frontend/eslint.config.js`) and Prettier (`.prettierrc.json` at repo root) are set up — see "Linting/formatting" below.

### Getting code changes live (this deployment)

`/opt/gpx-report` is the live host itself, not a dev checkout — there's no separate deploy/push step, but `docker compose`'s default images here have **no bind mount for source code**, so editing a file on disk does not change what's running:

- **Backend** (`backend/src/**`): image is built from `backend/Dockerfile` with no source bind mount. A code edit needs `docker compose up -d --build backend` to take effect — restarting the container (`docker compose restart backend`) re-runs the *old* image and silently keeps stale code running.
- **Frontend** (`frontend/src/**`): same story, plus the `VITE_GRAPHQL_URL`/`VITE_CODE_SERVER_URL` build-arg caveat above — always `docker compose up -d --build frontend`. This is the slow one (~8–10 min, see Deployment notes).
- **`docker/init.sql`**: only applied on a fresh Postgres volume — an edit here needs a manual `psql`/`ALTER` against the running DB, not a rebuild (see Database section).
- **Hot-reload dev mode** (in-Docker, doesn't need a separate host checkout): `docker-compose.dev.yml` is an *override* file, applied only when explicitly layered on — `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build backend frontend`. It bind-mounts `./backend/src:/app/src` and `./frontend/src:/app/src` into the `backend`/`frontend` containers and swaps their command for `node --watch src/index.js` / `npm run dev` (frontend built via `frontend/Dockerfile.dev`, a plain `npm ci` + Vite dev server image, skipping the production `vite build` stage entirely) — edits under `backend/src` or `frontend/src` take effect without a rebuild (backend: watch restarts the process; frontend: Vite HMR/live reload). The frontend dev server reads `VITE_GRAPHQL_URL`/`VITE_CODE_SERVER_URL` as real runtime env vars via `import.meta.env` on each request, unlike the production build's compile-time build-arg baking — same `.env` values, different mechanism. A plain `docker compose up`/`up --build` (no `-f docker-compose.dev.yml`) is completely unaffected by this file and behaves exactly as before. To leave dev mode, rebuild the normal way: `docker compose up -d --build backend frontend`.

### Local (non-Docker) dev

- Backend: `cd backend && npm install && npm run dev` (uses `node --watch`; needs `DATABASE_URL` and `GPX_FILES_DIRECTORY` env vars set — see `docker-compose.yml` for the shape).
- Frontend: `cd frontend && npm install && npm run dev` (Vite, binds `0.0.0.0`). Set `VITE_GRAPHQL_URL` if not proxying to `localhost:4000/graphql`.

**Important:** `VITE_GRAPHQL_URL` is baked into the frontend's static JS bundle at **image build time** via a Docker build arg (see `docker-compose.yml`'s `frontend.build.args` and `frontend/Dockerfile`), not read at container runtime. The build arg's value comes from `${VITE_GRAPHQL_URL}` in gitignored `.env` (not hardcoded in `docker-compose.yml`), so the real domain never lands in git — `.env.example` documents it with a placeholder. Changing it requires `docker compose up -d --build frontend` — restarting the container alone won't pick up the new value. `http://localhost:4000/graphql` only works if the browser and backend are on the same machine; for any real deployment this must be a routable domain reachable from wherever the browser runs.

### Linting/formatting

- `backend/eslint.config.js` and `frontend/eslint.config.js` are separate ESLint 9 flat configs (`backend`'s is plain Node/ESM rules; `frontend`'s adds `eslint-plugin-react` + `eslint-plugin-react-hooks` for JSX). A single `.prettierrc.json` + `.prettierignore` at the repo root apply to both. `eslint-config-prettier` is included in each so ESLint doesn't fight Prettier over formatting.
- Run `npm run lint` / `npm run format` inside `backend/` or `frontend/` individually, or from the repo root (`npm run lint` / `npm run format` there delegates into both subprojects).
- A root-level `package.json` (new — this repo otherwise has no root package) exists solely to host `husky` + `lint-staged`, since git hooks need to live at the repo root (`.git` is at `/opt/gpx-report`, not inside either subproject). `.husky/pre-commit` runs `npx lint-staged`, which runs `eslint --fix` then `prettier --write` on staged `.js`/`.jsx` files, scoped to `backend/**` vs `frontend/**` using each subproject's own local ESLint binary and config (see the `lint-staged` block in the root `package.json`).
- After cloning/pulling, run `npm install` at the repo root at least once so `prepare` wires up the husky hook (`git config core.hooksPath` gets pointed at `.husky/_`) — the hook is a no-op if `node_modules`/husky was never installed.

## Architecture

**Backend** (`backend/src`, TypeScript on Node with ESM, no framework/ORM):
- `index.js` — entrypoint; boots Apollo Server on Express (`/graphql`, plus a `GET /activities/:id/download` route for source-file downloads) and starts the GPX directory watcher.
- `db.js` — a single shared `pg.Pool` (default size 10), exported and imported everywhere queries are made.
- `graphql/typeDefs.js` + `resolvers.js` — the whole GraphQL schema and resolver set live in one file each, no per-type splitting. `scalars.js` defines custom `DateTime`/`JSON` scalars.
- `gpx/parser.js` — parses a GPX file with `gpxparser`, computes distance/speed/elevation stats it doesn't provide, and guesses `activityType` from the filename (matches against a fixed word list like "running", "hiking", "skiing"; falls back to "Unknown").
- `gpx/processor.js` — `processFile()` upserts one activity + its route (keyed by `gpx_filename`, so re-processing the same file is idempotent) inside a transaction. Also exports `reanalyzeAll()` / `reanalyzeByDateRange()`, used by the corresponding GraphQL mutations.
- `gpx/watcher.js` — `chokidar` watches `GPX_FILES_DIRECTORY`; on startup it fires an `add` event for every pre-existing file.

**Concurrency constraint (read before touching ingestion code):** the file watcher and the `reanalyze*` mutations both process files with bounded concurrency — the watcher via a strict FIFO queue (one file at a time), `processAll()` in `processor.js` via batches of 5 — instead of firing everything at Postgres at once. The default pool has only 10 connections; syncing a large backlog (e.g. seeding hundreds of historical tracks) without this bound opens far more simultaneous connections than the pool can serve, and files start failing with `Connection terminated unexpectedly`. If you see that error on bulk ingest, it's a concurrency/pool-exhaustion symptom, not a bad GPX file — re-running `reanalyzeAllActivities` is safe since upserts are idempotent. Keep new ingestion paths bounded the same way.

**Database** (`backend/db/init.sql`, applied automatically by the `postgis/postgis` image on first container start):
- `activities` — one row per GPX file, unique on `gpx_filename`.
- `activity_routes` — one row per activity (`activity_id` PK/FK), holding both a PostGIS `GEOMETRY(LineString, 4326)` (`route_geom`, for potential geospatial queries) and a redundant `points_data` JSONB array of `{lat, lon, elevation, timestamp}` (used directly by the frontend map/elevation chart, since GeoJSON round-tripping loses elevation/timestamp per point).
- No migration tooling — `init.sql` only runs against a fresh volume. Schema changes to an existing deployment need a manual `ALTER`/psql step.
- The `activities`/`activity_routes` tables are entirely derived data — every row is regenerated by re-parsing the GPX files in `data/gpx/` (via `processFile`/`reanalyzeAll`, which upsert idempotently). This is a single-user, personal tool with no other consumers, so it's safe to drop, recreate, or wipe the database/volume without asking first or treating it as precious state — for schema changes, prefer `docker compose down -v` + recreate + `reanalyzeAllActivities` backfill over hand-crafted `ALTER TABLE` gymnastics if that's simpler. This does *not* extend to the raw GPX files in `data/gpx/` themselves — those are the real source data and still warrant care.

There's no separate `route`/`elevation` resolver table join beyond `Activity.route`, which reads straight from `activity_routes`.

**Frontend** (`frontend/src`, Vite + React 18, no state management library beyond Apollo cache):
- `apolloClient.js` — plain `HttpLink` pointed at `VITE_GRAPHQL_URL` (see build-arg note above).
- `App.jsx` — top-level routes: `/` (Dashboard), `/activities/:id` (ActivityDetail), `/settings` (Settings). Single global nav, no auth.
- `pages/Dashboard.jsx`, `ActivityDetail.jsx`, `Settings.jsx` — one file per route, no shared component library yet.
- Map rendering via `react-leaflet`/`leaflet`; elevation chart via `recharts`.
- Every page must be usable on both a desktop browser and a mobile phone — this is a hard requirement (the dashboard is regularly checked from a phone), not a nice-to-have.

**Docs**: `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/FEATURES.md` describe the intended v1 design (some sections are still templated/aspirational placeholders). `docs/SETUP.md` is the most current and detailed — it has real, hard-won operational notes (Syncthing pairing/permissions, reverse proxy gotchas, LXC deployment quirks, the pool-exhaustion issue above) worth reading before touching deployment or ingestion.

## Deployment notes

Deployed via `docker compose` on a Proxmox LXC host behind Caddy (see `docs/SETUP.md` §6–7 for the full reverse-proxy and Syncthing pairing walkthrough). Key points if touching deploy-related files:
- All services already have `restart: unless-stopped`; no extra systemd unit is needed for reboot survival as long as the Docker daemon itself is enabled.
- `.env` is gitignored; a fresh host needs `cp .env.example .env` with a real `POSTGRES_PASSWORD` before first `docker compose up`.
- The frontend image build (`npm install` + `vite build`) is the slow step (~8–10 min on a fresh host) — don't assume a long `docker compose up --build` is hung.
- Syncthing needs `PUID`/`PGID` left at `0` (root) in `docker-compose.yml`, or it crash-loops on first boot trying to write its cert into a root-owned config volume.
- `code-server` (browser-based VS Code, port 8443) is bind-mounted read-write at the repo root and runs with `--auth none` — no login. It's reachable via `https://gpx-report-code.example.com` (a Caddy site, `reverse_proxy localhost:8443`, matching the GraphQL API site) and iframed by the frontend's Code tab (`VITE_CODE_SERVER_URL` build arg). That domain only resolves/routes within Tailscale on this deployment, so it relies entirely on the Tailscale/LAN network boundary for access control, same as the Syncthing GUI and Postgres port — not on code-server's own auth. See `docs/SETUP.md` §7.

## Behavioral Guidelines

### 1. Think Before Coding

- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them—don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.

### 2. Simplicity First

- No features beyond what was asked.
- No abstractions for single-use code.
- No error handling for impossible scenarios.
- If 200 lines could be 50, rewrite it.

### 3. Surgical Changes

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated issues, mention them—don't fix them.
- Remove only what YOUR changes made unused.

### 4. Goal-Driven Execution

- Transform tasks into verifiable goals.
- For multi-step tasks, state a brief plan with verification steps.
- Unverified work is incomplete work.

### 5. Output Precision

- Lead with findings, not process descriptions. 
- Avoid unnecessary intros like, "this is where it gets interesting", "Great news!", "Here's the deal...", "Let's dive in", etc.
- Use structured formats (lists, tables, code blocks).
- Include absolute file paths—never relative.

## Other Global Rules:

### Temporary work

- the directory `.mark` is globally gitignored, but you are allowed to read and write files in a `.mark` folder. You can create it if it doesn't exist in the project folder. Use it for temporary files that shouldn't be committed, like branch context files, private notes, project plans, and to-do lists for tasks.

### Operating rules

- **Push after every commit.** Once a commit is created (whether user-requested or as part of an approved task), immediately `git push` it too — don't leave commits sitting local unless the user says otherwise for that specific commit.
- **Prefer the simpler / existing approach.** Before writing new code, look for an existing utility, hook, helper, or pattern that already solves the problem. Before listing/enumerating things, check if they can be derived (e.g., glob a directory instead of hardcoding names). Before adding defensive preflight checks (`canOpen` before `open`, `exists` before `read`), prefer try/catch — internal code can trust its callers.
- **Distinguish "research" from "do."** When I ask "how hard would it be," "is it safe to," "compare X and Y," "look at the diff," "tell me," or "should we" — that is a request for analysis, not implementation. Report findings and a recommendation; do not write code or run mutations until I confirm. If unsure which mode I want, ask.
- **Docs sweep before every commit.** Before committing an implementation change, check whether `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/FEATURES.md`, `docs/SETUP.md`, or `docs/TODO.md` describe the thing you just changed, and update them in the same commit if they're now wrong or missing the new behavior (beyond the usual `docs/TODO.md` check-off). Skip files that clearly don't apply — this isn't "touch every doc every time," it's "don't leave docs describing the old behavior."
- **Docs describe what is, not what was.** `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, and `docs/FEATURES.md` describe current state and the reasoning behind it — not a changelog of what used to be true or what changed. Don't write "X used to be Y, now it's Z" or "previously unused, now wired up"; write what X is and why, present tense. History/narrative belongs in `docs/TODO.md`'s Done section and commit messages, not in the reference docs.
- **`docs/TODO.md` gets hand-edited by the user too**, outside of any Claude session — don't assume its current contents were last touched by Claude; re-read it fresh rather than relying on memory of its state, especially after a pull.
- **On a failed `git push`** (rejected, non-fast-forward): always pull/fetch and read the diff before retrying or force-pushing. The user sometimes commits directly to the repo by hand — a rejected push usually means one of those landed first, and the diff may change what the current task needs to do. Never blindly force-push over a rejection without looking first.
- **Amend consecutive TODO-only commits.** When adding another item to `docs/TODO.md` and the immediately preceding commit was *also* just a TODO addition (no code change) — check `git log -1`/`git show --stat HEAD` — amend that commit instead of stacking a new one. If the last commit included real code/doc changes alongside a TODO checkoff, or wasn't TODO-only, make a normal new commit instead.
- **Yes/no confirmations use `AskUserQuestion`.** When a turn would naturally end in a yes/no question ("want me to commit this now?", "should I proceed?"), use the `AskUserQuestion` tool with tappable Yes/No options instead of ending in plain-text prose — faster to answer from a phone. Open-ended or multi-step clarifications that don't reduce to yes/no can still use `AskUserQuestion`'s multi-option form when useful.
- **New backend logic ships with tests.** When adding or changing a pure/near-pure `backend/src/**` module (parsers, writers, `track/*`, scalars, resolver-side computation) — anything not gated purely behind a live DB/network call — add or extend a Vitest `*.test.js` file in the same commit, following the existing fixture-file/tmpdir conventions (`backend/src/gpx/writer.test.ts`, `backend/src/track/geo.test.ts`, etc.). Local `node` on this host is too old for `vitest` (v18, needs v20+) — run `docker run --rm -v $(pwd)/backend:/app -w /app node:22 sh -c "npm install --silent && npm test"` instead of `cd backend && npm test` directly. Skip this for resolver/processor code whose logic is inseparable from a live Postgres call — those integration-test gaps are tracked in `docs/TODO.md`'s "Test coverage gaps" section — and for frontend changes until a frontend test runner exists (same TODO section).

# Caveman Mode

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
