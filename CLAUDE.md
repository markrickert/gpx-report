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
