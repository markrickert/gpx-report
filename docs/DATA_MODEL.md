# Data Model

This document defines the data structures for [Your Project Name], covering both the database schema and the GraphQL API schema.

## PostgreSQL Schema (Conceptual)

This schema assumes the use of the PostGIS extension for geospatial data.

### `activities` Table

Stores the primary information for each recorded activity.

| Column Name        | Data Type         | PostGIS Type | Constraints                                     | Description                                                 |
| :----------------- | :---------------- | :----------- | :---------------------------------------------- | :---------------------------------------------------------- |
| `id`               | `SERIAL`          |              | `PRIMARY KEY`                                   | Unique identifier for the activity.                         |
| `gpx_filename`     | `VARCHAR(255)`    |              | `NOT NULL`, `UNIQUE`                            | Original filename of the GPX file.                          |
| `activity_type`    | `VARCHAR(50)`     |              | `NOT NULL`                                      | Categorization (e.g., 'Running', 'Hiking', 'Skiing').       |
| `start_time`       | `TIMESTAMPTZ`     |              | `NOT NULL`                                      | Timestamp when the activity began.                          |
| `end_time`         | `TIMESTAMPTZ`     |              | `NOT NULL`                                      | Timestamp when the activity ended.                          |
| `duration_seconds` | `INTEGER`         |              | `NOT NULL`                                      | Total duration of the activity in seconds.                  |
| `distance_meters`  | `NUMERIC`         |              | `NOT NULL`                                      | Total distance covered in meters.                           |
| `avg_speed_mps`    | `NUMERIC`         |              | `NULLABLE`                                      | Average speed in meters per second.                         |
| `max_speed_mps`    | `NUMERIC`         |              | `NULLABLE`                                      | Maximum speed recorded in meters per second.                |
| `total_elevation_gain` | `NUMERIC`     |              | `NULLABLE`                                      | Total cumulative elevation gain in meters.                  |
| `total_elevation_loss` | `NUMERIC`     |              | `NULLABLE`                                      | Total cumulative elevation loss in meters.                  |
| `created_at`       | `TIMESTAMPTZ`     |              | `DEFAULT NOW()`                                 | Timestamp when the record was created in the database.      |
| `updated_at`       | `TIMESTAMPTZ`     |              | `DEFAULT NOW()`                                 | Timestamp when the record was last updated.                 |

### `activity_routes` Table

Stores the geospatial path of each activity.

| Column Name   | Data Type      | PostGIS Type | Constraints                                     | Description                                                      |
| :------------ | :------------- | :----------- | :---------------------------------------------- | :--------------------------------------------------------------- |
| `activity_id` | `INTEGER`      |              | `PRIMARY KEY`, `FOREIGN KEY REFERENCES activities(id)` | Links to the `activities` table.                                 |
| `route_geom`  | `GEOMETRY(LineString, 4326)` | `LINESTRING` | `NOT NULL`                                      | The route as a GeoJSON LineString (SRID 4326 for WGS84).         |
| `elevation_profile_data` | `JSONB` | | `NULLABLE` | JSON array of points for elevation graph: `[{"dist": 0, "elev": 10}, ...]` | This might be redundant if PostGIS can generate it, or useful for simpler charting. |

*(Note: `elevation_profile_data` could be generated dynamically from `route_geom` if PostGIS functions are leveraged, potentially simplifying the schema).*

### `activity_summary` (Materialized View or Table)

Pre-computed aggregates for quick dashboard loading. This would be updated by triggers or a scheduled job.

| Column Name        | Data Type   | Description                                         |
| :----------------- | :---------- | :-------------------------------------------------- |
| `total_activities` | `BIGINT`    | Total number of processed activities.               |
| `total_distance`   | `NUMERIC`   | Sum of all distances in meters.                     |
| `total_duration`   | `BIGINT`    | Sum of all durations in seconds.                    |
| `total_elevation_gain` | `NUMERIC` | Sum of all elevation gains in meters.               |
| `last_reanalysis`  | `TIMESTAMPTZ` | Timestamp of the last full data re-analysis.        |

### `aggregated_stats_by_type` (Materialized View or Table)

Pre-computed aggregates broken down by activity type.

| Column Name        | Data Type   | Description                                         |
| :----------------- | :---------- | :-------------------------------------------------- |
| `activity_type`    | `VARCHAR(50)` | The type of activity (e.g., 'Running').             |
| `count`            | `BIGINT`    | Number of activities of this type.                  |
| `total_distance`   | `NUMERIC`   | Sum of distances for this activity type.            |
| `total_duration`   | `BIGINT`    | Sum of durations for this activity type.            |
| `average_distance` | `NUMERIC`   | Average distance for this activity type.            |
| `average_duration` | `BIGINT`    | Average duration for this activity type.            |
| `average_elevation_gain` | `NUMERIC` | Average elevation gain for this activity type.      |

---

## GraphQL Schema (Conceptual)

This outlines the types, queries, and mutations for the GraphQL API.

### Scalar Types

*   `ID!`: Non-nullable unique identifier.
*   `String!`: Non-nullable string.
*   `Int!`: Non-nullable integer.
*   `Float!`: Non-nullable floating-point number.
*   `Boolean!`: Non-nullable boolean.
*   `DateTime!`: Non-nullable timestamp (e.g., ISO 8601 format).
*   `Json!`: Non-nullable JSON type.

### Types

\`\`\`graphql
type Activity {
  id: ID!
  gpxFilename: String!
  activityType: String!
  startTime: DateTime!
  endTime: DateTime!
  durationSeconds: Int!
  distanceMeters: Float!
  avgSpeedMps: Float
  maxSpeedMps: Float
  totalElevationGain: Float
  totalElevationLoss: Float
  route: Route! # Represents the route data for map and elevation chart
}

type Route {
  coordinates: Json! # JSON array of points: [{"lat": float, "lon": float, "elevation": float, "timestamp": Int}]
  elevationProfile: Json! # JSON array for chart: [{"distanceMeters": float, "elevation": float}]
}

type ActivitySummary {
  totalActivities: Int!
  totalDistanceMeters: Float!
  totalDurationSeconds: Int!
  totalElevationGainMeters: Float
  lastReanalysis: DateTime
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
\`\`\`

### Queries

\`\`\`graphql
type Query {
  # Fetch a single activity by its ID
  activity(id: ID!): Activity

  # Fetch a list of activities, with filtering and sorting
  activities(
    limit: Int = 20 # Default limit
    offset: Int = 0
    activityType: String
    startDate: DateTime
    endDate: DateTime
  ): [Activity!]! # Returns a list of activities, always sorted reverse-chronologically

  # Fetch overall summary statistics
  activitySummary: ActivitySummary!

  # Fetch aggregated statistics broken down by activity type
  aggregatedStatsByType(
    activityType: String
    startDate: DateTime
    endDate: DateTime
  ): [AggregatedStatsByType!]!
}
\`\`\`

### Mutations

\`\`\`graphql
type Mutation {
  # Triggers re-analysis of all GPX files and updates the database
  reanalyzeAllActivities: ReanalysisStatus!

  # Triggers re-analysis for a specific date range
  reanalyzeActivitiesByDateRange(
    startDate: DateTime!
    endDate: DateTime!
  ): ReanalysisStatus!
}
\`\`\`

*(Note: The `reanalyzeActivitiesByDateRange` mutation is added based on your requirement for "last week, month, year" options on the settings page).*

