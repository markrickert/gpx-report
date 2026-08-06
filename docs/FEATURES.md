# Features

This document details the features of gpx-report, and reflects what is actually implemented (not just planned) as of this writing. For anything listed here as missing/partial, see [`TODO.md`](TODO.md).

## 1. Data Ingestion and Processing

*   **Automatic Detection:** A `chokidar` file watcher (Node) monitors `GPX_FILES_DIRECTORY` for new `.gpx` and `.igc` files, and fires for every pre-existing file on startup too.
*   **GPX Parsing:** Uses the `gpxparser` npm package to extract track points, timestamps, and metadata from GPX files (not Python/`gpxpy` — this is a plain Node backend, see `CLAUDE.md`).
*   **IGC Parsing:** Paragliding flight-recorder logs (`.igc`) are parsed directly via regex against the fixed-width `B`-record/`HFDTE` format (no third-party IGC library) — see `backend/src/igc/parser.js`.
*   **Metric Calculation:** Computes key metrics for both formats:
    *   Distance Traveled
    *   Duration
    *   Average & Maximum Speed/Pace
    *   Total Elevation Gain & Loss
    *   Activity Type (from the GPX `<trk><type>` tag if present, else guessed from the filename, else "Unknown"; always "Paragliding" for IGC)
    *   Title (from the track/metadata name in the GPX file, else the filename stem; always the filename stem for IGC)
*   **Route Data Extraction:** Stores sequences of latitude, longitude, elevation, and timestamp for each activity.
*   **Database Storage:** Processed data is stored in PostgreSQL, with route geometries managed by PostGIS.
*   **Re-analysis Capability:** Allows users to re-process existing GPX/IGC files (all, or by date range) via the Settings page. Only re-processes files that already have a matching `activities` row — see `docs/DATA_MODEL.md`.

## 2. Dashboard View

*   **Aggregate Summary:** A prominent section at the top displays key overall statistics:
    *   Total number of activities.
    *   Total distance covered across all activities.
    *   Total duration of all activities.
    *   Total elevation gain across all activities.
    *   Timestamp of the last full data re-analysis.
*   **Activity List:** A reverse-chronologically sorted list of all recorded activities below the summary.
    *   Each list item displays a small SVG route-shape thumbnail (client-side, built from route coordinates — no basemap tiles), plus Title, Activity Type, Date/Time, Distance, and Duration.
    *   Rows fade/slide into view as they scroll into the viewport, staggered slightly so a batch doesn't all animate at once (respects `prefers-reduced-motion`).
    *   Clicking an item navigates to the individual Activity Detail Page.
*   **Infinite Scroll:** Loads 50 activities at a time and fetches more automatically via an `IntersectionObserver` as the user scrolls, rather than capping the list.
*   **Filtering:** The activity list can be filtered by `activityType`; changing the filter resets pagination to the first page.

## 3. Individual Activity Detail Page

*   **Header Information:** Displays core details for the selected activity:
    *   Activity Type
    *   Date & Time
    *   Duration
    *   Distance
    *   Average Speed/Pace
    *   Max Speed/Pace
    *   Total Elevation Gain
    *   Total Elevation Loss
*   **Title Editing:** The activity title has an inline Edit/Save/Cancel affordance; saving updates both the database row and rewrites the `<trk><name>` element in the source `.gpx` file, then re-runs processing so both stay in sync. Only available for `.gpx` activities — `.igc` has no writer path, so the Edit button is hidden for those.
*   **Activity Type Editing:** Same inline Edit/Save/Cancel affordance next to the activity-type badge, backed by a dropdown of the same preselected activity types used for the dashboard filter; saving rewrites the `<trk><type>` element in the source `.gpx` file and re-runs processing. Same `.gpx`-only restriction as title editing.
*   **Map View:** An interactive map displaying the geographical path of the activity.
*   **Elevation Profile:** A graph showing elevation changes plotted against the distance traveled, with the Y-axis scaled to the activity's actual elevation range (not a fixed 0-based domain) so variation stays visible regardless of altitude.
*   **Hover-Synced Position Dot:** Hovering the elevation profile shows a dot on the map at the corresponding point, and hovering the map route shows the corresponding point on the elevation profile — both tracking the same point-in-time index. Desktop-oriented (hover-based); no touchscreen equivalent.

## 4. Settings Page

*   **Re-analysis Controls:** Provides options to re-process GPX data:
    *   `Last Week`
    *   `Last Month`
    *   `Last Year`
    *   `All Time`
    *   Triggers a GraphQL mutation to initiate the re-analysis process.
    *   Displays progress or completion status.

## 5. Stats Page

*   **Per-Activity-Type Breakdown:** A table of aggregate stats grouped by activity type — count, total/average distance, total/average duration, and average elevation gain — computed live from the database (all-time, unfiltered).
*   **Calendar Heatmap:** A GitHub-style contribution grid (one square per day, 7 rows × ~53 columns) showing activity frequency across a chosen year, to surface seasonal patterns (e.g. skiing only showing up in winter months). Square intensity reflects activity count that day; a type dropdown (default "All types") filters which activities are counted, and a year dropdown switches between years present in the data. Built client-side from a lightweight `activities(limit: 1000)` fetch (id/startTime/activityType only), no backend aggregation needed at this dataset size.

## 6. Heatmap Page

*   **Density Heatmap:** A nav tab (`/heatmap`) renders every activity's route coordinates as a single `leaflet.heat` density heatmap over a basemap, using the same CARTO-dark/OSM-light tile split (by theme) as the Activity Detail map.
*   **Elevation Banding:** A "Color by elevation" checkbox switches to 4 separate heat layers, one per elevation quartile of the dataset (computed from all loaded points), each rendered in a fixed single-color gradient with a swatch-and-range legend below the checkbox.
*   **Payload Sizing:** The backing `heatmapPoints` GraphQL query returns `[lat, lon, elevation]` triples for every activity at once (no pagination), but caps/samples each route at 300 points server-side so a personal-scale dataset (hundreds of activities) stays a few MB rather than tens of MB at full GPS resolution.

## 7. Units

*   **km/miles Toggle:** A nav-bar toggle switches all distance/speed/elevation display between metric (km, km/h, m) and imperial (mi, mph, ft), backend by a React context persisted to `localStorage`. Defaults to imperial.

## 8. Code Tab

*   **Embedded Editor:** A nav tab iframes a `code-server` (browser VS Code) instance bind-mounted read-write at the repo root, for making and committing changes to gpx-report from the same UI. Reachable only within the deployment's Tailscale network — see `CLAUDE.md` deployment notes.

## 9. Data Management

*   **Self-Hosted:** All data is stored locally, ensuring user privacy and control.
*   **GPX File Synchronization:** Assumes GPX files are externally synchronized to a monitored directory. No built-in upload or file management in v1.

## User Flows

### Viewing Dashboard & Individual Activity
1.  User accesses the main dashboard.
2.  Sees aggregate summary and a list of recent activities.
3.  Clicks on an activity from the list.
4.  Is taken to the Activity Detail Page, where they can view map, elevation, and metrics.

### Re-analyzing Data
1.  User navigates to the Settings page.
2.  Selects a re-analysis option (e.g., "Last Month").
3.  Clicks a "Re-analyze" button.
4.  A GraphQL mutation is sent to the backend.
5.  User receives feedback on the re-analysis process (e.g., "Initiating re-analysis for the last month...").

### Filtering Activities
1.  User is on the Dashboard.
2.  Selects an `activityType` from a dropdown or filter control.
3.  The activity list updates to show only activities of that type, still in reverse chronological order.

