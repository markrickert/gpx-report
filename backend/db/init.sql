-- Initial schema for gpx-report

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS activities (
  id                    SERIAL PRIMARY KEY,
  gpx_filename          VARCHAR(255) NOT NULL UNIQUE,
  title                 VARCHAR(255) NOT NULL,
  activity_type         VARCHAR(50) NOT NULL,
  start_time            TIMESTAMPTZ NOT NULL,
  end_time              TIMESTAMPTZ NOT NULL,
  duration_seconds      INTEGER NOT NULL,
  distance_meters       NUMERIC NOT NULL,
  avg_speed_mps         NUMERIC,
  moving_avg_speed_mps  NUMERIC,
  max_speed_mps         NUMERIC,
  total_elevation_gain  NUMERIC,
  total_elevation_loss  NUMERIC,
  -- total_elevation_gain minus the gain attributable to detected chairlift/
  -- uplift segments (track/liftDetection.js), computed once at ingest so
  -- "biggest elevation gain" records aren't dominated by lift climb rather
  -- than actual climbing/skiing effort. Equal to total_elevation_gain when
  -- no lift segments are detected.
  elevation_gain_excluding_lift_meters NUMERIC,
  -- Fastest-segment personal records: minimum time (seconds) to cover each
  -- target distance anywhere in the activity, computed once at ingest by
  -- track/personalRecords.js's sliding-window scan over points_data. Null
  -- when the activity never covers that much distance.
  best_1km_seconds      NUMERIC,
  best_5km_seconds      NUMERIC,
  best_10km_seconds     NUMERIC,
  -- Average/max heart rate (bpm) from Garmin's <gpxtpx:TrackPointExtension>
  -- per-point hr values (gpx/parser.js); null when the GPX has no HR data
  -- (most tracks, since they're GPS-only with no paired HR strap) or for
  -- non-GPX formats (IGC/.skiz don't carry this extension at all).
  avg_hr                NUMERIC,
  max_hr                NUMERIC,
  notes                 TEXT,
  -- Reverse-geocoded place name (city/town/village near the start point), via
  -- Nominatim on ingest; null if the lookup failed or hasn't run yet.
  location_name         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activities_start_time ON activities (start_time DESC);
CREATE INDEX IF NOT EXISTS idx_activities_activity_type ON activities (activity_type);

CREATE TABLE IF NOT EXISTS activity_routes (
  activity_id             INTEGER PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
  route_geom              GEOMETRY(LineString, 4326) NOT NULL,
  elevation_profile_data  JSONB,
  -- Full point list (lat/lon/elevation/timestamp) for map rendering; route_geom
  -- alone can't carry elevation/timestamp per-point via simple GeoJSON round-trip.
  points_data             JSONB
);

CREATE INDEX IF NOT EXISTS idx_activity_routes_geom ON activity_routes USING GIST (route_geom);
