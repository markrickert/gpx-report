# Setup and Installation

This document provides instructions for setting up the development environment and running gpx-report. For the fastest path, see `CLAUDE.md`'s "Running the stack" section (`cp .env.example .env && docker compose up --build`) — the sections below give more detail on each piece.

## Prerequisites

*   **Docker & Docker Compose:** The primary way to run everything (Postgres/PostGIS, backend, frontend, and optionally Syncthing) — see `docker-compose.yml` at the repo root.
*   **Node.js & npm:** Only needed for running the backend or frontend outside Docker (`tsx watch` / Vite dev server).
*   **Git:** For version control.

There is no Python anywhere in this stack — GPX parsing is done in Node via the `gpxparser` npm package.

## 1. Project Structure

```
gpx-report/
├── .env.example
├── docker-compose.yml       # db (postgis), backend, frontend, syncthing, code-server services
├── data/gpx/                # GPX drop directory, bind-mounted into backend + syncthing
├── frontend/                 # React (Vite) application
│   ├── src/
│   │   ├── graphql/          # Apollo client setup and queries
│   │   ├── pages/             # Dashboard.tsx, ActivityDetail.tsx, Settings.tsx
│   │   ├── App.tsx
│   │   └── apolloClient.js
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

*   **Via Docker (recommended):** `docker compose up --build frontend`. **Important:** `VITE_GRAPHQL_URL` is baked into the static JS bundle at *image build time* via a Docker build arg (`frontend.build.args` in `docker-compose.yml`), not read at container runtime — changing it requires a rebuild (`docker compose up -d --build frontend`), not just a restart.
*   **Locally:** `cd frontend && npm install && npm run dev` (Vite, binds `0.0.0.0`, default port 5173 unless configured otherwise). Set `VITE_GRAPHQL_URL` in the environment if not proxying to `localhost:4000/graphql`.
*   `http://localhost:4000/graphql` only works when the browser and backend run on the same machine — for any real deployment `VITE_GRAPHQL_URL` needs to be a domain reachable from wherever the browser is (see §6 below for the reverse-proxy setup used in this project's actual deployment).

### Hot-reload dev mode (in-Docker)

For iterating on this live LXC host without a full rebuild each time (frontend production rebuilds take ~8-10 min), `docker-compose.dev.yml` is an override file that swaps `backend`/`frontend` for a bind-mounted, watch-mode setup:

```
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build backend frontend
```

This bind-mounts `./backend/src` and `./frontend/src` into the running containers and replaces their production command with `tsx watch src/index.ts` (backend, built from `backend/Dockerfile.dev` — a lightweight image with the full `npm ci`, no `tsc` build step, since `tsx` runs the TypeScript source directly) and the Vite dev server via `npm run dev` (frontend, built from `frontend/Dockerfile.dev` — a lightweight image that skips the `vite build` production stage entirely). Edits under `backend/src`/`frontend/src` take effect immediately: the backend process restarts on save, the frontend gets Vite HMR/live reload.

The frontend dev server reads `VITE_GRAPHQL_URL`/`VITE_CODE_SERVER_URL` as ordinary runtime environment variables (Vite exposes any `VITE_`-prefixed env var through `import.meta.env` when its dev server handles a request) rather than baking them into the bundle at build time the way the production image does — same values from `.env`, different mechanism, and no extra config needed.

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

## 6. Syncing GPX Files from Your Phone (Syncthing)

`docker-compose.yml` includes a `syncthing` service that syncs `.gpx` files directly from your Android phone into `data/gpx/`, no cloud intermediary. One-time setup:

1.  **Start it:** `docker compose up -d syncthing`
2.  **Open the web GUI:** `http://<server-ip>:8384` (use the server's LAN IP if not on the same machine, e.g. `http://192.168.1.50:8384`). On first run it walks you through basic setup (set a GUI username/password when prompted — it's reachable by anyone on your LAN otherwise).
3.  **Get the server's Device ID:** Actions (top right) → Show ID. This shows an ID string and a QR code.
4.  **Install Syncthing on Android:** from F-Droid (recommended) or the Play Store.
5.  **Pair the phone with the server:**
    *   In the Android app, tap **+** → **Add Remote Device**.
    *   Scan the QR code from step 3, or type in the Device ID.
    *   Give it a name (e.g. "gpx-report-server") and save.
    *   Back on the server web GUI, a popup will appear asking to accept the new device — accept it.
6.  **Create a drop folder on your phone and share it:**
    *   In the Syncthing Android app, add a new folder — e.g. call it "GPX Uploads" — it can be any empty folder, since you'll be saving files into it manually (see step 8).
    *   Under that folder's **Sharing** tab, check the server device.
    *   Set the folder type to **Send & Receive** on the phone — the backend can edit a GPX file's contents in place (`backend/src/gpx/writer.ts`, used by the activity-type-editing feature), and those edits need to sync back down to the phone, not just uploads going up.
7.  **Accept the folder on the server:**
    *   The server web GUI will show an incoming folder offer — click **Add**.
    *   Set the folder path to the **absolute** path `/var/syncthing/gpx` (this is mounted to `./data/gpx` on the host). Don't leave it as a relative path (e.g. just `gpx` or a label like `GpxSync`) — Syncthing resolves a relative path against its working directory, which in this container is filesystem root (`/`), not `$HOME`/`/var/syncthing`. A relative path silently lands files outside any mounted volume, in the container's writable layer — they'd vanish on the next `docker compose up --build`, and the backend's watcher (which only sees `./data/gpx`) would never ingest them. This bit us once already; the absolute path is the fix.
    *   Set the folder type to **Send & Receive** (matching the phone) — needed for backend-written edits to a GPX file to propagate back to the phone.
    *   If you ever repoint an existing folder's path via the GUI or REST API rather than accepting it fresh, Syncthing requires a `.stfolder` marker file at the folder root before it'll scan — a safety guard against operating on an accidentally-empty/unmounted path. Create it with `touch /var/syncthing/gpx/.stfolder` (from inside the container) if a rescan fails with `folder marker missing`.
8.  **Export tracks from Organic Maps into that folder:**
    *   Organic Maps has no auto-export-to-folder option, so this is a manual step per activity: open **Bookmarks and Tracks**, tap the track you just recorded, tap **Share**, and choose **GPX** as the format.
    *   In the Android share sheet, pick **Syncthing** (it registers itself as a share target), then choose the "GPX Uploads" folder from step 6.
    *   Avoid the bulk "export whole list" option in Organic Maps — it bundles every track into one multi-track file, and this app treats one GPX file as one activity, so a bundle would get merged into a single record instead of many.
9.  **Done.** Once saved into the shared folder, the file syncs to the server automatically (over LAN when home, or via Syncthing's relay/discovery servers when away), lands in `data/gpx/`, and is picked up immediately by the backend's file watcher.

Note: Syncthing works over the internet by default via its global discovery and relay servers, so this keeps working even when your phone isn't on the same network as the server — just slower than a direct LAN connection.

### Exposing the GUI Through a Reverse Proxy (e.g. Caddy over Tailscale)

If you're putting the Syncthing **web GUI** behind a reverse proxy on a custom domain (as opposed to hitting `http://<ip>:8384` directly), there's one Syncthing-specific gotcha:

*   **Host header check:** Syncthing rejects requests whose `Host` header doesn't look like `localhost`/its own bind address, as anti-DNS-rebinding protection — proxying `gpx-report-syncthing.example.com` straight through without touching the `Host` header will get you a `Host check error`. Fix it in the proxy, not in Syncthing: rewrite the `Host` header to the upstream address, matching [Syncthing's own documented Caddy v2 example](https://docs.syncthing.net/users/reverseproxy.html):
    ```
    handle_path /syncthing/* {
        reverse_proxy http://localhost:8384 {
            header_up Host {upstream_hostport}
        }
    }
    ```
    Adapt this to a dedicated site block (`gpx-report-syncthing.example.com { reverse_proxy localhost:8384 { header_up Host {upstream_hostport} } }`) rather than a path prefix, since that's how it's set up here. If for some reason you can't control the `Host` header at the proxy, the alternative is setting `insecureSkipHostcheck` to `true` in the `<gui>` block of Syncthing's `config.xml` ([documented here](https://docs.syncthing.net/users/config.html)) — lower-risk than usual since this is only reachable over Tailscale, but the header rewrite is the cleaner fix.

*   **Sync protocol port (22000) is not HTTP** — it's a raw TCP/QUIC(UDP) protocol between Syncthing instances, so it can't go through a normal Caddy `reverse_proxy` directive the way the GUI can (that's HTTP/1.1 or HTTP/2 aware, not a raw TCP/UDP passthrough, unless you're using Caddy's non-default `layer4` plugin). Since you're already on Tailscale, there's no need to proxy this through Caddy or a public domain at all — Syncthing will connect device-to-device directly over the Tailscale interface. Don't route port 22000 through the Caddy site meant for the GUI; if a Caddyfile block for it exists, it's likely a no-op at best.

### Exposing the GraphQL API Through a Reverse Proxy

The frontend is a static bundle — Vite bakes `VITE_GRAPHQL_URL` into the built JS at **image build time**, not at container runtime. `docker-compose.yml`'s `frontend` build arg reads it from `${VITE_GRAPHQL_URL}` (set in gitignored `.env`, e.g. `https://gpx-report-api.example.com/graphql`) rather than a value hardcoded in the compose file, so the real domain never needs to be committed; the browser (wherever it's running — your laptop, your phone) needs to be able to resolve and reach that domain directly, and it does **not** matter what the backend container's address looks like from inside the Docker network.

*   **`http://localhost:4000/graphql` will not work** as this value once it's baked into a bundle served to a browser on a different machine than the server — "localhost" then means the browser's own device, which has nothing listening on port 4000. This caused an initial "Failed to fetch" on the dashboard; the fix was adding a real routable domain.
*   **Add a Caddy site for it**, matching the pattern already used for Syncthing's GUI:
    ```
    gpx-report-api.example.com {
        reverse_proxy localhost:4000
    }
    ```
    Unlike Syncthing, Apollo Server doesn't do `Host`-header validation, so no header rewrite is needed here.
*   **Any time `VITE_GRAPHQL_URL` changes, the frontend image must be rebuilt** (`docker compose up -d --build frontend`) — restarting the existing container alone won't pick up a new build arg, since it's compiled into the static JS, not read from the environment at runtime.

## 7. Browser-Based Editing (code-server)

`docker-compose.yml` includes a `code-server` service (`codercom/code-server`) — a full VS Code instance in the browser, with a terminal, bind-mounted read-write at the repo root (`./:/opt/gpx-report`).

*   **Start it:** `docker compose up -d code-server`, then open `http://<server-ip>:8443` (or `http://localhost:8443` if you're on the same machine).
*   **No login.** It's started with `--auth none`, so anyone who can reach it has a shell and write access to the whole repo — no password, no prompt. This is intentional: the domain (`gpx-report-code.example.com`, via a Caddy site same as §6) only resolves/routes within Tailscale on this deployment — there's no real public exposure, and it shares the same trust boundary as the unauthenticated Postgres port and Syncthing GUI. If this deployment ever becomes reachable from an untrusted network, set a real password instead (`PASSWORD=...` env var in place of `--auth none` in the `command:`) before relying on that assumption.
*   **Editor state (extensions, settings) persists** in the `code_server_data` named volume, mounted at `/root/.local` (the container runs as `user: "0:0"`, so `$HOME` is `/root`, not the image's default `/home/coder`) — separate from the repo bind mount, so `docker compose down`/`up` doesn't lose installed extensions.
*   Changes made through it land directly on the host filesystem (it's a bind mount, not a copy) — `git status` on the host will show them immediately, same as editing the files directly.
*   **The dashboard's "Code" tab (`frontend/src/pages/CodeEditor.tsx`) iframes `VITE_CODE_SERVER_URL`** (`https://gpx-report-code.example.com`, a Caddy site `reverse_proxy localhost:8443`, read from gitignored `.env` same as `VITE_GRAPHQL_URL` — see §6), baked in at frontend image build time. Changing it needs `docker compose up -d --build frontend`.
*   **The Code tab follows the dashboard's light/dark toggle.** `code_server_data` is also mounted read-write into the `backend` container at `/code-server-home`; toggling the app's theme calls the `setCodeServerTheme` mutation (`resolvers.js`), which writes `workbench.colorTheme` into code-server's `settings.json`, and `CodeEditor.tsx` then reloads the iframe so the new theme takes effect.

## 8. Testing

Unit tests (`backend/src/**/*.test.ts`, `frontend/src/**/*.test.tsx`) run via `npm test` in each subproject — no live stack needed, see CLAUDE.md.

A Playwright E2E smoke suite (`frontend/e2e/`, `frontend/playwright.config.ts`) runs against the *actual running docker-compose stack* instead — `npm run test:e2e` inside `frontend/`, with the stack already up (`docker compose up`). It's read-only for the real dataset (Dashboard load, opening a real activity, the Stats page) and creates/destroys its own disposable synthetic activity for the edit/trim/delete flow (dropped into and cleaned back out of the real `data/gpx/` — see `frontend/e2e/gpxFixture.ts`), so it's safe to run against a live deployment's real data. Every spec runs under both a desktop and a Chromium-based mobile-device emulation profile (`devices["Pixel 5"]` — not `devices["iPhone 13"]`/other WebKit-default profiles, since this host only has Chromium installed, not WebKit).

*   `E2E_BASE_URL` (default `http://localhost:3000`) and `E2E_GRAPHQL_URL` (default `http://localhost:4000/graphql`) point the suite at a non-default host/port.
*   `E2E_CHROMIUM_PATH` (default `/usr/bin/chromium`) points at a different browser binary — this suite deliberately uses an already-installed system Chromium via `launchOptions.executablePath` rather than `@playwright/test`'s own downloaded browsers, since a fresh `npx playwright install` needs a ~300MB download this host's network access can't always do (same reasoning as the TypeScript-conversion verification note in `docs/TODO.md`'s Done section).
*   Runs with a single Playwright worker (`workers: 1` in `playwright.config.ts`) — several concurrent headless Chromium instances reliably crash each other on a small (4 CPU/4GB) host already running the full compose stack.
*   Needs Node 20+ (this host's default `node` is 18) — see CLAUDE.md's Node version note for backend/frontend unit tests; the same applies here.

## 9. Deployment Notes (Proxmox LXC)

Running this in a Proxmox LXC container (as opposed to a full VM) has a couple of quirks worth knowing before you deploy:

*   **Surviving a power cycle needs no extra systemd unit.** Every service in `docker-compose.yml` already has `restart: unless-stopped`. As long as the Docker daemon itself is enabled at the systemd level (`systemctl enable docker` — check with `systemctl is-enabled docker`), a reboot brings the daemon back up, and Docker restarts every container that wasn't manually `docker compose down`'d beforehand. No cron job, no custom `.service` file, no `@reboot` entry needed — this was verified working on the actual deployment host.
*   **`.env` isn't committed** (it's gitignored) — after cloning onto a fresh host, `cp .env.example .env` and replace the placeholder `POSTGRES_PASSWORD` with a real generated value (e.g. `openssl rand -hex 16`) before the first `docker compose up`. The example password is a placeholder, not something to run with.
*   **The frontend image build is the slow step** — its multi-stage Dockerfile runs `npm install` (~4 min) and then `vite build` (~3–4 min) for the production bundle. A first `docker compose up -d --build` on a fresh host can take 8–10 minutes total; don't assume a hung terminal is a stuck build.
*   **Docker isn't guaranteed to be preinstalled on a fresh LXC** — check with `docker --version` before assuming it's there; on Debian-based LXCs it's a standard `apt-get install docker.io docker-compose-plugin` (or Docker's official convenience script) away.
*   **Syncthing crash-loops on first boot with `save cert: ... permission denied`** if `PUID`/`PGID` are left at the image's default of `1000:1000`. The official image's entrypoint only `chown`s `$HOME` (`/var/syncthing`) non-recursively on startup — it never reaches `/var/syncthing/config`, since that's a *separate* mounted volume that Docker creates owned by `root`. Syncthing then drops privileges to UID 1000 and can't write its own certificate into a root-owned directory. `docker-compose.yml` sets `PUID`/`PGID` to `0` (root) to sidestep this, which is fine on a single-user host where everything else (the `data/gpx` bind mount, the config volume) is root-owned anyway. You'll see a harmless `Syncthing should not run as a privileged or system user` warning in the logs as a result — expected, not a problem here.
*   **A small LXC disk fills up fast from Docker build cache.** Rebuilding the frontend/backend images repeatedly (each `docker compose up -d --build`) leaves behind dangling image layers and BuildKit cache, which grows unbounded and isn't reclaimed automatically. `docker/disk-cleanup.sh` (`docker builder prune -af`, `docker image prune -af`, `apt-get clean`, `journalctl --vacuum-time=7d`) runs weekly via a root crontab entry (`crontab -l` to view; `17 4 * * 0` — Sunday 4:17am, logs to `/var/log/disk-cleanup.log`) to keep this in check. Everything it removes is regenerable (build cache, package download cache, old log history) — safe to also run manually if `df -h /` looks tight before the next scheduled run.

## Running the Application

1.  Ensure the database is running.
2.  Start the backend server.
3.  Start the frontend development server.
4.  Place a few `.gpx` files in the configured `GPX_FILES_DIRECTORY`.
5.  Access the frontend in your browser and explore the dashboard. Use the Settings page to trigger re-analysis if needed.

