# Data Model

This document defines the data structures for gpx-report, covering both the database schema and the GraphQL API schema. Both sections describe what is actually implemented — see `backend/db/init.sql` and `backend/src/graphql/typeDefs.ts` for the source of truth.

## PostgreSQL Schema

Uses the PostGIS extension for geospatial data.

### `activities` Table

Stores the primary information for each recorded activity, one row per source file (GPX, IGC, or Ski Tracks `.skiz`).

| Column Name        | Data Type         | Constraints                                     | Description                                                 |
| :----------------- | :---------------- | :----------------------------------------------- | :---------------------------------------------------------- |
| `id`               | `SERIAL`          | `PRIMARY KEY`                                   | Unique identifier for the activity.                         |
| `gpx_filename`     | `VARCHAR(255)`    | `NOT NULL`, `UNIQUE`                            | Path of the source file (`.gpx`, `.igc`, or `.skiz`, despite the column name) relative to `GPX_FILES_DIRECTORY` — a bare filename for top-level files, `<person>/<file>` for a person's folder. Upsert key for re-analysis. |
| `owner`            | `VARCHAR(64)`     | `NOT NULL DEFAULT 'mark'`                       | Person who recorded it: the first folder segment of `gpx_filename`, or `DEFAULT_PERSON` for top-level files. Derived on every ingest. |
| `title`            | `VARCHAR(255)`    | `NOT NULL`                                      | Track/metadata name from the GPX file, falling back to the filename stem; always the filename stem for IGC. For `.skiz`, from `Track.xml`'s `name` attribute, else the filename stem. |
| `activity_type`    | `VARCHAR(50)`     | `NOT NULL`                                      | From the GPX `<trk><type>` tag (mapped to a display label) or guessed from the filename; `'Unknown'` if neither yields a match. Fixed to `'Paragliding'` for IGC files. For `.skiz`, from `Track.xml`'s `activity` attribute, defaulting to `'Skiing'`. |
| `start_time`       | `TIMESTAMPTZ`     | `NOT NULL`                                      | Timestamp of the first track point.                         |
| `end_time`         | `TIMESTAMPTZ`     | `NOT NULL`                                      | Timestamp of the last track point.                          |
| `duration_seconds` | `INTEGER`         | `NOT NULL`                                      | `end_time - start_time`, in seconds.                         |
| `distance_meters`  | `NUMERIC`         | `NOT NULL`                                      | Total distance covered in meters, leaving out detected lift rides. |
| `avg_speed_mps`    | `NUMERIC`         | `NULLABLE`                                      | Average speed in meters per second, `distance_meters / duration_seconds` — includes stopped time (traffic lights, breaks, photo stops). |
| `moving_avg_speed_mps` | `NUMERIC`     | `NULLABLE`                                      | Average speed in meters per second over only the point-to-point segments at or above a 0.3 m/s "moving" threshold, excluding stopped time. |
| `max_speed_mps`    | `NUMERIC`         | `NULLABLE`                                      | Maximum speed recorded in meters per second (derived point-to-point). |
| `total_elevation_gain` | `NUMERIC`     | `NULLABLE`                                      | Total cumulative elevation gain in meters, computed from a smoothed elevation series (see below), not raw point-to-point deltas. |
| `total_elevation_loss` | `NUMERIC`     | `NULLABLE`                                      | Total cumulative elevation loss in meters, computed from a smoothed elevation series (see below), not raw point-to-point deltas. |
| `location_name`    | `TEXT`            | `NULLABLE`                                      | Reverse-geocoded place name (city/town/village/suburb) nearest the activity's start point, via Nominatim; `NULL` if the lookup hasn't run yet or failed. |
| `best_1km_seconds` | `NUMERIC`         | `NULLABLE`                                      | Fastest time in seconds to cover 1km anywhere in the track (sliding-window scan, see below); `NULL` if the activity never covers 1km. |
| `best_5km_seconds` | `NUMERIC`         | `NULLABLE`                                      | Same as above, for 5km.                                      |
| `best_10km_seconds` | `NUMERIC`        | `NULLABLE`                                      | Same as above, for 10km.                                     |
| `avg_hr`           | `NUMERIC`         | `NULLABLE`                                      | Average heart rate in bpm, from GPX `<gpxtpx:TrackPointExtension><gpxtpx:hr>` values; `NULL` when the source has no HR data (most activities — GPS-only, no paired HR strap) or isn't GPX. |
| `max_hr`           | `NUMERIC`         | `NULLABLE`                                      | Maximum heart rate in bpm, same source as `avg_hr`.           |
| `created_at`       | `TIMESTAMPTZ`     | `NOT NULL DEFAULT NOW()`                        | When the record was first created.                          |
| `updated_at`       | `TIMESTAMPTZ`     | `NOT NULL DEFAULT NOW()`                        | When the record was last (re-)processed.                    |

Indexed on `start_time DESC`, `activity_type`, and `owner`.

`total_elevation_gain`/`total_elevation_loss` are derived by `backend/src/track/elevation.ts`'s `computeElevationGainLoss()`: a centered 5-point moving average smooths the per-point elevation series (falling back to raw deltas when a track has 5 points or fewer, since the window would otherwise flatten the whole thing), then positive/negative deltas between consecutive smoothed values are summed. This only affects the two summary columns — `points_data`/`elevation_profile_data` (below) always store raw, unsmoothed elevation. Ingestion then subtracts the distance, climb, and descent of detected lift rides (`backend/src/track/liftDetection.ts`'s `totalsExcludingLifts()`) from `distance_meters`, `total_elevation_gain`, and `total_elevation_loss`; the points themselves keep the ride.

`best_1km_seconds`/`best_5km_seconds`/`best_10km_seconds` are derived by `backend/src/track/personalRecords.ts`'s `computeBestEfforts()`: an O(n) two-pointer sliding window over each point's cumulative distance/timestamp finds, for each target distance, the tightest (smallest-time) window that covers it anywhere in the track. Computed once at ingest by `gpx/processor.js`, not live per-query.

### `activity_routes` Table

Stores the geospatial path of each activity, one row per activity.

| Column Name   | Data Type      | Constraints                                     | Description                                                      |
| :------------ | :------------- | :----------------------------------------------- | :--------------------------------------------------------------- |
| `activity_id` | `INTEGER`      | `PRIMARY KEY`, `FOREIGN KEY REFERENCES activities(id) ON DELETE CASCADE` | Links to the `activities` table.                                 |
| `route_geom`  | `GEOMETRY(LineString, 4326)` | `NOT NULL`                        | The route as a PostGIS LineString (SRID 4326 / WGS84), GiST-indexed. Queried geospatially by `Activity.similarActivities` (`ST_HausdorffDistance` between `ST_Simplify`'d routes) to find past activities on the same route. |
| `elevation_profile_data` | `JSONB` | `NULLABLE`                              | JSON array for the elevation chart: `[{"distanceMeters": 0, "elevation": 10, "speedMps": null, "hr": null, "cad": null, "atemp": null}, ...]`. `speedMps` is the point-to-point speed arriving at that point (`null` for the first point or when either point lacks a timestamp). `hr`/`cad`/`atemp` (heart rate bpm, cadence rpm, ambient temperature °C) come from GPX's `<gpxtpx:TrackPointExtension>` and are `null` for the vast majority of activities (GPS-only, no paired sensor) and always `null` for IGC/`.skiz`. |
| `points_data` | `JSONB`        | `NULLABLE`                                      | Full point list used directly by the frontend map: `[{"lat", "lon", "elevation", "timestamp", "hr", "cad", "atemp"}, ...]`. Kept redundant with `route_geom` because GeoJSON round-tripping loses per-point elevation/timestamp. `hr`/`cad`/`atemp` are the same GPX extension fields as `elevation_profile_data` above, index-aligned with it. |

There is no `activity_summary` or `aggregated_stats_by_type` table. Both are computed live by the GraphQL resolvers with `SUM`/`AVG`/`GROUP BY` queries against `activities` — see `activitySummary` and `aggregatedStatsByType` below.

### `activity_shares` Table

Opt-in "did this with…" sharing. A shared activity counts for `person` exactly like their own (lists, totals, PRs, streaks, heatmap). Keyed by `gpx_filename` rather than activity id so it survives re-analysis. **Not derived data** — it can't be regenerated from the files, so it's included in `GET /export/full` (`activity-shares.json`) and a volume wipe loses it.

| Column Name    | Data Type      | Constraints                          | Description                                    |
| :------------- | :------------- | :----------------------------------- | :--------------------------------------------- |
| `gpx_filename` | `VARCHAR(255)` | `NOT NULL`, part of `PRIMARY KEY`    | The shared activity's `activities.gpx_filename`. |
| `person`       | `VARCHAR(64)`  | `NOT NULL`, part of `PRIMARY KEY`    | Who it's shared with. Indexed.                  |

### `trips` and `trip_participants` Tables

A trip someone is training for. Every activity a participant can see between `start_date` and `end_date` (both inclusive, in the database's timezone) counts toward `goal_meters` as equivalent hiking distance (`backend/src/trips/effort.ts`). Progress is computed on read and never stored, so a late file, a retyped activity, or a tuned factor changes past trips too. **Not derived data** — included in `GET /export/full` (`trips.json`), and a volume wipe loses it.

| Table               | Column Name   | Data Type      | Constraints                                   | Description                                |
| :------------------ | :------------ | :------------- | :-------------------------------------------- | :----------------------------------------- |
| `trips`             | `id`          | `SERIAL`       | `PRIMARY KEY`                                 |                                            |
| `trips`             | `name`        | `VARCHAR(255)` | `NOT NULL`                                    | Name of the trip.                          |
| `trips`             | `start_date`  | `DATE`         | `NOT NULL`                                    | First day that counts.                     |
| `trips`             | `end_date`    | `DATE`         | `NOT NULL`                                    | Training end date; last day that counts.   |
| `trips`             | `goal_meters` | `NUMERIC`      | `NOT NULL`                                    | Cumulative equivalent hiking distance.     |
| `trips`             | `counts_elevation` | `BOOLEAN` | `NOT NULL DEFAULT TRUE`                  | False: activities count without the climbing credit. |
| `trips`             | `weekly_targets_meters` | `JSONB` |                                       | Optional plan: one target per week from `start_date`, the last week running through `end_date`. `goal_meters` is then their sum. |
| `trips`             | `created_at`  | `TIMESTAMPTZ`  | `NOT NULL DEFAULT NOW()`                      |                                            |
| `trip_participants` | `trip_id`     | `INTEGER`      | `REFERENCES trips(id) ON DELETE CASCADE`, PK  |                                            |
| `trip_participants` | `person`      | `VARCHAR(64)`  | `NOT NULL`, PK                                | Someone training for the trip. Indexed.    |

### `immich_settings` Table

Single-row table (`id` always `1`) holding the optional Immich media integration's connection info. See `backend/src/immich/`.

| Column Name       | Data Type | Constraints                        | Description                                                          |
| :---------------- | :-------- | :---------------------------------- | :--------------------------------------------------------------------- |
| `id`               | `INTEGER` | `PRIMARY KEY DEFAULT 1 CHECK (id = 1)` | Always `1` — enforces a single row.                                  |
| `immich_base_url`  | `TEXT`    | `NULLABLE`                          | Base URL of the user's private Immich instance.                       |
| `immich_api_key`   | `TEXT`    | `NULLABLE`                          | Immich API key. Never returned over GraphQL — `immichSettings` only exposes whether it's set (`configured: Boolean!`), not the value. |

### `activity_media` Table

One row per Immich photo/video matched to an activity's time window by `backend/src/immich/scan.ts`.

| Column Name        | Data Type       | Constraints                                                      | Description                                                        |
| :------------------ | :-------------- | :----------------------------------------------------------------- | :--------------------------------------------------------------------- |
| `id`                | `SERIAL`        | `PRIMARY KEY`                                                     | Unique identifier for the match.                                    |
| `activity_id`       | `INTEGER`       | `NOT NULL`, `FOREIGN KEY REFERENCES activities(id) ON DELETE CASCADE` | Links to the matched activity.                                      |
| `immich_asset_id`   | `TEXT`          | `NOT NULL`                                                        | The asset's id in Immich.                                           |
| `asset_type`        | `VARCHAR(10)`   | `NOT NULL`                                                        | `"IMAGE"` or `"VIDEO"`.                                              |
| `taken_at`          | `TIMESTAMPTZ`   | `NOT NULL`                                                        | The asset's capture timestamp, from Immich's metadata.               |
| `lat`/`lon`         | `NUMERIC`       | `NULLABLE`                                                        | The asset's own EXIF GPS, when present.                             |
| `duration_seconds`  | `NUMERIC`       | `NULLABLE`                                                        | Video length, when Immich reports one; always `NULL` for images.     |
| `created_at`        | `TIMESTAMPTZ`   | `NOT NULL DEFAULT NOW()`                                          | When the match was recorded.                                        |

Unique on `(activity_id, immich_asset_id)`; indexed on `activity_id`. Matching logic (time-window overlap + geo tiebreak for same-day overlapping activities) is pure and unit-tested in `backend/src/immich/match.ts`.

---

## GraphQL Schema

This mirrors `backend/src/graphql/typeDefs.ts`.

### Scalars

*   Standard `ID!`, `String!`, `Int!`, `Float!`, `Boolean!`.
*   `DateTime` — custom scalar (`backend/src/graphql/scalars.ts`), ISO 8601.
*   `JSON` — custom scalar for the free-form route/elevation payloads.

### Types

```graphql
type Activity {
  id: ID!
  gpxFilename: String!
  owner: String!
  sharedWith: [String!]! # people this activity is shared with (activity_shares)
  title: String!
  activityType: String!
  startTime: DateTime!
  endTime: DateTime!
  durationSeconds: Int!
  distanceMeters: Float!
  avgSpeedMps: Float
  movingAvgSpeedMps: Float
  maxSpeedMps: Float
  totalElevationGain: Float
  totalElevationLoss: Float
  avgHr: Float # bpm, from GPX heart-rate extension data; null when the source has none
  maxHr: Float # bpm, same source as avgHr
  locationName: String
  route: Route!
  suggestedActivityTypes: [String!]! # heuristic-ranked candidate types, computed live from avg/max speed + elevation gain/loss per km — see track/suggestType.js
}

type Route {
  coordinates: JSON! # [{lat, lon, elevation, timestamp}, ...] — from activity_routes.points_data
  elevationProfile: JSON! # [{distanceMeters, elevation, speedMps}, ...] — from activity_routes.elevation_profile_data
}

type ActivitySummary {
  totalActivities: Int!
  totalDistanceMeters: Float!
  totalDurationSeconds: Int!
  totalElevationGainMeters: Float
  lastReanalysis: DateTime # MAX(updated_at) across all activities
}

type AggregatedStatsByType {
  activityType: String!
  count: Int!
  totalDistanceMeters: Float!
  totalDurationSeconds: Int!
  averageDistanceMeters: Float!
  averageDurationSeconds: Int!
  averageElevationGainMeters: Float
}

type ReanalysisStatus {
  message: String!
  success: Boolean!
}
```

### Queries

Every query that reads activities is scoped to the requesting person (the `X-GPX-Person` header): their own activities plus ones shared with them. `activity(id)` returns null for one they can't see.

```graphql
type Query {
  activity(id: ID!): Activity

  people: [String!]! # DEFAULT_PERSON plus every GPX_FILES_DIRECTORY subfolder

  activities(
    limit: Int = 20
    offset: Int = 0
    activityType: String
    startDate: DateTime
    endDate: DateTime
  ): [Activity!]! # sorted reverse-chronologically; the Dashboard paginates through this
                   # with limit: 50 and an increasing offset, loading further pages via
                   # infinite scroll (IntersectionObserver on a sentinel element).

  activitySummary: ActivitySummary!

  aggregatedStatsByType(
    activityType: String
    startDate: DateTime
    endDate: DateTime
  ): [AggregatedStatsByType!]! # powers the /stats page's per-activity-type breakdown
                                # table; called unfiltered (no activityType/date range)
                                # for an all-time view.
}
```

### Trips

```graphql
type Trip {
  id: ID!
  name: String!
  startDate: String! # YYYY-MM-DD, inclusive
  endDate: String!   # YYYY-MM-DD, inclusive
  goalMeters: Float!
  countsElevation: Boolean!     # false: no climbing credit on this trip
  weeklyTargetsMeters: [Float!] # the weekly plan, or null
  participants: [TripParticipant!]! # each person's total, from what THAT person can see
  myActivities: [TripActivity!]!    # the requester's own activities in the window, oldest first
}
type TripParticipant { person: String!  equivalentMeters: Float! }
type TripActivity {
  id: ID!  title: String!  activityType: String!  startTime: DateTime!
  distanceMeters: Float!  totalElevationGain: Float
  factor: Float!  equivalentMeters: Float!
}
type EffortFactor { activityType: String!  factor: Float!  countsElevation: Boolean! }
input TripInput { name: String!  startDate: String!  endDate: String!  goalMeters: Float!  participants: [String!]! }
```

- `Query.trips` lists the trips the requester is on, soonest end date first. `Query.trip(id)` returns null for a trip they aren't on.
- `Query.effortFactors` returns the conversion table, so the page can show how the number is made.
- `Mutation.saveTrip(id: ID, input: TripInput!)` creates a trip (no `id`; the requester is always added) or replaces one the requester is on. `Mutation.deleteTrip(id)` needs the same. Any participant can change anything, including the participants; each must be in `people`.
- `Mutation.addManualActivity(input: ManualActivityInput!, clientId)` writes `<person>/manual-<id>.manual.json` (`title`, `activityType`, `startTime`, `distanceMeters`, optional `durationSeconds`, `elevationGainMeters`, `notes`) and ingests it; a repeated `clientId` returns the first save. `Mutation.updateManualActivity(id, input)` rewrites every field for the owner. `Activity.isManual` is true for these. They have no `activity_routes` row, a `duration_seconds` of 0 when none was given, and are left out of `personalRecordsByType`.
- `TripInput` also takes `countsElevation` (default true) and `weeklyTargetsMeters`. A plan needs exactly `tripWeekCount(startDate, endDate)` targets (`backend/src/trips/weeks.ts`: whole weeks from the start date, leftover days folded into the last week), and the goal becomes their sum.
- Other participants only ever see a total. The activities behind it stay under the normal visibility rule.

### Immich media gallery types

```graphql
type ActivityMedia {
  id: ID!
  immichAssetId: String!
  assetType: String! # "IMAGE" or "VIDEO"
  takenAt: DateTime!
  lat: Float
  lon: Float
  durationSeconds: Float
}

type ImmichSettings {
  immichBaseUrl: String
  configured: Boolean! # true once a base URL + API key are both set; the key itself is never returned
}

type ImmichScanResult {
  scannedActivities: Int!
  matchedAssets: Int!
}
```

`Activity.mediaCount: Int!` and `Activity.media: [ActivityMedia!]!` expose the matched media per activity. `Query.immichSettings: ImmichSettings!`, `Mutation.updateImmichSettings(immichBaseUrl: String!, immichApiKey: String): Boolean!` (write-only key — omit to keep the existing one), and `Mutation.scanActivityMedia(activityIds: [ID!]): ImmichScanResult!` (omit `activityIds` to scan every activity) round out the integration. See `backend/src/immich/`.

### Mutations

```graphql
type Mutation {
  reanalyzeAllActivities: ReanalysisStatus!

  # Re-processes GPX files for activities already in the DB whose start_time
  # falls in range — it does not pick up brand-new files in that window that
  # haven't been ingested at all (the watcher handles those on its own).
  reanalyzeActivitiesByDateRange(
    startDate: DateTime!
    endDate: DateTime!
  ): ReanalysisStatus!

  # Rewrites the <trk><name> element (gpx/writer.js) or Track.xml's name
  # attribute (skiz/writer.js) in the source file and re-runs processFile()
  # so the DB row and file stay in sync. .gpx and .skiz activities support
  # this; .igc has no writer path and the mutation rejects it.
  updateActivityTitle(id: ID!, title: String!): Activity!

  # Same approach, targeting <trk><type> (gpx) or Track.xml's activity
  # attribute (skiz). For .gpx, activityType is a label (e.g. "Mountain
  # Biking") the resolver converts to the raw <type> value (e.g.
  # "mountain_biking") that parser.js's resolveActivityType() maps back to
  # that same label, via activityTypeToRawType() in gpx/parser.js. For
  # .skiz, the label is written as-is; skiz/parser.js's resolveActivityType()
  # title-cases it back on read. .igc has no writer path and the mutation
  # rejects it.
  updateActivityType(id: ID!, activityType: String!): Activity!

  # Looks up gpx_filename from the DB row itself (never accepts a path from
  # the client), deletes that exact file under GPX_FILES_DIRECTORY (a missing
  # file is tolerated, not an error), then deletes the activities row.
  # activity_routes cascades via its activity_id FK's ON DELETE CASCADE.
  # Permanent — the source file is gone, so the watcher can't re-ingest it.
  # Owner only; from a share recipient it removes just their share instead.
  deleteActivity(id: ID!): Boolean!

  # Owner only. Replaces the full set of people the activity is shared with;
  # each must be in `people` and can't be the owner.
  setActivitySharedWith(id: ID!, people: [String!]!): Activity!
}

All edit mutations (title, notes, type, trim, outlier clean, elevation fix) require the requesting person to be the activity's owner.
```
