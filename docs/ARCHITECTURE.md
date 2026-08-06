# Architecture Overview

This document outlines the architecture of gpx-report, a self-hosted platform for analyzing GPX activity data.

## 1. Frontend (React)

*   **Purpose:** Provides the user interface for viewing, analyzing, and managing activity data.
*   **Key Components:**
    *   **Dashboard:** Displays aggregate statistics and a chronological list of activities, filterable by activity type.
    *   **Activity Detail Page:** Shows detailed metrics, map visualization, and elevation profile for a single activity.
    *   **Settings Page:** Allows users to trigger re-analysis (last week / month / year / all time).
    *   **Record Page:** Records a track live in the browser via `navigator.geolocation.watchPosition()` (foreground only — no background GPS), then builds a GPX document client-side and submits it to the backend to be written to disk and ingested through the normal pipeline.
*   **Data Interaction:** Communicates with the backend via a GraphQL API (`@apollo/client`).
*   **Mapping:** `react-leaflet` / `leaflet`, tiles from OpenStreetMap.
*   **Charting:** `recharts` for the elevation profile.
*   **Build tool:** Vite. No state management library beyond the Apollo cache. No auth — single-user, personal deployment.

## 2. Backend API (GraphQL)

*   **Purpose:** Serves as the interface between the React frontend and the data storage/processing layers.
*   **Technology:** Apollo Server on Express (`expressMiddleware` mounted at `/graphql`, so a plain `GET /activities/:id/download` route can sit alongside it), plain Node.js with ESM, no ORM.
*   **Key Operations:**
    *   **Queries:**
        *   Fetch individual activity details (`activity(id: ID!)`).
        *   Fetch aggregate statistics (`activitySummary`, `aggregatedStatsByType(activityType, startDate, endDate)`).
        *   Fetch paginated/filtered lists of activities (`activities(limit: Int = 20, offset: Int = 0, activityType: String, startDate: DateTime, endDate: DateTime)`). Returns data sorted reverse-chronologically by default.
    *   **Mutations:**
        *   Trigger re-analysis of data (`reanalyzeAllActivities`, `reanalyzeActivitiesByDateRange(startDate: DateTime!, endDate: DateTime!)`).
        *   Save a browser-recorded track (`saveRecordedActivity(gpxContent: String!)`): validates the submitted GPX string minimally (size cap, looks like GPX), writes it to a server-generated filename (never derived from client input) in `GPX_FILES_DIRECTORY`, and returns without waiting for ingestion — the file watcher (below) picks it up asynchronously through the normal pipeline.
*   **Resolver Logic:** `graphql/resolvers.js` queries `pg.Pool` directly with hand-written SQL (see `backend/src/graphql/resolvers.js`). `activitySummary` and `aggregatedStatsByType` are computed live with `SUM`/`AVG`/`GROUP BY` on each request — there is no materialized view or cache.

## 3. Database (PostgreSQL with PostGIS)

*   **Purpose:** Stores all processed activity data and route information.
*   **Technology:** PostgreSQL (`postgis/postgis:15-3.4` image), PostGIS extension for geospatial capabilities.
*   **Key Tables** (see `docs/DATA_MODEL.md` and `backend/db/init.sql` for the authoritative schema):
    *   `activities`: One row per GPX file (unique on `gpx_filename`) — title, type, timestamps, distance, duration, speed, elevation stats.
    *   `activity_routes`: One row per activity (`activity_id` PK/FK) — a PostGIS `GEOMETRY(LineString, 4326)`, plus a redundant `points_data` JSONB array (`{lat, lon, elevation, timestamp}` per point) and `elevation_profile_data` JSONB, since GeoJSON round-tripping loses elevation/timestamp per point.
*   There is no separate `activity_summary` or `aggregated_stats_by_type` table — those are computed on the fly by the resolvers, not pre-aggregated.
*   **Geospatial Capabilities:** `route_geom` has a GiST index; PostGIS functions aren't yet used for any query beyond storage (no geospatial queries — e.g. "activities near X" — are implemented).
*   **Migrations:** `init.sql` only runs on a fresh volume (via the Postgres image's init-script mechanism); there is no migration tool, so schema changes to an existing deployment need a manual `ALTER`/psql step. See [`TODO.md`](TODO.md).

## 4. Data Ingestion & Processing Pipeline

*   **Purpose:** Handles the parsing of raw GPX/IGC/Ski Tracks files and populates the PostgreSQL database.
*   **Trigger:** A `chokidar` file watcher (`backend/src/gpx/watcher.js`) watches `GPX_FILES_DIRECTORY` for `.gpx`, `.igc`, and `.skiz` files; on startup it fires an `add` event for every pre-existing file, then continues watching for new ones. Files land in that directory either externally (Syncthing/manual drop) or via the `saveRecordedActivity` mutation (Record page) writing a new file into the same directory — either way, the watcher is the single trigger into this pipeline.
*   **Components:**
    *   **GPX Parser** (`backend/src/gpx/parser.js`): Uses the `gpxparser` npm package to read GPX files and extract track points/timestamps, then computes distance/speed/elevation stats gpxparser doesn't provide itself. Activity type is read from the GPX `<trk><type>` tag when present (mapped through a label table), falling back to a filename-keyword guess (matches "running", "hiking", etc.) or "Unknown".
    *   **IGC Parser** (`backend/src/igc/parser.js`): For paragliding flight-recorder logs. Regex-parses `HFDTE` date headers and `B`-record fixes (lat/lon/altitude/timestamp) directly — no third-party IGC library — then computes distance/speed/elevation stats with a haversine helper (`haversineMeters`, exported for reuse), returning the same shape the GPX parser does. IGC has no track-name/type header, so title falls back to the filename stem and activity type is fixed to "Paragliding".
    *   **Ski Tracks Parser** (`backend/src/skiz/parser.js`): For `.skiz` exports from the Ski Tracks app. The format is a zip archive containing `Track.xml` (a single `<track name="..." activity="...">` element, regex-extracted for title/activity type — no XML DOM lib, same approach as `gpx/writer.js`) and a headerless `Nodes.csv` (timestamp, lat, lon, elevation, course, speed, horizontal/vertical accuracy per line); unzipped via `adm-zip`. Reuses `igc/parser.js`'s `haversineMeters` for distance/speed/elevation stats rather than trusting `Track.xml`'s own precomputed metrics, for consistency with how GPX/IGC are handled. Verified against 91 real exports recovered from this deployment's Syncthing container (see `docs/SETUP.md`'s Ski Tracks note).
    *   **Database Writer** (`backend/src/gpx/processor.js`): `processFile()` dispatches to whichever parser matches the file extension, then upserts one activity + its route (keyed by `gpx_filename`, so re-processing the same file is idempotent) inside a single transaction.
*   **Re-analysis:** The `reanalyze*` mutations call `reanalyzeAll()` / `reanalyzeByDateRange()` in `processor.js`, which re-run this same pipeline over existing files.
*   **Concurrency:** Both the watcher (strict FIFO, one file at a time) and `reanalyze*` (batches of 5 via `processAll()`) bound how many files are processed concurrently, since the default `pg.Pool` only has 10 connections — see `CLAUDE.md` and `docs/SETUP.md` §5 for the pool-exhaustion incident this guards against.

## Integration Flow

1.  User adds GPX, IGC, or Ski Tracks (`.skiz`) files to a monitored directory (manually, or synced from a phone via Syncthing — see `docs/SETUP.md` §6).
2.  The **file watcher** detects new files, the **parser** extracts metrics, and the **processor** upserts activity + route data into **PostgreSQL**.
3.  The **React Frontend** makes GraphQL queries to the **Backend API**.
4.  The **Backend API** (GraphQL resolvers) queries the **PostgreSQL Database** for activity details, aggregate stats, or route geometries.
5.  For re-analysis, the **React Frontend** (Settings page) triggers a GraphQL mutation, which instructs the **Backend API** to re-run the ingestion pipeline over existing files, optionally scoped to a date range.
6.  Map and elevation data are rendered in the **React Frontend** using `react-leaflet` and `recharts`.
