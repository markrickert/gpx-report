# Features

This document details the features of gpx-report, and reflects what is actually implemented (not just planned) as of this writing. For anything listed here as missing/partial, see [`TODO.md`](TODO.md).

## 1. Data Ingestion and Processing

*   **Automatic Detection:** A `chokidar` file watcher (Node) monitors `GPX_FILES_DIRECTORY` for new GPX files, and fires for every pre-existing file on startup too.
*   **GPX Parsing:** Uses the `gpxparser` npm package to extract track points, timestamps, and metadata from GPX files (not Python/`gpxpy` — this is a plain Node backend, see `CLAUDE.md`).
*   **Metric Calculation:** Computes key metrics:
    *   Distance Traveled
    *   Duration
    *   Average & Maximum Speed/Pace
    *   Total Elevation Gain & Loss
    *   Activity Type (from the GPX `<trk><type>` tag if present, else guessed from the filename, else "Unknown")
    *   Title (from the track/metadata name in the GPX file, else the filename stem)
*   **Route Data Extraction:** Stores sequences of latitude, longitude, elevation, and timestamp for each activity.
*   **Database Storage:** Processed data is stored in PostgreSQL, with route geometries managed by PostGIS.
*   **Re-analysis Capability:** Allows users to re-process existing GPX files (all, or by date range) via the Settings page. Only re-processes files that already have a matching `activities` row — see `docs/DATA_MODEL.md`.

## 2. Dashboard View

*   **Aggregate Summary:** A prominent section at the top displays key overall statistics:
    *   Total number of activities.
    *   Total distance covered across all activities.
    *   Total duration of all activities.
    *   Total elevation gain across all activities.
    *   Timestamp of the last full data re-analysis.
*   **Activity List:** A reverse-chronologically sorted list of all recorded activities below the summary.
    *   Each list item displays: Activity Type, Date/Time, Distance, Duration, and potentially a brief summary metric.
    *   Clicking an item navigates to the individual Activity Detail Page.
*   **Filtering:** The activity list can be filtered by `activityType`.

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
*   **Map View:** An interactive map displaying the geographical path of the activity.
*   **Elevation Profile:** A graph showing elevation changes plotted against the distance traveled during the activity.

## 4. Settings Page

*   **Re-analysis Controls:** Provides options to re-process GPX data:
    *   `Last Week`
    *   `Last Month`
    *   `Last Year`
    *   `All Time`
    *   Triggers a GraphQL mutation to initiate the re-analysis process.
    *   Displays progress or completion status.

## 5. Data Management

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

