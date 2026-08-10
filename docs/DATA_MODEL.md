# Data Model

This document defines the data structures for gpx-report, covering both the database schema and the GraphQL API schema. Both sections describe what is actually implemented — see `backend/db/init.sql` and `backend/src/graphql/typeDefs.ts` for the source of truth.

## PostgreSQL Schema

Uses the PostGIS extension for geospatial data.

### `activities` Table

Stores the primary information for each recorded activity, one row per source file (GPX, IGC, or Ski Tracks `.skiz`).

| Column Name        | Data Type         | Constraints                                     | Description                                                 |
| :----------------- | :---------------- | :----------------------------------------------- | :---------------------------------------------------------- |
| `id`               | `SERIAL`          | `PRIMARY KEY`                                   | Unique identifier for the activity.                         |
| `gpx_filename`     | `VARCHAR(255)`    | `NOT NULL`, `UNIQUE`                            | Original filename of the source file (`.gpx`, `.igc`, or `.skiz`, despite the column name). Upsert key for re-analysis. |
| `title`            | `VARCHAR(255)`    | `NOT NULL`                                      | Track/metadata name from the GPX file, falling back to the filename stem; always the filename stem for IGC. For `.skiz`, from `Track.xml`'s `name` attribute, else the filename stem. |
| `activity_type`    | `VARCHAR(50)`     | `NOT NULL`                                      | From the GPX `<trk><type>` tag (mapped to a display label) or guessed from the filename; `'Unknown'` if neither yields a match. Fixed to `'Paragliding'` for IGC files. For `.skiz`, from `Track.xml`'s `activity` attribute, defaulting to `'Skiing'`. |
| `start_time`       | `TIMESTAMPTZ`     | `NOT NULL`                                      | Timestamp of the first track point.                         |
| `end_time`         | `TIMESTAMPTZ`     | `NOT NULL`                                      | Timestamp of the last track point.                          |
| `duration_seconds` | `INTEGER`         | `NOT NULL`                                      | `end_time - start_time`, in seconds.                         |
| `distance_meters`  | `NUMERIC`         | `NOT NULL`                                      | Total distance covered in meters.                            |
| `avg_speed_mps`    | `NUMERIC`         | `NULLABLE`                                      | Average speed in meters per second, `distance_meters / duration_seconds` — includes stopped time (traffic lights, breaks, photo stops). |
| `moving_avg_speed_mps` | `NUMERIC`     | `NULLABLE`                                      | Average speed in meters per second over only the point-to-point segments at or above a 0.3 m/s "moving" threshold, excluding stopped time. |
| `max_speed_mps`    | `NUMERIC`         | `NULLABLE`                                      | Maximum speed recorded in meters per second (derived point-to-point). |
| `total_elevation_gain` | `NUMERIC`     | `NULLABLE`                                      | Total cumulative elevation gain in meters, computed from a smoothed elevation series (see below), not raw point-to-point deltas. |
| `total_elevation_loss` | `NUMERIC`     | `NULLABLE`                                      | Total cumulative elevation loss in meters, computed from a smoothed elevation series (see below), not raw point-to-point deltas. |
| `location_name`    | `TEXT`            | `NULLABLE`                                      | Reverse-geocoded place name (city/town/village/suburb) nearest the activity's start point, via Nominatim; `NULL` if the lookup hasn't run yet or failed. |
| `best_1km_seconds` | `NUMERIC`         | `NULLABLE`                                      | Fastest time in seconds to cover 1km anywhere in the track (sliding-window scan, see below); `NULL` if the activity never covers 1km. |
| `best_5km_seconds` | `NUMERIC`         | `NULLABLE`                                      | Same as above, for 5km.                                      |
| `best_10km_seconds` | `NUMERIC`        | `NULLABLE`                                      | Same as above, for 10km.                                     |
| `created_at`       | `TIMESTAMPTZ`     | `NOT NULL DEFAULT NOW()`                        | When the record was first created.                          |
| `updated_at`       | `TIMESTAMPTZ`     | `NOT NULL DEFAULT NOW()`                        | When the record was last (re-)processed.                    |

Indexed on `start_time DESC` and `activity_type`.

`total_elevation_gain`/`total_elevation_loss` are derived by `backend/src/track/elevation.ts`'s `computeElevationGainLoss()`: a centered 5-point moving average smooths the per-point elevation series (falling back to raw deltas when a track has 5 points or fewer, since the window would otherwise flatten the whole thing), then positive/negative deltas between consecutive smoothed values are summed. This only affects the two summary columns — `points_data`/`elevation_profile_data` (below) always store raw, unsmoothed elevation.

`best_1km_seconds`/`best_5km_seconds`/`best_10km_seconds` are derived by `backend/src/track/personalRecords.ts`'s `computeBestEfforts()`: an O(n) two-pointer sliding window over each point's cumulative distance/timestamp finds, for each target distance, the tightest (smallest-time) window that covers it anywhere in the track. Computed once at ingest by `gpx/processor.js`, not live per-query.

### `activity_routes` Table

Stores the geospatial path of each activity, one row per activity.

| Column Name   | Data Type      | Constraints                                     | Description                                                      |
| :------------ | :------------- | :----------------------------------------------- | :--------------------------------------------------------------- |
| `activity_id` | `INTEGER`      | `PRIMARY KEY`, `FOREIGN KEY REFERENCES activities(id) ON DELETE CASCADE` | Links to the `activities` table.                                 |
| `route_geom`  | `GEOMETRY(LineString, 4326)` | `NOT NULL`                        | The route as a PostGIS LineString (SRID 4326 / WGS84), GiST-indexed. Queried geospatially by `Activity.similarActivities` (`ST_HausdorffDistance` between `ST_Simplify`'d routes) to find past activities on the same route. |
| `elevation_profile_data` | `JSONB` | `NULLABLE`                              | JSON array for the elevation chart: `[{"distanceMeters": 0, "elevation": 10, "speedMps": null}, ...]`. `speedMps` is the point-to-point speed arriving at that point (`null` for the first point or when either point lacks a timestamp). |
| `points_data` | `JSONB`        | `NULLABLE`                                      | Full point list used directly by the frontend map: `[{"lat", "lon", "elevation", "timestamp"}, ...]`. Kept redundant with `route_geom` because GeoJSON round-tripping loses per-point elevation/timestamp. |

There is no `activity_summary` or `aggregated_stats_by_type` table. Both are computed live by the GraphQL resolvers with `SUM`/`AVG`/`GROUP BY` queries against `activities` — see `activitySummary` and `aggregatedStatsByType` below.

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

```graphql
type Query {
  activity(id: ID!): Activity

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
  deleteActivity(id: ID!): Boolean!
}
```
