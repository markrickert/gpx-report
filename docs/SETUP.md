# Setup and Installation

Fastest path: `cp .env.example .env && docker compose up --build` (see "Running the Application" at the end). The sections below give more detail on each piece.

## Prerequisites

*   **Docker & Docker Compose:** The primary way to run everything (Postgres/PostGIS, backend, web frontend) — see `docker-compose.yml` at the repo root.
*   **Node.js & pnpm:** Only needed for running the backend or frontend outside Docker (`tsx watch` / Expo dev server), and for building the phone app (Node 20+).
*   **Git:** For version control.

There is no Python anywhere in this stack — GPX parsing is done in Node via the `gpxparser` npm package.

## 1. Project Structure

```
gpx-report/
├── .env.example
├── docker-compose.yml       # db (postgis), backend, frontend services
├── data/gpx/                # GPX drop directory, bind-mounted into backend
├── frontend/                 # Universal Expo app: iOS/Android recorder + web analysis UI
│   ├── app.json              # Expo config (background location, SQLite plugins); app.config.ts adds the Google Maps key
│   ├── public/index.html     # web SPA HTML template (theme script, manifest)
│   ├── src/
│   │   ├── app/              # Expo Router routes; *.web.tsx = web-only variant
│   │   ├── screens/          # screen bodies; screens/web/ = DOM analysis pages
│   │   ├── recording/        # background GPS task, SQLite store, upload queue
│   │   ├── graphql/queries.ts
│   │   └── lib/apollo.ts
│   └── package.json
├── backend/                   # Node (ESM, TypeScript), no ORM
│   ├── src/
│   │   ├── graphql/            # typeDefs.ts, resolvers.ts, scalars.ts
│   │   ├── gpx/                 # parser.ts, processor.ts, watcher.ts
│   │   ├── db.ts                # shared pg.Pool
│   │   └── index.ts             # entrypoint — boots Apollo Server + watcher
│   ├── db/init.sql              # schema, applied on first container start only
│   └── package.json
└── docs/
    ├── ARCHITECTURE.md
    ├── DATA_MODEL.md
    ├── FEATURES.md
    ├── SETUP.md
    └── TODO.md
```

## 2. Database Setup (PostgreSQL with PostGIS)

The repo-root `docker-compose.yml` already defines the `db` service (`postgis/postgis:15-3.4`), reading `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` from `.env` (see `.env.example`). `docker compose up` (or `up -d db`) starts it; `backend/db/init.sql` is mounted into the image's init-script directory and runs automatically the *first* time the `db_data` volume is created.

*   **Schema changes to an existing deployment:** `init.sql` will not re-run against an existing volume. Apply changes by hand with `psql` (or `docker compose exec db psql -U $POSTGRES_USER -d $POSTGRES_DB`) — there is no migration tool. See `docs/TODO.md`.
*   **Accounts migration (existing deployments):**
    1.  Open a DB shell: `docker compose exec db psql -U $POSTGRES_USER -d $POSTGRES_DB`.
    2.  Run:
    ```sql
    ALTER TABLE activities ADD COLUMN owner VARCHAR(64) NOT NULL DEFAULT 'mark';
    CREATE INDEX IF NOT EXISTS idx_activities_owner ON activities (owner);
    CREATE TABLE IF NOT EXISTS activity_shares (
      gpx_filename VARCHAR(255) NOT NULL,
      person       VARCHAR(64) NOT NULL,
      PRIMARY KEY (gpx_filename, person)
    );
    CREATE INDEX IF NOT EXISTS idx_activity_shares_person ON activity_shares (person);
    ```
    3.  Rebuild: `docker compose up -d --build backend frontend`.

    No re-analysis needed: existing rows are all top-level files, so the `'mark'` default is already correct for them. Back up `activity_shares` before any volume wipe — unlike every other table, `activity_shares` can't be regenerated from the GPX files; `GET /export/full` includes it as `activity-shares.json`.
*   **Local (non-Docker) Postgres:** install PostgreSQL + PostGIS yourself, create a DB/user, `CREATE EXTENSION IF NOT EXISTS postgis;`, then run `backend/db/init.sql` against it manually. Point `DATABASE_URL` at it.

## 3. Backend Setup

*   **Via Docker (recommended):** already wired up in `docker-compose.yml` — `docker compose up --build backend` builds and starts it, with `DATABASE_URL` and `GPX_FILES_DIRECTORY` set from the compose file's `environment:` block.
*   **Locally:** `cd backend && pnpm install && pnpm dev` (uses `tsx watch` against the TypeScript source directly). Requires `DATABASE_URL` and `GPX_FILES_DIRECTORY` env vars — see `docker-compose.yml`'s `backend.environment` for the shape. `pnpm start` runs the compiled output (`pnpm build` first, then `node dist/index.js`) without watch mode.
*   The server listens on `GRAPHQL_PORT` (`4000` by default) and serves Apollo Server on Express at `/graphql`.

## 4. Frontend Setup

`frontend/` is one Expo (Expo Router) project that builds both the web analysis UI served by this server and the iOS/Android recording app.

*   **Web via Docker (recommended):** `docker compose up --build frontend` runs `expo export -p web` and serves the result with Caddy on port 3000 (`frontend/Caddyfile`). The same Caddy proxies `/graphql` and `/api/*` to `backend:4000`, so the web app and its API share one origin: the production bundle calls `/graphql` on whatever site served it, and no API URL is baked in.
*   **Web locally:** `cd frontend && pnpm install && pnpm exec expo start --web`. The Metro dev server has no proxy, so set `EXPO_PUBLIC_GRAPHQL_URL` to a reachable backend (default `http://localhost:4000/graphql`).
*   **pnpm:** each of `backend/`, `frontend/`, and the repo root has its own `pnpm-lock.yaml` (the Dockerfiles install `pnpm@11.0.9`, matching `packageManager`). `frontend/pnpm-workspace.yaml` sets `nodeLinker: hoisted`, since Expo/React Native tooling expects a flat `node_modules`. pnpm only runs dependency install scripts listed in `allowBuilds` (in each project's `pnpm-workspace.yaml`); a new dependency with one fails `pnpm install` until you run `pnpm approve-builds`.

### Hot-reload dev mode (in-Docker)

Use this to iterate on the live LXC host without a production rebuild (~8–10 min for the frontend) after every edit.

1.  Start dev mode:
    ```
    docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build backend frontend
    ```
2.  Edit under `backend/src` or `frontend/src`. The backend restarts on save; the frontend gets Fast Refresh.
3.  Leave dev mode by rebuilding the production containers:
    ```
    docker compose up -d --build backend frontend
    ```

How it works: `docker-compose.dev.yml` is an override file. It bind-mounts `./backend/src` and `./frontend/src` into the running containers and replaces their production command with `tsx watch src/index.ts` (backend, built from `backend/Dockerfile.dev` — a lightweight image with the full `pnpm install`, no `tsc` build step, since `tsx` runs the TypeScript source directly) and Expo's Metro web dev server via `pnpm exec expo start --web --port 3000` (frontend, built from `frontend/Dockerfile.dev` — a lightweight image that skips the `expo export` production stage entirely).

The frontend dev server has no Caddy proxy in front of it, so it reads `EXPO_PUBLIC_GRAPHQL_URL` from the container environment (set it in `.env` to the backend, e.g. `http://<host>:4000/graphql`). The production image ignores this variable.

This only activates when you pass both `-f` flags. A plain `docker compose up`/`up --build` is untouched and keeps using the production Dockerfiles.

## 5. Data Ingestion Setup

1.  **Configure GPX Directory:** `GPX_FILES_DIRECTORY` (backend env var) points at the directory to watch. In Docker Compose this is `/gpx-files` inside the container, bind-mounted from `./data/gpx` on the host. Each person's files go in their own subfolder (`data/gpx/kristin/`); files at the top level belong to the default person (`DEFAULT_PERSON` env var, default `mark`). A new subfolder is a new person — create it by hand or let their first phone upload create it. Keep folder names lowercase letters/digits/dashes, and don't use a web route name (`stats`, `heatmap`, `settings`, `record`, `activities`, `code`).
2.  **How ingestion actually runs:** there's no separate script to invoke — `backend/src/index.ts` starts a `chokidar` watcher (`backend/src/gpx/watcher.ts`) on boot, which fires an `add` event for every pre-existing file and then keeps watching for new ones. Each file is parsed (`gpx/parser.js`) and upserted (`gpx/processor.js`) automatically; there's nothing to schedule or trigger manually beyond dropping a `.gpx` file into the directory.
3.  **Re-analysis:** the `reanalyzeAllActivities` / `reanalyzeActivitiesByDateRange` GraphQL mutations (wired to the Settings page buttons) re-run the same parse+upsert pipeline over files that already have a matching `activities` row.

Note: both the file watcher (on startup, when it sees every pre-existing file) and the `reanalyze*` mutations process files with bounded concurrency (a small in-process queue / batches of 5) rather than firing all of them at Postgres at once. This matters in practice — the default `pg.Pool` size is 10, and syncing in a large backlog (e.g. seeding the app with hundreds of historical tracks at once) will otherwise open far more simultaneous connections than the pool can serve, causing a chunk of files to fail with `Connection terminated unexpectedly`. If you ever see that error on a bulk ingest, it's a concurrency/pool-exhaustion symptom, not a bad GPX file — re-running `reanalyzeAllActivities` is safe (upserts are idempotent) but shouldn't be necessary now that both ingestion paths are queued.

**Reverse-geocoding rate limit (Nominatim):** if `location_name` stops populating for new activities, check the backend logs for HTTP 429s before debugging code — it's usually an active Nominatim block that clears on its own.

*   **The limit:** Nominatim allows 1 request/sec and temporarily blocks an IP that exceeds it. `processFile()` resolves each activity's start point to a place name through it (`backend/src/geocoding.ts`).
*   **How ingest stays under it:** the watcher replays an `add` event for every *pre-existing* file on each backend restart. `gpx/watcher.ts` gates live lookups on chokidar's `ready` event, so that replay always passes `{ skipGeocode: true }` and only files added after the initial scan trigger a lookup. `reverseGeocode()` also self-throttles (≥1.1s between any two outbound calls) as a second line of defense.
*   **Backfill:** existing activities are backfilled by `backend/scripts/backfillLocationNames.js`, strictly sequential with a ~1.1s sleep. Never run it (or anything else hitting Nominatim) concurrently with itself or with a fresh backend restart's initial scan.
*   **Why this matters:** before the `ready` gate existed, one container restart fired ~500 unthrottled requests in a few seconds. Nominatim answered with 429s and kept this deployment's IP rate-limited well after the app stopped calling it (a plain `curl` still got 429).

## 6. Recording From Your Phone (Mobile App)

The same `frontend/` project builds a native recorder app. It records with `expo-location` background updates (the screen can be locked), stores every point in on-device SQLite, and uploads finished activities to this server's `saveRecordedActivity` mutation. The phone reaches the server over Tailscale — nothing is exposed publicly.

1.  **Android only: add a Google Maps key.** Create an API key with the Maps SDK for Android enabled, restricted to the `me.markrickert.gpxreport` package and your signing SHA-1, and put it in `frontend/.env` as `GOOGLE_MAPS_API_KEY=...` (gitignored). Without it the Android map is blank. iOS uses Apple Maps and needs no key.
2.  **Build a development build** (Expo Go can't do background location): from `frontend/`, `npx expo run:ios --device` / `npx expo run:android --device` with the phone plugged in, or `npx eas-cli@latest build --profile development` (see `frontend/eas.json`) and install the result. Store distribution is not set up yet.
3.  **Install Tailscale on the phone** and join the same tailnet as the server.
4.  **Set your name:** the first launch shows a setup screen asking for your name and the server; the tabs stay hidden until both are set. Change the name later in Settings → Your name → *Save name*. It decides whose folder your recordings upload into and whose activities History shows.
5.  **Point the app at the server:** on the setup screen (or later in Settings → Server), enter the GraphQL URL (e.g. `https://gpx-report.example.com/graphql`) → *Test & continue* (setup) or *Test & save* (Settings). The app checks the URL first and saves it only if the server answers; on failure it shows the error and offers *Continue anyway* / *Save anyway*. This overrides the `EXPO_PUBLIC_GRAPHQL_URL` baked into the build, so a changed hostname doesn't need a rebuild. Plain `http://` URLs (e.g. a raw Tailscale IP) are allowed: `app.json` enables cleartext HTTP on both platforms.
6.  **Grant location "Always"** (iOS) / "Allow all the time" (Android) when prompted. With only "While using", recording can stop once the phone locks; Settings shows the current grant and links to the system settings.
7.  **Record:** Record tab → Start. Pause/Resume creates a new `<trkseg>`, so pause gaps aren't counted as distance. Stop → title + activity type → Save.

**Offline uploads:** Save never needs the server. The recording goes into a local upload queue that retries on app start, on network change, when the app returns to the foreground, and once a minute while open, with exponential backoff (30s doubling, capped at 6h). History shows anything not yet uploaded, with its last error and a *Retry now* button. Each upload sends the recording's UUID as `clientId`, so the server writes `<person>/recorded-<uuid>.gpx` exactly once even if a retry follows a lost response.

**Platform behavior worth knowing:** Android keeps recording via a foreground-service notification even if you swipe the app away. On iOS, swiping the app away from the app switcher stops location updates (an OS rule); being suspended or terminated by the system does not.

### Exposing the App Through a Reverse Proxy

One hostname serves everything: point a proxy at the frontend container's port 3000, and its Caddy routes `/graphql` and `/api/*` to the backend itself. On this deployment that's a Pangolin resource (HTTP target = the container's Tailscale IP, port 3000, SSO off so the phone app can reach the API). With Caddy instead:

```
gpx-report.example.com {
    reverse_proxy localhost:3000
}
```

The phone app uses `https://<that-host>/graphql` as its server URL.

## 7. Testing

Unit tests (`backend/src/**/*.test.ts`, `frontend/src/**/*.test.{ts,tsx}`) run via `pnpm test` (Vitest) in each subproject — no live stack needed, see `.agents/docs/workflow.md`. `frontend/vitest.config.mts` resolves `.web.ts(x)` files first, the way Metro does for web, so recorder tests run against the in-memory `store.web.ts` rather than native SQLite.

A Playwright E2E smoke suite (`frontend/e2e/`, `frontend/playwright.config.ts`) runs against the *actual running docker-compose stack* instead — `pnpm test:e2e` inside `frontend/`, with the stack already up (`docker compose up`). It's read-only for the real dataset (Dashboard load, opening a real activity, the Stats page) and creates/destroys its own disposable synthetic activity for the edit/trim/delete flow (dropped into and cleaned back out of the real `data/gpx/` — see `frontend/e2e/gpxFixture.ts`), so it's safe to run against a live deployment's real data. Every spec runs under both a desktop and a Chromium-based mobile-device emulation profile (`devices["Pixel 5"]` — not `devices["iPhone 13"]`/other WebKit-default profiles, since this host only has Chromium installed, not WebKit).

*   `E2E_BASE_URL` (default `http://localhost:3000`) and `E2E_GRAPHQL_URL` (default `http://localhost:4000/graphql`) point the suite at a non-default host/port.
*   `E2E_CHROMIUM_PATH` (default `/usr/bin/chromium`) points at a different browser binary — this suite deliberately uses an already-installed system Chromium via `launchOptions.executablePath` rather than `@playwright/test`'s own downloaded browsers, since a fresh `npx playwright install` needs a ~300MB download this host's network access can't always do (same reasoning as the TypeScript-conversion verification note in `docs/TODO.md`'s Done section).
*   Runs with a single Playwright worker (`workers: 1` in `playwright.config.ts`) — several concurrent headless Chromium instances reliably crash each other on a small (4 CPU/4GB) host already running the full compose stack.
*   Needs Node 20+ (this host's default `node` is 18) — see the Node version note in `.agents/docs/workflow.md` for backend/frontend unit tests; the same applies here.

## 8. Deployment Notes (Proxmox LXC)

Running this in a Proxmox LXC container (as opposed to a full VM) has a couple of quirks worth knowing before you deploy:

*   **Surviving a power cycle needs no extra systemd unit.** Every service in `docker-compose.yml` already has `restart: unless-stopped`. As long as the Docker daemon itself is enabled at the systemd level (`systemctl enable docker` — check with `systemctl is-enabled docker`), a reboot brings the daemon back up, and Docker restarts every container that wasn't manually `docker compose down`'d beforehand. No cron job, no custom `.service` file, no `@reboot` entry needed — this was verified working on the actual deployment host.
*   **`.env` isn't committed** (it's gitignored) — after cloning onto a fresh host, `cp .env.example .env` and replace the placeholder `POSTGRES_PASSWORD` with a real generated value (e.g. `openssl rand -hex 16`) before the first `docker compose up`. The example password is a placeholder, not something to run with.
*   **The frontend image build is the slow step** — its multi-stage Dockerfile runs `pnpm install` and then `expo export -p web` for the production bundle. A first `docker compose up -d --build` on a fresh host can take 8–10 minutes total; don't assume a hung terminal is a stuck build.
*   **Docker isn't guaranteed to be preinstalled on a fresh LXC** — check with `docker --version` before assuming it's there; on Debian-based LXCs it's a standard `apt-get install docker.io docker-compose-plugin` (or Docker's official convenience script) away.
*   **A small LXC disk fills up fast from Docker build cache.** Rebuilding the frontend/backend images repeatedly (each `docker compose up -d --build`) leaves behind dangling image layers and BuildKit cache, which grows unbounded and isn't reclaimed automatically. `docker/disk-cleanup.sh` (`docker builder prune -af`, `docker image prune -af`, `apt-get clean`, `journalctl --vacuum-time=7d`) runs weekly via a root crontab entry (`crontab -l` to view; `17 4 * * 0` — Sunday 4:17am, logs to `/var/log/disk-cleanup.log`) to keep this in check. Everything it removes is regenerable (build cache, package download cache, old log history) — safe to also run manually if `df -h /` looks tight before the next scheduled run.

## Running the Application

1.  `cp .env.example .env`, then set a real `POSTGRES_PASSWORD`.
2.  `docker compose up -d --build` (the first build takes ~8–10 min).
3.  Drop a few `.gpx`/`.igc`/`.skiz` files into `data/gpx/`.
4.  Open the frontend (http://localhost:3000 on the same machine) and pick a person.
