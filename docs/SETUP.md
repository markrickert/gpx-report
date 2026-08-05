# Setup and Installation

This document provides instructions for setting up the development environment and running [Your Project Name].

## Prerequisites

*   **Node.js & npm/yarn:** For the React frontend.
*   **Docker & Docker Compose:** Recommended for managing the PostgreSQL database and potentially the backend API if it's containerized.
*   **Python 3:** For the GPX parsing and data processing scripts.
*   **Git:** For version control.

## 1. Project Structure

\`\`\`
your-project-root/
├── .git/
├── frontend/             # React application
│   ├── public/
│   ├── src/
│   │   ├── components/
│   │   ├── graphql/        # GraphQL client setup and queries
│   │   ├── hooks/
│   │   ├── pages/
│   │   ├── styles/
│   │   └── App.js
│   └── package.json
├── backend/              # Backend API (e.g., Node.js with Apollo Server, Python with Flask/FastAPI)
│   ├── src/
│   │   ├── graphql/        # GraphQL schema definitions, resolvers
│   │   ├── models/         # Database models/ORM
│   │   ├── services/       # Business logic, GPX processing logic
│   │   └── index.js        # Server entry point
│   ├── docker-compose.yml  # Docker configuration for DB and potentially backend
│   ├── db/                 # Database scripts (schema definitions, migrations)
│   ├── gpx_processor/      # Python scripts for GPX parsing
│   │   ├── __init__.py
│   │   ├── parser.py
│   │   └── processor.py
│   └── package.json        # Backend dependencies
└── README.md
└── docs/
    ├── ARCHITECTURE.md
    ├── DATA_MODEL.md
    ├── FEATURES.md
    └── SETUP.md
\`\`\`

## 2. Database Setup (PostgreSQL with PostGIS)

1.  **Using Docker (Recommended):**
    *   Navigate to the `backend/` directory.
    *   Ensure you have a `docker-compose.yml` file configured for PostgreSQL with PostGIS. Example snippet:
        \`\`\`yaml
        version: '3.8'
        services:
          db:
            image: postgis/postgis:13-3.1 # Use a suitable PostGIS version
            container_name: your-project-db
            ports:
              - "5432:5432"
            environment:
              POSTGRES_USER: youruser
              POSTGRES_PASSWORD: yourpassword
              POSTGRES_DB: yourdbname
            volumes:
              - db_data:/var/lib/postgresql/data

        volumes:
          db_data:
        \`\`\`
    *   Run `docker-compose up -d` in the `backend/` directory.
    *   Connect to the database using a tool like `psql` or pgAdmin.

2.  **Local Installation:**
    *   Install PostgreSQL and the PostGIS extension following your operating system's instructions.
    *   Create a database, user, and grant necessary privileges.

3.  **Schema Initialization:**
    *   Apply the database schema defined in `docs/DATA_MODEL.md`. You may want to create SQL migration scripts within `backend/db/`.
    *   Ensure the PostGIS extension is enabled in your database: `CREATE EXTENSION IF NOT EXISTS postgis;`

## 3. Backend Setup

1.  **Install Dependencies:**
    *   Navigate to the `backend/` directory.
    *   Run `npm install` (or `yarn install`) for Node.js, or `pip install -r requirements.txt` for Python.
2.  **Configure Environment Variables:**
    *   Create a `.env` file in the `backend/` directory for database connection strings, API keys, etc.
    *   Example `.env` for PostgreSQL:
        \`\`\`
        DATABASE_URL=postgresql://youruser:***@localhost:5432/yourdbname
        GRAPHQL_PORT=4000
        GPX_FILES_DIRECTORY=/path/to/your/gpx/files # IMPORTANT: Set this to where you'll put GPX files
        \`\`\`
3.  **Start the Backend Server:**
    *   Run `npm start` (or `yarn start`) or `python index.py`.

## 4. Frontend Setup

1.  **Install Dependencies:**
    *   Navigate to the `frontend/` directory.
    *   Run `npm install` (or `yarn install`).
2.  **Configure API Endpoint:**
    *   Ensure your GraphQL client is configured to point to your backend API endpoint (e.g., `http://localhost:4000/graphql`). This is typically done in `frontend/src/graphql/client.js` or similar.
3.  **Start the Development Server:**
    *   Run `npm start` (or `yarn start`).
    *   The application will typically be available at `http://localhost:3000`.

## 5. Data Ingestion Setup

1.  **Configure GPX Directory:**
    *   Ensure the `GPX_FILES_DIRECTORY` environment variable in your backend `.env` file points to a directory where you will place your `.gpx` files for processing.
2.  **Run the GPX Processor:**
    *   The GPX processing logic (e.g., Python scripts in `backend/gpx_processor/`) should be configured to run periodically or be triggered by file system events (e.g., using libraries like `watchdog` in Python).
    *   You may need to adjust how this processor runs:
        *   **As a separate background service:** Recommended for reliable processing.
        *   **Triggered by API mutation:** The `reanalyze` mutation could explicitly call this script.
        *   **File watcher daemon:** Automatically watches the GPX directory.

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
    *   Set the folder type to **Send Only** on the phone (the phone should never receive changes back).
7.  **Accept the folder on the server:**
    *   The server web GUI will show an incoming folder offer — click **Add**.
    *   Set the folder path to `/var/syncthing/gpx` (this is mounted to `./data/gpx` on the host).
    *   Set the folder type to **Receive Only** (the server should never push changes to your phone).
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

## 7. Deployment Notes (Proxmox LXC)

Running this in a Proxmox LXC container (as opposed to a full VM) has a couple of quirks worth knowing before you deploy:

*   **Surviving a power cycle needs no extra systemd unit.** Every service in `docker-compose.yml` already has `restart: unless-stopped`. As long as the Docker daemon itself is enabled at the systemd level (`systemctl enable docker` — check with `systemctl is-enabled docker`), a reboot brings the daemon back up, and Docker restarts every container that wasn't manually `docker compose down`'d beforehand. No cron job, no custom `.service` file, no `@reboot` entry needed — this was verified working on the actual deployment host.
*   **`.env` isn't committed** (it's gitignored) — after cloning onto a fresh host, `cp .env.example .env` and replace the placeholder `POSTGRES_PASSWORD` with a real generated value (e.g. `openssl rand -hex 16`) before the first `docker compose up`. The example password is a placeholder, not something to run with.
*   **The frontend image build is the slow step** — its multi-stage Dockerfile runs `npm install` (~4 min) and then `vite build` (~3–4 min) for the production bundle. A first `docker compose up -d --build` on a fresh host can take 8–10 minutes total; don't assume a hung terminal is a stuck build.
*   **Docker isn't guaranteed to be preinstalled on a fresh LXC** — check with `docker --version` before assuming it's there; on Debian-based LXCs it's a standard `apt-get install docker.io docker-compose-plugin` (or Docker's official convenience script) away.
*   **Syncthing crash-loops on first boot with `save cert: ... permission denied`** if `PUID`/`PGID` are left at the image's default of `1000:1000`. The official image's entrypoint only `chown`s `$HOME` (`/var/syncthing`) non-recursively on startup — it never reaches `/var/syncthing/config`, since that's a *separate* mounted volume that Docker creates owned by `root`. Syncthing then drops privileges to UID 1000 and can't write its own certificate into a root-owned directory. `docker-compose.yml` sets `PUID`/`PGID` to `0` (root) to sidestep this, which is fine on a single-user host where everything else (the `data/gpx` bind mount, the config volume) is root-owned anyway. You'll see a harmless `Syncthing should not run as a privileged or system user` warning in the logs as a result — expected, not a problem here.

## Running the Application

1.  Ensure the database is running.
2.  Start the backend server.
3.  Start the frontend development server.
4.  Place a few `.gpx` files in the configured `GPX_FILES_DIRECTORY`.
5.  Access the frontend in your browser and explore the dashboard. Use the Settings page to trigger re-analysis if needed.

