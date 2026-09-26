# Setup and Installation

This document provides instructions for setting up the development environment and running gpx-report. For the fastest path, see `CLAUDE.md`'s "Running the stack" section (`cp .env.example .env && docker compose up --build`) — the sections below give more detail on each piece.

## Prerequisites

*   **Docker & Docker Compose:** The primary way to run everything (Postgres/PostGIS, backend, web frontend, code-server) — see `docker-compose.yml` at the repo root.
*   **Node.js & npm:** Only needed for running the backend or frontend outside Docker (`tsx watch` / Expo dev server), and for building the phone app (Node 20+).
*   **Git:** For version control.

There is no Python anywhere in this stack — GPX parsing is done in Node via the `gpxparser` npm package.

## 1. Project Structure

```
gpx-report/
├── .env.example
├── docker-compose.yml       # db (postgis), backend, frontend, code-server services
├── data/gpx/                # GPX drop directory, bind-mounted into backend
├── frontend/                 # Universal Expo app: iOS/Android recorder + web analysis UI
│   ├── app.json              # Expo config (background location, MapLibre, SQLite plugins)
│   ├── public/index.html     # web SPA HTML template (theme script, manifest)
│   ├── src/
│   │   ├── app/              # Expo Router routes; *.web.tsx = web-only variant
│   │   ├── screens/          # screen bodies; screens/web/ = DOM analysis pages
│   │   ├── recording/        # background GPS task, SQLite store, upload queue
│   │   ├── graphql/queries.ts
│   │   └── lib/apollo.ts
│   └── package.json
├── backend/                   # Node (ESM), no framework/ORM
│   ├── src/
│   │   ├── graphql/            # typeDefs.js, resolvers.js, scalars.js
│   │   ├── gpx/                 # parser.js, processor.js, watcher.js
│   │   ├── db.js                # shared pg.Pool
│   │   └── index.js             # entrypoint — boots Apollo Server + watcher
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
*   **Local (non-Docker) Postgres:** install PostgreSQL + PostGIS yourself, create a DB/user, `CREATE EXTENSION IF NOT EXISTS postgis;`, then run `backend/db/init.sql` against it manually. Point `DATABASE_URL` at it.

## 3. Backend Setup

*   **Via Docker (recommended):** already wired up in `docker-compose.yml` — `docker compose up --build backend` builds and starts it, with `DATABASE_URL` and `GPX_FILES_DIRECTORY` set from the compose file's `environment:` block.
*   **Locally:** `cd backend && npm install && npm run dev` (uses `tsx watch` against the TypeScript source directly). Requires `DATABASE_URL` and `GPX_FILES_DIRECTORY` env vars — see `docker-compose.yml`'s `backend.environment` for the shape. `npm start` runs the compiled output (`npm run build` first, then `node dist/index.js`) without watch mode.
*   The server listens on `GRAPHQL_PORT` (`4000` by default) and serves Apollo Server standalone at `/graphql`.

## 4. Frontend Setup

`frontend/` is one Expo (Expo Router) project that builds both the web analysis UI served by this server and the iOS/Android recording app.

*   **Web via Docker (recommended):** `docker compose up --build frontend` runs `expo export -p web` and serves the static SPA with `serve -s` on port 3000. **Important:** `EXPO_PUBLIC_GRAPHQL_URL` is baked into the static JS bundle at *image build time* via a Docker build arg (`frontend.build.args` in `docker-compose.yml`), not read at container runtime — changing it requires a rebuild (`docker compose up -d --build frontend`), not just a restart.
*   **Web locally:** `cd frontend && npm install && npx expo start --web`. Set `EXPO_PUBLIC_GRAPHQL_URL` in the environment if not using `localhost:4000/graphql`.
*   `http://localhost:4000/graphql` only works when the browser and backend run on the same machine — for any real deployment `EXPO_PUBLIC_GRAPHQL_URL` needs to be a domain reachable from wherever the browser is (see §6 below for the reverse-proxy setup used in this project's actual deployment).
*   `frontend/.npmrc` sets `legacy-peer-deps=true`: npm's resolver crashes (`Cannot read properties of null (reading 'edgesOut')`) on some of the dev dependencies' optional peers otherwise. Keep it so local installs and the Docker `npm ci` resolve the same tree.

### Hot-reload dev mode (in-Docker)

For iterating on this live LXC host without a full rebuild each time (frontend production rebuilds take ~8-10 min), `docker-compose.dev.yml` is an override file that swaps `backend`/`frontend` for a bind-mounted, watch-mode setup:

```
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build backend frontend
```

This bind-mounts `./backend/src` and `./frontend/src` into the running containers and replaces their production command with `tsx watch src/index.ts` (backend, built from `backend/Dockerfile.dev` — a lightweight image with the full `npm ci`, no `tsc` build step, since `tsx` runs the TypeScript source directly) and Expo's Metro web dev server via `npx expo start --web --port 3000` (frontend, built from `frontend/Dockerfile.dev` — a lightweight image that skips the `expo export` production stage entirely). Edits under `backend/src`/`frontend/src` take effect immediately: the backend process restarts on save, the frontend gets Fast Refresh.

The frontend dev server reads `EXPO_PUBLIC_GRAPHQL_URL`/`EXPO_PUBLIC_CODE_SERVER_URL` from the container environment when Metro bundles, rather than from the image build arg the production image bakes in — same values from `.env`, different mechanism.

This only activates when you pass both `-f` flags. A plain `docker compose up`/`up --build` is untouched and keeps using the production Dockerfiles. To go back to the production containers, rebuild the normal way:

```
docker compose up -d --build backend frontend
```

## 5. Data Ingestion Setup

1.  **Configure GPX Directory:** `GPX_FILES_DIRECTORY` (backend env var) points at the directory to watch. In Docker Compose this is `/gpx-files` inside the container, bind-mounted from `./data/gpx` on the host.
2.  **How ingestion actually runs:** there's no separate script to invoke — `backend/src/index.ts` starts a `chokidar` watcher (`backend/src/gpx/watcher.ts`) on boot, which fires an `add` event for every pre-existing file and then keeps watching for new ones. Each file is parsed (`gpx/parser.js`) and upserted (`gpx/processor.js`) automatically; there's nothing to schedule or trigger manually beyond dropping a `.gpx` file into the directory.
3.  **Re-analysis:** the `reanalyzeAllActivities` / `reanalyzeActivitiesByDateRange` GraphQL mutations (wired to the Settings page buttons) re-run the same parse+upsert pipeline over files that already have a matching `activities` row.

Note: both the file watcher (on startup, when it sees every pre-existing file) and the `reanalyze*` mutations process files with bounded concurrency (a small in-process queue / batches of 5) rather than firing all of them at Postgres at once. This matters in practice — the default `pg.Pool` size is 10, and syncing in a large backlog (e.g. seeding the app with hundreds of historical tracks at once) will otherwise open far more simultaneous connections than the pool can serve, causing a chunk of files to fail with `Connection terminated unexpectedly`. If you ever see that error on a bulk ingest, it's a concurrency/pool-exhaustion symptom, not a bad GPX file — re-running `reanalyzeAllActivities` is safe (upserts are idempotent) but shouldn't be necessary now that both ingestion paths are queued.

**Reverse-geocoding rate limit (Nominatim):** `processFile()` also resolves each activity's start point to a place name via Nominatim (`backend/src/geocoding.ts`), which caps usage at 1 request/sec and can temporarily block an IP that exceeds it. This is only safe because the watcher processes one file at a time — but that alone isn't enough: the watcher's startup replay (an `add` event fires for every *pre-existing* file on every backend restart, not just new ones) would otherwise fire one geocode request per file back-to-back with no natural spacing, since each file's DB work finishes in well under a second. `gpx/watcher.js` guards against this by gating on chokidar's `ready` event — only files added *after* the initial scan settles trigger a live lookup; the startup replay itself always passes `{ skipGeocode: true }`. `reverseGeocode()` also self-throttles at the module level (≥1.1s between any two outbound calls) as a second line of defense. Getting this wrong is not hypothetical: an earlier version of this wiring (before the `ready` gate existed) let a container restart fire ~500 unthrottled requests at Nominatim in a few seconds, which drew HTTP 429s and left this deployment's IP rate-limited for a while afterward — confirmed by a plain `curl` to Nominatim also returning 429 well after the app had stopped calling it. If you ever see `location_name` failing to populate for new activities, check for 429s in the backend logs before assuming a code bug — it may just be an active Nominatim block that needs to clear. Existing activities are backfilled separately via `backend/scripts/backfillLocationNames.js`, which processes rows strictly sequentially with an explicit ~1.1s sleep between requests — never run this (or anything else hitting Nominatim) concurrently with itself or with a fresh backend restart's initial scan.

## 6. Recording From Your Phone (Mobile App)

The same `frontend/` project builds a native recorder app. It records with `expo-location` background updates (the screen can be locked), stores every point in on-device SQLite, and uploads finished activities to this server's `saveRecordedActivity` mutation. The phone reaches the server over Tailscale — nothing is exposed publicly.

1.  **Build a development build** (Expo Go can't do background location): from `frontend/`, `npx expo run:ios --device` / `npx expo run:android --device` with the phone plugged in, or `npx eas-cli@latest build --profile development` (see `frontend/eas.json`) and install the result. Store distribution is not set up yet.
2.  **Install Tailscale on the phone** and join the same tailnet as the server.
3.  **Point the app at the server:** app → Settings → Server → enter the GraphQL URL (e.g. `https://gpx-report-api.example.com/graphql`) → *Save & test connection*. This overrides the `EXPO_PUBLIC_GRAPHQL_URL` baked into the build, so a changed hostname doesn't need a rebuild. Plain `http://` URLs (e.g. a raw Tailscale IP) are allowed: `app.json` enables cleartext HTTP on both platforms.
4.  **Grant location "Always"** (iOS) / "Allow all the time" (Android) when prompted. With only "While using", recording can stop once the phone locks; Settings shows the current grant and links to the system settings.
5.  **Record:** Record tab → Start. Pause/Resume creates a new `<trkseg>`, so pause gaps aren't counted as distance. Stop → title + activity type → Save.

**Offline uploads:** Save never needs the server. The recording goes into a local upload queue that retries on app start, on network change, when the app returns to the foreground, and once a minute while open, with exponential backoff (30s doubling, capped at 6h). History shows anything not yet uploaded, with its last error and a *Retry now* button. Each upload sends the recording's UUID as `clientId`, so the server writes `recorded-<uuid>.gpx` exactly once even if a retry follows a lost response.

**Platform behavior worth knowing:** Android keeps recording via a foreground-service notification even if you swipe the app away. On iOS, swiping the app away from the app switcher stops location updates (an OS rule); being suspended or terminated by the system does not.

### Exposing the GraphQL API Through a Reverse Proxy

The web frontend is a static bundle — `expo export` inlines `EXPO_PUBLIC_GRAPHQL_URL` into the built JS at **image build time**, not at container runtime. `docker-compose.yml`'s `frontend` build arg reads it from `${EXPO_PUBLIC_GRAPHQL_URL}` (set in gitignored `.env`, e.g. `https://gpx-report-api.example.com/graphql`) rather than a value hardcoded in the compose file, so the real domain never needs to be committed; the browser (wherever it's running — your laptop, your phone) needs to be able to resolve and reach that domain directly, and it does **not** matter what the backend container's address looks like from inside the Docker network.

*   **`http://localhost:4000/graphql` will not work** as this value once it's baked into a bundle served to a browser on a different machine than the server — "localhost" then means the browser's own device, which has nothing listening on port 4000. This caused an initial "Failed to fetch" on the dashboard; the fix was adding a real routable domain.
*   **Add a Caddy site for it:**
    ```
    gpx-report-api.example.com {
        reverse_proxy localhost:4000
    }
    ```
    Apollo Server doesn't do `Host`-header validation, so no header rewrite is needed. The phone app uses this same URL.
*   **Any time `EXPO_PUBLIC_GRAPHQL_URL` changes, the frontend image must be rebuilt** (`docker compose up -d --build frontend`) — restarting the existing container alone won't pick up a new build arg, since it's compiled into the static JS, not read from the environment at runtime.

## 7. Browser-Based Editing (code-server)

`docker-compose.yml` includes a `code-server` service (`codercom/code-server`) — a full VS Code instance in the browser, with a terminal, bind-mounted read-write at the repo root (`./:/opt/gpx-report`).

*   **Start it:** `docker compose up -d code-server`, then open `http://<server-ip>:8443` (or `http://localhost:8443` if you're on the same machine).
*   **No login.** It's started with `--auth none`, so anyone who can reach it has a shell and write access to the whole repo — no password, no prompt. This is intentional: the domain (`gpx-report-code.example.com`, via a Caddy site same as §6) only resolves/routes within Tailscale on this deployment — there's no real public exposure, and it shares the same trust boundary as the unauthenticated Postgres port and GraphQL API. If this deployment ever becomes reachable from an untrusted network, set a real password instead (`PASSWORD=...` env var in place of `--auth none` in the `command:`) before relying on that assumption.
*   **Editor state (extensions, settings) persists** in the `code_server_data` named volume, mounted at `/root/.local` (the container runs as `user: "0:0"`, so `$HOME` is `/root`, not the image's default `/home/coder`) — separate from the repo bind mount, so `docker compose down`/`up` doesn't lose installed extensions.
*   Changes made through it land directly on the host filesystem (it's a bind mount, not a copy) — `git status` on the host will show them immediately, same as editing the files directly.
*   **The web UI's "Code" tab (`frontend/src/screens/web/code-editor.tsx`) iframes `EXPO_PUBLIC_CODE_SERVER_URL`** (`https://gpx-report-code.example.com`, a Caddy site `reverse_proxy localhost:8443`, read from gitignored `.env` same as `EXPO_PUBLIC_GRAPHQL_URL` — see §6), baked in at frontend image build time. Changing it needs `docker compose up -d --build frontend`.
*   **The Code tab follows the dashboard's light/dark toggle.** `code_server_data` is also mounted read-write into the `backend` container at `/code-server-home`; toggling the app's theme calls the `setCodeServerTheme` mutation (`resolvers.js`), which writes `workbench.colorTheme` into code-server's `settings.json`, and `code-editor.tsx` then reloads the iframe so the new theme takes effect.

## 8. Testing

Unit tests (`backend/src/**/*.test.ts`, `frontend/src/**/*.test.{ts,tsx}`) run via `npm test` (Vitest) in each subproject — no live stack needed, see CLAUDE.md. `frontend/vitest.config.mts` resolves `.web.ts(x)` files first, the way Metro does for web, so recorder tests run against the in-memory `store.web.ts` rather than native SQLite.

A Playwright E2E smoke suite (`frontend/e2e/`, `frontend/playwright.config.ts`) runs against the *actual running docker-compose stack* instead — `npm run test:e2e` inside `frontend/`, with the stack already up (`docker compose up`). It's read-only for the real dataset (Dashboard load, opening a real activity, the Stats page) and creates/destroys its own disposable synthetic activity for the edit/trim/delete flow (dropped into and cleaned back out of the real `data/gpx/` — see `frontend/e2e/gpxFixture.ts`), so it's safe to run against a live deployment's real data. Every spec runs under both a desktop and a Chromium-based mobile-device emulation profile (`devices["Pixel 5"]` — not `devices["iPhone 13"]`/other WebKit-default profiles, since this host only has Chromium installed, not WebKit).

*   `E2E_BASE_URL` (default `http://localhost:3000`) and `E2E_GRAPHQL_URL` (default `http://localhost:4000/graphql`) point the suite at a non-default host/port.
*   `E2E_CHROMIUM_PATH` (default `/usr/bin/chromium`) points at a different browser binary — this suite deliberately uses an already-installed system Chromium via `launchOptions.executablePath` rather than `@playwright/test`'s own downloaded browsers, since a fresh `npx playwright install` needs a ~300MB download this host's network access can't always do (same reasoning as the TypeScript-conversion verification note in `docs/TODO.md`'s Done section).
*   Runs with a single Playwright worker (`workers: 1` in `playwright.config.ts`) — several concurrent headless Chromium instances reliably crash each other on a small (4 CPU/4GB) host already running the full compose stack.
*   Needs Node 20+ (this host's default `node` is 18) — see CLAUDE.md's Node version note for backend/frontend unit tests; the same applies here.

## 9. Deployment Notes (Proxmox LXC)

Running this in a Proxmox LXC container (as opposed to a full VM) has a couple of quirks worth knowing before you deploy:

*   **Surviving a power cycle needs no extra systemd unit.** Every service in `docker-compose.yml` already has `restart: unless-stopped`. As long as the Docker daemon itself is enabled at the systemd level (`systemctl enable docker` — check with `systemctl is-enabled docker`), a reboot brings the daemon back up, and Docker restarts every container that wasn't manually `docker compose down`'d beforehand. No cron job, no custom `.service` file, no `@reboot` entry needed — this was verified working on the actual deployment host.
*   **`.env` isn't committed** (it's gitignored) — after cloning onto a fresh host, `cp .env.example .env` and replace the placeholder `POSTGRES_PASSWORD` with a real generated value (e.g. `openssl rand -hex 16`) before the first `docker compose up`. The example password is a placeholder, not something to run with.
*   **The frontend image build is the slow step** — its multi-stage Dockerfile runs `npm ci` and then `expo export -p web` for the production bundle. A first `docker compose up -d --build` on a fresh host can take 8–10 minutes total; don't assume a hung terminal is a stuck build.
*   **Docker isn't guaranteed to be preinstalled on a fresh LXC** — check with `docker --version` before assuming it's there; on Debian-based LXCs it's a standard `apt-get install docker.io docker-compose-plugin` (or Docker's official convenience script) away.
*   **A small LXC disk fills up fast from Docker build cache.** Rebuilding the frontend/backend images repeatedly (each `docker compose up -d --build`) leaves behind dangling image layers and BuildKit cache, which grows unbounded and isn't reclaimed automatically. `docker/disk-cleanup.sh` (`docker builder prune -af`, `docker image prune -af`, `apt-get clean`, `journalctl --vacuum-time=7d`) runs weekly via a root crontab entry (`crontab -l` to view; `17 4 * * 0` — Sunday 4:17am, logs to `/var/log/disk-cleanup.log`) to keep this in check. Everything it removes is regenerable (build cache, package download cache, old log history) — safe to also run manually if `df -h /` looks tight before the next scheduled run.

## Running the Application

1.  Ensure the database is running.
2.  Start the backend server.
3.  Start the frontend development server.
4.  Place a few `.gpx` files in the configured `GPX_FILES_DIRECTORY`.
5.  Access the frontend in your browser and explore the dashboard. Use the Settings page to trigger re-analysis if needed.

