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
  max_speed_mps         NUMERIC,
  total_elevation_gain  NUMERIC,
  total_elevation_loss  NUMERIC,
  notes                 TEXT,
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
