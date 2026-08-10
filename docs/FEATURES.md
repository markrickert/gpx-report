# Features

This document details the features of gpx-report, and reflects what is actually implemented (not just planned) as of this writing. For anything listed here as missing/partial, see [`TODO.md`](TODO.md).

## 1. Data Ingestion and Processing

*   **Automatic Detection:** A `chokidar` file watcher (Node) monitors `GPX_FILES_DIRECTORY` for new `.gpx`, `.igc`, `.skiz` files, and fires for every pre-existing file on startup too.
*   **GPX Parsing:** Uses the `gpxparser` npm package to extract track points, timestamps, and metadata from GPX files (not Python/`gpxpy` — this is a plain Node backend, see `CLAUDE.md`).
*   **IGC Parsing:** Paragliding flight-recorder logs (`.igc`) are parsed directly via regex against the fixed-width `B`-record/`HFDTE` format (no third-party IGC library) — see `backend/src/igc/parser.js`.
*   **Ski Tracks Parsing:** Ski-tracking exports from the Ski Tracks app (`.skiz`) are unzipped via `adm-zip` and their `Nodes.csv` payload parsed directly, with title/activity type regex-extracted from the bundled `Track.xml` — see `backend/src/skiz/parser.js`.
*   **Metric Calculation:** Computes key metrics for all formats:
    *   Distance Traveled
    *   Duration
    *   Average & Maximum Speed/Pace
    *   Total Elevation Gain & Loss
    *   Activity Type (from the GPX `<trk><type>` tag if present, else guessed from the filename, else "Unknown"; always "Paragliding" for IGC; from `Track.xml`'s `activity` attribute, defaulting to "Skiing", for `.skiz`)
    *   Title (from the track/metadata name in the GPX file, else the filename stem; always the filename stem for IGC; from `Track.xml`'s `name` attribute, else the filename stem, for `.skiz`)
*   **Route Data Extraction:** Stores sequences of latitude, longitude, elevation, and timestamp for each activity.
*   **Database Storage:** Processed data is stored in PostgreSQL, with route geometries managed by PostGIS.
*   **Re-analysis Capability:** Allows users to re-process existing GPX/IGC/Ski Tracks files (all, or by date range) via the Settings page. Only re-processes files that already have a matching `activities` row — see `docs/DATA_MODEL.md`.
*   **Reverse-Geocoded Location Name:** Resolves each activity's start point to a place name (city/town/village/suburb) via Nominatim (OSM), stored as `activities.location_name` and shown on the Dashboard list and Activity Detail header when present. Only runs for genuinely new files reaching the watcher after startup, throttled to Nominatim's 1 req/sec policy — never for bulk re-analysis or the watcher's startup replay of existing files, which would need many requests at once. A separate throttled script backfills existing activities; a failed/absent lookup just leaves the field blank rather than affecting ingestion.

## 2. Dashboard View

*   **Aggregate Summary:** A prominent section at the top displays key overall statistics:
    *   Total number of activities.
    *   Total distance covered across all activities.
    *   Total duration of all activities.
    *   Total elevation gain across all activities.
    *   Timestamp of the last full data re-analysis.
*   **Activity List:** A reverse-chronologically sorted list of all recorded activities below the summary.
    *   Each list item displays a small SVG route-shape thumbnail (no basemap tiles), built client-side from a `routeThumbnail` field that's pre-sampled down to a handful of `[lat, lon]` pairs in SQL as part of the `activities` query — the list never fetches each route's full-resolution points just to draw a thumbnail — plus Title, Activity Type, Date/Time, Distance, Duration, and — when resolved — the reverse-geocoded location name.
    *   Rows fade/slide into view as they scroll into the viewport, staggered slightly so a batch doesn't all animate at once (respects `prefers-reduced-motion`).
    *   Clicking an item navigates to the individual Activity Detail Page.
*   **Infinite Scroll:** Loads 50 activities at a time and fetches more automatically via an `IntersectionObserver` as the user scrolls, rather than capping the list.
*   **Filtering:** The activity list can be filtered by `activityType`, and searched by title (case-insensitive substring match, debounced 300ms); changing either resets pagination to the first page.
*   **"On This Day" Recap:** A card above the filter row surfaces past activities that happened on today's calendar date in a prior year, with each activity's "N years ago" label; hidden entirely when nothing matches.
*   **CSV Export:** A "Download CSV" button exports the currently-loaded/filtered activity list (title, type, date, distance, duration, elevation gain, average speed) as a CSV file, honoring the active type/search filter — client-side only, exports just what's currently loaded rather than re-fetching everything.
*   **Bulk Actions:** A "Select" toggle puts the activity list into multi-select mode, adding a checkbox to each row. With one or more selected, an action bar offers retyping all of them at once (via the same activity-type dropdown used elsewhere) or deleting all of them at once (same destructive-action confirmation as the single-activity delete on the Activity Detail page). Both actions reuse the existing per-activity `updateActivityType`/`deleteActivity` mutations, firing one per selected activity; the list refetches and select mode exits once the operation completes.

## 3. Individual Activity Detail Page

*   **Prev/Next Navigation:** A "← Previous"/"Next →" link pair above the title jumps directly to the chronologically adjacent activity (by `startTime`, matching the Dashboard's newest-first ordering — "Next" is the more recent activity) without returning to the Dashboard list. Whichever link would go out of range (oldest activity has no "Previous", newest has no "Next") is simply omitted.
*   **Header Information:** Displays core details for the selected activity:
    *   Activity Type
    *   Date & Time
    *   Location Name (reverse-geocoded, when resolved)
    *   Duration
    *   Distance
    *   Average Speed/Pace
    *   Moving Speed/Pace
    *   Max Speed/Pace
    *   Grade-Adjusted Pace
    *   Total Elevation Gain
    *   Total Elevation Loss
*   **Title Editing:** The activity title has an inline Edit/Save/Cancel affordance; saving updates both the database row and rewrites the source file (the `<trk><name>` element for `.gpx`, `Track.xml`'s `name` attribute for `.skiz`), then re-runs processing so both stay in sync. Available for `.gpx` and `.skiz` activities — `.igc` has no writer path, so the Edit button is hidden for those.
*   **Activity Type Editing:** Same inline Edit/Save/Cancel affordance next to the activity-type badge, backed by a dropdown of the same preselected activity types used for the dashboard filter; saving rewrites the `<trk><type>` element (`.gpx`) or `Track.xml`'s `activity` attribute (`.skiz`) and re-runs processing. Same `.gpx`/`.skiz` availability as title editing. When the activity's current type is "Unknown", up to 3 heuristic-ranked suggestion chips appear above the dropdown (backend's `Activity.suggestedActivityTypes`, `backend/src/track/suggestType.js` — ranks candidate types by how well the track's own avg/max speed and elevation-gain/loss-per-km fit rough per-type bands, not the flat alphabetical list) so the likeliest types are one tap away instead of scrolling the full dropdown.
*   **Unknown Activity Type Styling:** Dashboard rows whose `activityType` fell back to "Unknown" (`gpx/parser.js`'s filename-guess list found no match, and no `<trk><type>`/format-native type was present) render with a warning-tinted background/border and a small "Needs review" badge, so they stand out from typed rows in the list rather than blending in.
*   **Activity Type Icons:** Wherever an activity's type is shown as text (Dashboard list/On This Day, Activity Detail header/compare picker/similar-activities, Settings' outlier/lift lists, Stats tables), a best-effort emoji is prefixed to it — `frontend/src/activityTypeIcons.js`'s `activityTypeLabel()` maps known types (🥾 Hiking, 🪂 Paragliding, 🚵 Mountain Biking, ⛷️ Skiing, etc.) to an icon, falling back to plain text for anything unmapped (custom/unrecognized raw types, "Unknown") rather than guessing with a generic symbol.
*   **Map View:** An interactive map displaying the geographical path of the activity, colored by speed — the route is drawn as up to 150 chunked segments (grouped for pan/zoom performance on dense tracks), each colored along a red(slow)→blue(fast) scale by that stretch's average speed, with a min/max speed legend below the map. Same color scale as the elevation chart's speed gradient (below) for a consistent read between the two.
*   **Elevation Profile:** A graph showing elevation changes plotted against the distance traveled, with the Y-axis scaled to the activity's actual elevation range (not a fixed 0-based domain) so variation stays visible regardless of altitude.
*   **Hover-Synced Position Dot:** Hovering the elevation profile shows a dot on the map at the corresponding point, and hovering the map route shows the corresponding point on the elevation profile — both tracking the same point-in-time index. Desktop-oriented (hover-based); no touchscreen equivalent.
*   **GPS Anomaly Cleanup:** When the backend's outlier detector (see Settings Page below) flags GPS points on this activity, a "⚠️ GPS Anomalies" section appears below the elevation profile: a map overlay (grey = original track, blue = track with the flagged points removed, red markers = the flagged points themselves) plus a before/after stats table (max speed, distance, point count), computed by actually running the removal against a scratch copy of the source file and re-parsing it — not an estimate — so the preview always matches what saving produces. A "Clean & Save" button (destructive-action confirmation, like Trim) permanently rewrites the source file to drop just those points and re-runs processing. Available for `.gpx`, `.skiz`, *and* `.igc` — wider format support than title/type/trim editing, since removing arbitrary points doesn't need the richer per-format write paths those need.
*   **Elevation Spike Normalization:** When the backend's elevation-spike detector (see Settings Page below) flags points on this activity, a "⚠️ Elevation Spikes" section appears below GPS Anomaly Cleanup: a before/after elevation-profile chart (grey = original, blue = normalized, with the flagged stretches shaded) plus an Elevation Gain/Loss diff table. Unlike GPS Anomaly Cleanup, this doesn't remove points — it corrects just the elevation value of each flagged point via linear interpolation between its nearest good neighbors, leaving lat/lon/timestamp/point-count untouched, since the position fix was fine and only the altitude reading was bad. A "Normalize & Save" button (same destructive-action confirmation pattern) permanently rewrites the source file's elevation field for just those points and re-runs processing. Available for `.gpx`, `.skiz`, and `.igc`.
*   **Moving Speed:** A "Moving Speed" metric tile shows average speed computed only over segments where consecutive-point speed is at or above a 0.3 m/s "moving" threshold, excluding stopped time (traffic lights, breaks, photo stops) that drags down the raw Average Speed tile. Computed server-side at ingest time (`moving_avg_speed_mps` on `activities`), alongside — not replacing — `avg_speed_mps`.
*   **Grade-Adjusted Pace:** A "Grade-Adjusted Pace" metric tile shows an effort-normalized average speed alongside raw Average Speed, so climbs and descents don't make equal-effort pace look artificially slow or fast. Computed entirely client-side from the existing elevation profile (distance/elevation/speed already loaded for the chart above) — grade is measured over ≥10m windows rather than point-to-point to avoid GPS/barometric noise, then scaled by a published grade-cost formula (Minetti et al. 2002) and time-weighted into a single track average. No new data stored or fetched.
*   **Lift (chairlift/gondola) Detection:** The elevation chart shades any stretch the backend's lift detector (see Settings Page below) identifies as a lift ride with a purple band, alongside the existing grey rest-stop bands. When at least one lift segment is detected, a "Gain Excluding Lift" metric tile appears next to Elevation Gain, showing `totalElevationGain` minus the lift-attributed climb — informational only, the stored elevation stats and source file are untouched. Works for any activity type (a hike or ski day that includes a lift ride alike), since detection is based on track shape (straight-line, constant-speed, steady climb) rather than `activityType`.
*   **Delete Activity:** A "Delete Activity" button (destructive-action confirmation, like Trim/Clean & Save) permanently deletes the activity — both the database row and its source file under `data/gpx/` — and returns to the Dashboard. Since the source file itself is removed, the watcher/re-analysis never re-ingest it on a later restart or rescan. Available for every file type (`.gpx`, `.skiz`, `.igc`), unlike title/type/trim editing.
*   **Compare with Another Activity:** A "Compare" section below the GPS Anomaly Cleanup area lets you pick a second activity via a debounced search-by-title picker (same pattern as the Dashboard's search), then shows a stats diff table (distance, duration, elevation gain, avg speed — primary vs. comparison, with a signed delta) and overlays both activities' elevation profiles on one chart. The overlay's x-axis is percent-of-distance-covered rather than point index, so tracks of different lengths still align sensibly. Purely additive — doesn't affect the primary elevation chart above it.
*   **Similar Past Activities:** A "Similar Past Activities" section below the Compare section lists up to 5 other activities whose route geometry closely matches this one (a spatial `ST_HausdorffDistance` comparison of `route_geom`, backend-side), each linking to that activity's own detail page with its title, date, and distance. Hidden entirely when no other activity's route is a close enough match.
*   **Personal Record Badges:** When this activity's own longest distance, biggest elevation gain, or fastest 1km/5km/10km split ties its `activityType`'s current all-time best, an "X PR" badge appears under the header for each record it holds. Backed by the same fastest-1km/5km/10km-split precomputation used by the Stats page's Personal Records table (below).

## 4. Settings Page

*   **Re-analysis Controls:** Provides options to re-process GPX data:
    *   `Last Week`
    *   `Last Month`
    *   `Last Year`
    *   `All Time`
    *   Triggers a GraphQL mutation to initiate the re-analysis process.
    *   Displays progress or completion status.
*   **GPS Anomaly Cleanup List:** Lists activities with at least one GPS point flagged as an implausible speed jump (>55 m/s / ~200 km/h from the last non-flagged point) *and* where removing the flagged point(s) would move the track's total distance by more than 100m — a flagged jump that barely changes distance (e.g. a brief GPS wobble at a dead stop) isn't worth surfacing. Detection is opt-in and never runs automatically at ingest, so stats/`points_data` always reflect the raw source file until the user explicitly cleans an activity from its Activity Detail page (above). Each entry links straight there to review and decide.
*   **Elevation Spikes List:** Lists activities with at least one point (or short run of points) whose elevation jumps sharply off trend and back — a bad altitude reading, not a GPS teleport or real terrain — filtered to where the total correction exceeds 15m so trivial single-meter jitter isn't surfaced. Same opt-in, review-before-saving model as GPS Anomaly Cleanup; each entry links to the activity to preview and normalize.
*   **Suspected Lift Rides List:** Lists every activity with at least one detected lift segment (straight-line, roughly constant speed, steady climb — see Activity Detail Page above), with the segment count and total lift-attributed elevation gain for that activity. Purely informational — nothing is removed or recomputed; each entry links to the activity to see the flagged range on its elevation chart.
*   **New-Activity Notifications Toggle:** An opt-in checkbox ("Notify me when a new activity finishes ingesting") that, on enabling, requests browser Notification permission and then polls for the most-recently-ingested activity every 45 seconds while any tab is open, firing a `Notification` ("&lt;title&gt; ingested") the first time the most-recent activity changes. Foreground-only — no service-worker push, since that needs a server-side trigger this app doesn't have. Off by default; permission is never requested without this explicit opt-in.
*   **Export Data:** "Download JSON"/"Download CSV" buttons fetch every activity's summary/derived columns (distance, duration, elevation gain/loss, avg/moving/max speed, activity type, start/end time, notes, location name, personal-record bests) and download them client-side, for feeding into Python/Jupyter/a spreadsheet — analysis-portability, not disaster-recovery, so it deliberately excludes per-point GPS track data (see "Full Backup" below for that). Values are left in raw SI units (meters/seconds), not display-formatted, since the target is a script or notebook rather than a person reading the file directly.
*   **Full Backup:** A "Download Full Backup (.zip)" link in the same Export Data tab hits `GET /export/full` on the backend, which streams a `.zip` containing every raw source file (`.gpx`/`.igc`/`.skiz`) from `data/gpx/` plus a `db-export.json` with every `activities`/`activity_routes` row at full fidelity — including per-point GPS track data (`points_data`) and route geometry (as GeoJSON), unlike the summary-only export above. For off-site backup or migrating to a different host, not for feeding into analysis tools.

## 5. Stats Page

*   **Streak Tracker:** Two summary tiles at the top of the page — current consecutive-day streak of at-least-one-activity (alive if the most recent activity was today or yesterday, broken once a full day passes with none) and the longest such streak ever. Computed by the `activityStreak` query from `DISTINCT DATE(start_time)` values, with the consecutive-run logic done in the resolver rather than SQL.
*   **This-Year-vs-Last-Year Comparison:** A `summary-tile` row showing activity count, total distance, and total elevation gain for the current year to date (Jan 1 through today's month/day) against the same date range last year, each tile with a `+X%`/`-X%` delta colored green/red. Purely self-referential — no social/leaderboard element. Computed entirely in SQL by the `yearOverYearComparison` query using `FILTER` clauses against `start_time`, not by fetching rows into JS.
*   **Training Load (Acute:Chronic Ratio):** Three summary tiles showing acute load (total distance over the last 7 days), chronic load (total distance over the last 28 days, averaged to a weekly rate), and the acute:chronic ratio with a qualitative label — "ramping up" above 1.5, "detraining" below 0.8, "steady" otherwise — the standard injury-risk signal runners/cyclists use to gauge training ramp rate. Distance-based, not duration- or HR-based. Computed by the `trainingLoad` query using `FILTER` clauses against `start_time`; the ratio is `null` (not divided by zero) when chronic load is 0.
*   **Per-Activity-Type Breakdown:** A table of aggregate stats grouped by activity type — count, total/average distance, total/average duration, and average elevation gain — computed live from the database (all-time, unfiltered). A "Download CSV" button exports this table.
*   **Calendar Heatmap:** A GitHub-style contribution grid (one square per day, 7 rows × ~53 columns) showing activity frequency across a chosen year, to surface seasonal patterns (e.g. skiing only showing up in winter months). Square intensity reflects activity count that day; a type dropdown (default "All types") filters which activities are counted, and a year dropdown switches between years present in the data. Built client-side from a lightweight `activities(limit: 1000)` fetch (id/startTime/activityType only), no backend aggregation needed at this dataset size.
*   **Training Volume Trend Chart:** A `recharts` bar chart below the calendar heatmap showing total distance per month across the full activity history, answering "am I doing more or less than last month" rather than "which days." Its own type dropdown (default "All types") filters which activities are bucketed. Built client-side from the same `activities(limit: 1000)` fetch as the calendar heatmap (extended with `distanceMeters`), bucketed by month in JS — no backend aggregation needed at this dataset size.
*   **Stat Correlation Scatterplot:** A `recharts` scatter chart below the training volume chart for spotting ad-hoc patterns the fixed views above don't surface — X/Y dropdowns pick any two of distance, duration, elevation gain, avg speed (all unit-aware), time-of-day, or day-of-week, plotting one point per activity (default: distance vs. elevation gain). Time-of-day and day-of-week are computed client-side from `startTime`; the rest come from the same `activities(limit: 1000)` fetch used by the calendar heatmap/training volume chart (extended with `durationSeconds`/`totalElevationGain`/`avgSpeedMps`), with the same type-dropdown filter pattern.
*   **Personal Records:** A table, one row per `activityType`, showing longest distance, biggest elevation gain, and fastest 1km/5km/10km split (`MIN`/`MAX` aggregates computed backend-side over `activities`, including a `best_1km_seconds`/`best_5km_seconds`/`best_10km_seconds` sliding-window precomputation done once at ingest — see `docs/DATA_MODEL.md`). Missing splits (activity never covers that distance) show as `–`. The same data backs the PR badges on Activity Detail (above).

## 6. Heatmap Page

*   **Density Heatmap:** A nav tab (`/heatmap`) renders every activity's route coordinates as a single `leaflet.heat` density heatmap over a basemap, using the same CARTO-dark/OSM-light tile split (by theme) as the Activity Detail map. `leaflet.heat`'s canvas only tracks Leaflet's own `moveend`/`zoomanim` events out of the box, which touch pinch-zoom doesn't fire (it drives the map via repeated `move`/`zoom` events instead) — `HeatLayer` in `Heatmap.jsx` also re-runs the layer's reset on `move`/`zoom` so the overlay stays live during a pinch gesture instead of freezing until it ends.
*   **Smarter Initial View:** The map fits to a `recentActivityBounds(months: 6)` query's bounding box on load — an `ST_Extent` over `activity_routes.route_geom` for activities from the last 6 months — so the page opens already zoomed into wherever the user has actually been active lately, rather than fit to every point ever recorded. Falls back to fitting all points on record if there's no activity in that window.
*   **Elevation Banding:** A "Color by elevation" checkbox switches to 4 separate heat layers, one per elevation quartile of the dataset (computed from all loaded points), each rendered in a fixed single-color gradient with a swatch-and-range legend below the checkbox.
*   **Payload Sizing:** The backing `heatmapPoints` GraphQL query returns `[lat, lon, elevation]` triples for every activity at once (no pagination), but caps/samples each route at 300 points server-side so a personal-scale dataset (hundreds of activities) stays a few MB rather than tens of MB at full GPS resolution. Sampling is done in SQL (a `jsonb_array_elements`/modulo pass per route) rather than fetching every stored point and sampling in JS, so the DB->backend transfer stays proportional to the sampled output, not the full-resolution dataset.
*   **In-Memory Caching:** `heatmapPoints` is expensive to compute (still a multi-second full scan over every activity's points at this dataset size) and rarely changes, so the resolver caches the sampled result in memory for 5 minutes — repeat loads of `/heatmap` within that window are near-instant instead of recomputing every time. Staleness after a new activity is ingested (up to 5 minutes) is an accepted tradeoff for a personal, single-user app.

## 7. Units

*   **km/miles Toggle:** A nav-bar toggle switches all distance/speed/elevation display between metric (km, km/h, m) and imperial (mi, mph, ft), backend by a React context persisted to `localStorage`. Defaults to imperial.

## 8. Code Tab

*   **Embedded Editor:** A nav tab iframes a `code-server` (browser VS Code) instance bind-mounted read-write at the repo root, for making and committing changes to gpx-report from the same UI. Reachable only within the deployment's Tailscale network — see `CLAUDE.md` deployment notes.
*   **Theme sync:** Toggling the dashboard's light/dark mode also flips code-server's VS Code theme (`setCodeServerTheme` mutation writes `workbench.colorTheme` to its `settings.json`), and the iframe reloads to pick it up.

## 9. Record Page (In-App GPS Recording)

*   **Live Recording:** A nav tab (`/record`) records a track live via the browser Geolocation API (`navigator.geolocation.watchPosition()`) with Start/Pause/Resume/Stop controls, a live-updating map (route drawn as it's recorded, current-position marker), and live stats (duration, distance, current elevation, point count).
*   **Foreground-Only:** Recording only runs while the tab is open and the screen is on — there is no background/wake-lock GPS tracking (would need a native app or unreliable browser workarounds); the page states this limitation up front.
*   **Save Flow:** On Stop, the user names the activity and picks an activity type from the same preselected list used elsewhere, then Save builds a minimal GPX 1.1 document from the recorded points client-side and submits it via the `saveRecordedActivity` GraphQL mutation. The backend writes it to a server-generated filename (`recorded-<timestamp>-<random>.gpx`, never derived from client input) inside `GPX_FILES_DIRECTORY` and returns immediately — the existing directory watcher picks the file up and runs it through the normal ingestion pipeline (same `processFile()` path as a synced file), so recording doesn't add a second way to write activity rows into the database. The page polls briefly for the new activity to appear (to apply the chosen activity type and redirect to its detail page); if the watcher hasn't caught up yet, it tells the user the activity is still processing rather than blocking.

## 10. Data Management

*   **Self-Hosted:** All data is stored locally, ensuring user privacy and control.
*   **GPX File Synchronization:** GPX files mostly arrive via external sync (Syncthing) or manual drop into the monitored directory; the Record page (see above) is the one in-app way to create a new activity file, via the same directory-watch pipeline rather than a direct upload/file-management UI.

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

