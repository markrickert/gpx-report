-- Initial schema for gpx-report

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS activities (
  id                    SERIAL PRIMARY KEY,
  gpx_filename          VARCHAR(255) NOT NULL UNIQUE,
  -- Person who recorded it: the first folder segment of gpx_filename
  -- (GPX_FILES_DIRECTORY/<person>/...), or DEFAULT_PERSON for top-level
  -- files. Derived on every ingest, like every other column here.
  owner                 VARCHAR(64) NOT NULL DEFAULT 'mark',
  title                 VARCHAR(255) NOT NULL,
  activity_type         VARCHAR(50) NOT NULL,
  start_time            TIMESTAMPTZ NOT NULL,
  end_time              TIMESTAMPTZ NOT NULL,
  duration_seconds      INTEGER NOT NULL,
  distance_meters       NUMERIC NOT NULL,
  avg_speed_mps         NUMERIC,
  moving_avg_speed_mps  NUMERIC,
  max_speed_mps         NUMERIC,
  -- distance_meters and the two elevation totals leave out detected chairlift/
  -- uplift rides (track/liftDetection.ts), so no list, stat, or record counts
  -- a ride as the person's own travel.
  total_elevation_gain  NUMERIC,
  total_elevation_loss  NUMERIC,
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
CREATE INDEX IF NOT EXISTS idx_activities_owner ON activities (owner);

-- Opt-in "did this with..." sharing: a shared activity counts for `person`
-- exactly like their own. Keyed by gpx_filename rather than activity id so
-- it survives re-analysis. NOT derived data — it isn't recoverable from the
-- GPX files, so wiping the volume loses it (it's included in /export/full).
CREATE TABLE IF NOT EXISTS activity_shares (
  gpx_filename  VARCHAR(255) NOT NULL,
  person        VARCHAR(64) NOT NULL,
  PRIMARY KEY (gpx_filename, person)
);

CREATE INDEX IF NOT EXISTS idx_activity_shares_person ON activity_shares (person);

CREATE TABLE IF NOT EXISTS activity_routes (
  activity_id             INTEGER PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
  route_geom              GEOMETRY(LineString, 4326) NOT NULL,
  elevation_profile_data  JSONB,
  -- Full point list (lat/lon/elevation/timestamp) for map rendering; route_geom
  -- alone can't carry elevation/timestamp per-point via simple GeoJSON round-trip.
  points_data             JSONB
);

CREATE INDEX IF NOT EXISTS idx_activity_routes_geom ON activity_routes USING GIST (route_geom);

-- Single-row settings for the Immich media gallery integration (see
-- backend/src/immich/). immich_api_key is write-only from the frontend's
-- perspective — never echoed back over GraphQL, see
-- graphql/resolvers.ts's immichSettings query.
CREATE TABLE IF NOT EXISTS immich_settings (
  id                INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  immich_base_url   TEXT,
  immich_api_key    TEXT
);

-- One row per Immich photo/video matched to an activity's time window
-- (backend/src/immich/scan.ts). lat/lon are the asset's own EXIF GPS,
-- nullable since not every photo/video carries location data.
CREATE TABLE IF NOT EXISTS activity_media (
  id                  SERIAL PRIMARY KEY,
  activity_id         INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  immich_asset_id     TEXT NOT NULL,
  asset_type          VARCHAR(10) NOT NULL,
  taken_at            TIMESTAMPTZ NOT NULL,
  lat                 NUMERIC,
  lon                 NUMERIC,
  duration_seconds    NUMERIC,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (activity_id, immich_asset_id)
);

CREATE INDEX IF NOT EXISTS idx_activity_media_activity_id ON activity_media (activity_id);
