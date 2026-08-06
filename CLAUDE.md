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
- GraphQL API (Apollo Server standalone): http://localhost:4000/graphql
- Postgres/PostGIS: localhost:5432
- Syncthing GUI (GPX sync from phone, optional): http://localhost:8384 — start separately with `docker compose up -d syncthing`

There is no test suite and no lint/typecheck config in this repo currently.

### Getting code changes live (this deployment)

`/opt/gpx-report` is the live host itself, not a dev checkout — there's no separate deploy/push step, but `docker compose`'s default images here have **no bind mount for source code**, so editing a file on disk does not change what's running:

- **Backend** (`backend/src/**`): image is built from `backend/Dockerfile` with no source bind mount. A code edit needs `docker compose up -d --build backend` to take effect — restarting the container (`docker compose restart backend`) re-runs the *old* image and silently keeps stale code running.
- **Frontend** (`frontend/src/**`): same story, plus the `VITE_GRAPHQL_URL`/`VITE_CODE_SERVER_URL` build-arg caveat above — always `docker compose up -d --build frontend`. This is the slow one (~8–10 min, see Deployment notes).
- **`docker/init.sql`**: only applied on a fresh Postgres volume — an edit here needs a manual `psql`/`ALTER` against the running DB, not a rebuild (see Database section).
- There is no hot-reload/dev-mode in this compose file for either service — that only exists via the "Local (non-Docker) dev" path below (`npm run dev`), which isn't how this deployment runs.

### Local (non-Docker) dev

- Backend: `cd backend && npm install && npm run dev` (uses `node --watch`; needs `DATABASE_URL` and `GPX_FILES_DIRECTORY` env vars set — see `docker-compose.yml` for the shape).
- Frontend: `cd frontend && npm install && npm run dev` (Vite, binds `0.0.0.0`). Set `VITE_GRAPHQL_URL` if not proxying to `localhost:4000/graphql`.

**Important:** `VITE_GRAPHQL_URL` is baked into the frontend's static JS bundle at **image build time** via a Docker build arg (see `docker-compose.yml`'s `frontend.build.args` and `frontend/Dockerfile`), not read at container runtime. Changing it requires `docker compose up -d --build frontend` — restarting the container alone won't pick up the new value. `http://localhost:4000/graphql` only works if the browser and backend are on the same machine; for any real deployment this must be a routable domain reachable from wherever the browser runs.

## Architecture

**Backend** (`backend/src`, plain Node with ESM, no framework/ORM):
- `index.js` — entrypoint; boots Apollo Server standalone and starts the GPX directory watcher.
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

- **Prefer the simpler / existing approach.** Before writing new code, look for an existing utility, hook, helper, or pattern that already solves the problem. Before listing/enumerating things, check if they can be derived (e.g., glob a directory instead of hardcoding names). Before adding defensive preflight checks (`canOpen` before `open`, `exists` before `read`), prefer try/catch — internal code can trust its callers.
- **Distinguish "research" from "do."** When I ask "how hard would it be," "is it safe to," "compare X and Y," "look at the diff," "tell me," or "should we" — that is a request for analysis, not implementation. Report findings and a recommendation; do not write code or run mutations until I confirm. If unsure which mode I want, ask.
- **Docs sweep before every commit.** Before committing an implementation change, check whether `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/FEATURES.md`, `docs/SETUP.md`, or `docs/TODO.md` describe the thing you just changed, and update them in the same commit if they're now wrong or missing the new behavior (beyond the usual `docs/TODO.md` check-off). Skip files that clearly don't apply — this isn't "touch every doc every time," it's "don't leave docs describing the old behavior."
- **Docs describe what is, not what was.** `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, and `docs/FEATURES.md` describe current state and the reasoning behind it — not a changelog of what used to be true or what changed. Don't write "X used to be Y, now it's Z" or "previously unused, now wired up"; write what X is and why, present tense. History/narrative belongs in `docs/TODO.md`'s Done section and commit messages, not in the reference docs.

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
