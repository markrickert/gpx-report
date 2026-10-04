import path from "node:path";
import os from "node:os";
import { constants } from "node:fs";
import { writeFile, mkdir, copyFile, rm, unlink, readFile, mkdtemp } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { pool } from "../db.js";
import { backupFile, findOriginalBackup, sameTrackPoints } from "../backup.js";
import {
  reanalyzeAll,
  reanalyzeByDateRange,
  processFile,
  parseActivityFile,
} from "../gpx/processor.js";
import {
  updateGpxTitle,
  updateGpxType,
  trimGpxTrack,
  removeGpxTrackPoints,
  fixGpxElevations,
} from "../gpx/writer.js";
import {
  updateSkizTitle,
  updateSkizType,
  trimSkizTrack,
  removeSkizTrackPoints,
  fixSkizElevations,
} from "../skiz/writer.js";
import { removeIgcTrackPoints, fixIgcElevations } from "../igc/writer.js";
import { activityTypeToRawType } from "../gpx/parser.js";
import { detectOutliers } from "../track/outliers.js";
import { detectLiftSegments, totalsExcludingLifts } from "../track/liftDetection.js";
import { detectElevationSpikes, correctElevationSpikes } from "../track/elevationSpikes.js";
import { haversineMeters, computeTrackStats } from "../track/geo.js";
import { computeElevationGainLoss } from "../track/elevation.js";
import { suggestActivityTypes } from "../track/suggestType.js";
import {
  getImmichBaseUrl,
  updateImmichSettings as saveImmichSettings,
} from "../immich/settings.js";
import { scanActivityMedia } from "../immich/scan.js";
import { DEFAULT_PERSON, slugifyPerson, listPeople } from "../people.js";
import { EFFORT_FACTORS, effortFactor, equivalentMeters } from "../trips/effort.js";

// A flagged point only actually matters if removing it noticeably moves the
// track's total distance — some flagged jumps are implausible-speed but
// low-distance (e.g. a brief GPS wobble at a dead stop), and aren't worth
// surfacing as something to clean up. 100m is a cheap haversine estimate
// over points_data (not the real format-specific reparse activityOutlierDiff
// does), which is fine for this list/filter purpose.
const MIN_OUTLIER_DISTANCE_DELTA_METERS = 100;

// Mirrors MIN_OUTLIER_DISTANCE_DELTA_METERS above: a flagged run only
// matters if the correction noticeably changes the elevation profile.
const MIN_ELEVATION_SPIKE_DELTA_METERS = 15;

import { DateTimeScalar, JSONScalar } from "./scalars.js";

function mapActivityRow(row) {
  return {
    id: row.id,
    gpxFilename: row.gpx_filename,
    owner: row.owner,
    title: row.title,
    activityType: row.activity_type,
    startTime: row.start_time,
    endTime: row.end_time,
    durationSeconds: row.duration_seconds,
    distanceMeters: Number(row.distance_meters),
    avgSpeedMps: row.avg_speed_mps !== null ? Number(row.avg_speed_mps) : null,
    movingAvgSpeedMps: row.moving_avg_speed_mps !== null ? Number(row.moving_avg_speed_mps) : null,
    maxSpeedMps: row.max_speed_mps !== null ? Number(row.max_speed_mps) : null,
    totalElevationGain: row.total_elevation_gain !== null ? Number(row.total_elevation_gain) : null,
    totalElevationLoss: row.total_elevation_loss !== null ? Number(row.total_elevation_loss) : null,
    avgHr: row.avg_hr !== null ? Number(row.avg_hr) : null,
    maxHr: row.max_hr !== null ? Number(row.max_hr) : null,
    notes: row.notes,
    locationName: row.location_name,
    best1kmSeconds: row.best_1km_seconds !== null ? Number(row.best_1km_seconds) : null,
    best5kmSeconds: row.best_5km_seconds !== null ? Number(row.best_5km_seconds) : null,
    best10kmSeconds: row.best_10km_seconds !== null ? Number(row.best_10km_seconds) : null,
    routeThumbnail: row.route_thumbnail ?? null,
    mediaCount: row.media_count !== undefined ? Number(row.media_count) : null,
  };
}

const GPX_FILES_DIRECTORY = process.env.GPX_FILES_DIRECTORY;

// The requesting person, from index.ts's X-GPX-Person context. Resolvers
// called without a context (unit tests) act as DEFAULT_PERSON.
function personOf(context) {
  return context?.person ?? DEFAULT_PERSON;
}

// WHERE fragment limiting `alias` (an activities row) to the ones the
// person bound as $n owns or has had shared with them — shared activities
// count for the recipient exactly like their own.
function visibleTo(alias, n) {
  return `(${alias}.owner = $${n} OR ${alias}.gpx_filename IN (SELECT gpx_filename FROM activity_shares WHERE person = $${n}))`;
}

// Dates leave as YYYY-MM-DD text: a DATE through the DateTime scalar would
// shift by the server's UTC offset.
const TRIP_COLUMNS = `t.id, t.name, to_char(t.start_date, 'YYYY-MM-DD') AS start_date,
  to_char(t.end_date, 'YYYY-MM-DD') AS end_date, t.goal_meters`;

function mapTripRow(row) {
  return {
    id: String(row.id),
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    goalMeters: Number(row.goal_meters),
  };
}

// Only its participants can see or change a trip.
async function findTrip(id, context) {
  const { rows } = await pool.query(
    `SELECT ${TRIP_COLUMNS} FROM trips t
     JOIN trip_participants p ON p.trip_id = t.id
     WHERE t.id = $1 AND p.person = $2`,
    [id, personOf(context)],
  );
  return rows[0] ? mapTripRow(rows[0]) : null;
}

// What `person` did inside the trip's window (both dates inclusive), each
// with its equivalent hiking distance.
async function tripActivities(trip, person) {
  const { rows } = await pool.query(
    `SELECT a.id, a.title, a.activity_type, a.start_time, a.distance_meters, a.total_elevation_gain
     FROM activities a
     WHERE ${visibleTo("a", 1)}
       AND a.start_time >= $2::date
       AND a.start_time < $3::date + 1
     ORDER BY a.start_time`,
    [person, trip.startDate, trip.endDate],
  );
  return rows.map((row) => {
    const activity = {
      id: String(row.id),
      title: row.title,
      activityType: row.activity_type,
      startTime: row.start_time,
      distanceMeters: Number(row.distance_meters),
      totalElevationGain:
        row.total_elevation_gain == null ? null : Number(row.total_elevation_gain),
    };
    return {
      ...activity,
      factor: effortFactor(activity.activityType).factor,
      equivalentMeters: equivalentMeters(activity),
    };
  });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Only the owner edits/trims/deletes the source file; a share recipient
// gets read-only access.
async function requireOwnedActivity(id, context) {
  const { rows } = await pool.query("SELECT gpx_filename, owner FROM activities WHERE id = $1", [
    id,
  ]);
  if (!rows[0]) throw new Error(`Activity ${id} not found`);
  if (rows[0].owner !== personOf(context)) {
    throw new Error(`Only ${rows[0].owner} can edit this activity`);
  }
  return rows[0];
}

// In-app GPS recording (Record.jsx) submits the full GPX XML it built
// client-side here for a plain disk write, reusing the existing watcher/
// processFile() pipeline rather than a parallel DB-insert code path. The
// filename is always generated server-side from a timestamp + random
// suffix — never derived from client input — since this is a new surface
// that writes an arbitrary client-submitted string to a file on disk, and a
// client-controlled filename/path would be a traversal/overwrite risk.
const MAX_RECORDED_GPX_BYTES = 10 * 1024 * 1024;

// Files picked on the phone or dropped on the web Dashboard. Same formats the
// watcher ingests (gpx/watcher.ts).
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const IMPORT_EXTENSIONS = [".gpx", ".igc", ".skiz"];
const DUPLICATE_START_WINDOW_MS = 60_000;

// Keeps the picked name (the title and type guess can fall back to it) but
// only characters that are safe in a path segment.
function cleanImportName(filename) {
  const ext = path.extname(filename).toLowerCase();
  const stem = path
    .basename(filename, path.extname(filename))
    .replace(/[^A-Za-z0-9 ._()-]/g, "_")
    .replace(/^[.\s]+/, "")
    .slice(0, 120)
    .trim();
  return `${stem || "imported"}${ext}`;
}

// COPYFILE_EXCL never overwrites; a different file with the same name gets
// -2, -3, ... instead.
async function placeImport(tmpPath, dir, name) {
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${stem}-${n}${ext}`;
    try {
      await copyFile(tmpPath, path.join(dir, candidate), constants.COPYFILE_EXCL);
      return candidate;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }
  }
}

// Heatmap points are sent to the browser as [lat, lon, elevation] triples
// for every activity at once, so each route is capped/sampled rather than
// sent at full resolution (a few hundred activities at full GPS density
// would be tens of MB of JSON).
const MAX_HEATMAP_POINTS_PER_ROUTE = 300;

// Dashboard list thumbnails only need a handful of points to draw a
// recognizable polyline shape, matching frontend/src/pages/Dashboard.jsx's
// THUMBNAIL_MAX_POINTS.
const MAX_THUMBNAIL_POINTS_PER_ROUTE = 60;

/** Whether the GraphQL query selected `field` directly on this resolver's result. */
function selectsField(info, field: string) {
  return info.fieldNodes.some((node) =>
    node.selectionSet?.selections.some((sel) => sel.kind === "Field" && sel.name.value === field),
  );
}

// heatmapPoints is expensive (scans every stored track point across all
// activities to sample it down) and rarely changes between requests, so
// cache the result for a few minutes instead of recomputing on every page
// load. Staleness up to HEATMAP_CACHE_TTL_MS after a new activity is
// ingested is acceptable for this small personal app. Cached per person,
// since each person's heatmap covers a different set of activities.
const HEATMAP_CACHE_TTL_MS = 5 * 60 * 1000;
const heatmapCache = new Map();

// similarActivities: ST_HausdorffDistance measures how far apart the two
// most-divergent points of two line shapes are, which is a good proxy for
// "same route" (small if one track is a near-superset/subset or minor
// variant of the other, large if the paths diverge anywhere). Comparing
// full-resolution tracks (some routes have 10k+ points) makes it O(n*m) and
// too slow, so both sides are ST_Simplify'd first — verified empirically
// against this deployment's real repeat routes (e.g. "Slickrock loop",
// ridden ~10 times) that a 0.0003-degree (~33m) tolerance keeps route shape
// distinct while cutting runtime from >1s to ~350ms for a full ~511-row
// scan. The *111320 conversion is an approximate degrees-to-meters factor
// (exact at the equator, close enough for a single-region personal
// deployment) used only for thresholding/sorting, not as an exact distance.
// SIMILAR_ROUTE_THRESHOLD_METERS was picked empirically: real repeats of
// the same route measured 80-510m apart, a near-variant (partial overlap)
// measured ~975m, and unrelated routes measured 4km+ apart — 1000m sits
// just above the near-variant case and well below unrelated routes.
const SIMILAR_ROUTE_SIMPLIFY_TOLERANCE_DEGREES = 0.0003;
const SIMILAR_ROUTE_THRESHOLD_METERS = 1000;
const DEGREES_TO_METERS = 111320;

async function removeTrackPointsByFormat(filePath, filename, indices) {
  if (filename.endsWith(".skiz")) return removeSkizTrackPoints(filePath, indices);
  if (filename.endsWith(".igc")) return removeIgcTrackPoints(filePath, indices);
  if (filename.endsWith(".gpx")) return removeGpxTrackPoints(filePath, indices);
  throw new Error("Cleaning is only supported for .gpx, .skiz, and .igc files");
}

async function fixTrackElevationsByFormat(filePath, filename, corrections) {
  if (filename.endsWith(".skiz")) return fixSkizElevations(filePath, corrections);
  if (filename.endsWith(".igc")) return fixIgcElevations(filePath, corrections);
  if (filename.endsWith(".gpx")) return fixGpxElevations(filePath, corrections);
  throw new Error("Elevation fixing is only supported for .gpx, .skiz, and .igc files");
}

// { startIndex, endIndex }[] -> Map<index, correctedElevation>, built from
// the already-corrected points array so callers don't recompute
// interpolation themselves.
function correctionsFromSpikeRuns(spikeRuns, correctedPoints) {
  const corrections = new Map();
  for (const { startIndex, endIndex } of spikeRuns) {
    for (let i = startIndex; i <= endIndex; i++) {
      corrections.set(i, correctedPoints[i].elevation);
    }
  }
  return corrections;
}

export const resolvers = {
  DateTime: DateTimeScalar,
  JSON: JSONScalar,

  Query: {
    activity: async (_parent, { id }, context) => {
      const { rows } = await pool.query(
        `SELECT a.* FROM activities a WHERE a.id = $1 AND ${visibleTo("a", 2)}`,
        [id, personOf(context)],
      );
      return rows[0] ? mapActivityRow(rows[0]) : null;
    },

    activities: async (
      _parent,
      { limit = 20, offset = 0, activityType, startDate, endDate, search },
      context,
      info,
    ) => {
      const params = [personOf(context)];
      const conditions = [visibleTo("a", 1)];

      if (activityType) {
        params.push(activityType);
        conditions.push(`activity_type = $${params.length}`);
      }
      if (startDate) {
        params.push(startDate);
        conditions.push(`start_time >= $${params.length}`);
      }
      if (endDate) {
        params.push(endDate);
        conditions.push(`start_time <= $${params.length}`);
      }
      if (search) {
        params.push(`%${search}%`);
        conditions.push(`title ILIKE $${params.length}`);
      }

      const whereClause = `WHERE ${conditions.join(" AND ")}`;

      // Thumbnails are sampled down to a handful of [lat, lon] pairs in SQL
      // and joined in here, rather than the frontend fetching each
      // activity's full-resolution route (as Activity.route does) just to
      // downsample it client-side — that was the dashboard's main slow path.
      // Sampling is done via generate_series indexing straight into the
      // points_data array (r.points_data->i), not jsonb_array_elements +
      // modulo filter — the latter expands every point of every route
      // (hundreds to thousands each) just to throw most of them away, which
      // dominated the dashboard's load time. Even sampled, it still reads
      // every route's points_data, so it's skipped when the query doesn't
      // ask for routeThumbnail (the Stats page's 1000-activity list).
      let thumbnailSelect = "NULL AS route_thumbnail";
      let thumbnailJoin = "";
      if (selectsField(info, "routeThumbnail")) {
        params.push(MAX_THUMBNAIL_POINTS_PER_ROUTE);
        thumbnailSelect = "thumb.points AS route_thumbnail";
        thumbnailJoin = `LEFT JOIN LATERAL (
           SELECT jsonb_agg(
             jsonb_build_array(
               (r.points_data->i->>'lat')::float8,
               (r.points_data->i->>'lon')::float8
             ) ORDER BY i
           ) AS points
           FROM activity_routes r,
           LATERAL generate_series(
             0,
             jsonb_array_length(r.points_data) - 1,
             GREATEST(1, jsonb_array_length(r.points_data) / $${params.length})
           ) AS i
           WHERE r.activity_id = a.id
         ) thumb ON true`;
      }
      params.push(limit, offset);

      const { rows } = await pool.query(
        `SELECT a.*, ${thumbnailSelect}, COALESCE(media.count, 0) AS media_count
         FROM activities a
         ${thumbnailJoin}
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS count FROM activity_media m WHERE m.activity_id = a.id
         ) media ON true
         ${whereClause}
         ORDER BY a.start_time DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return rows.map(mapActivityRow);
    },

    onThisDay: async (_parent, _args, context) => {
      const { rows } = await pool.query(
        `
        SELECT a.* FROM activities a
        WHERE ${visibleTo("a", 1)}
          AND EXTRACT(MONTH FROM start_time) = EXTRACT(MONTH FROM CURRENT_DATE)
          AND EXTRACT(DAY FROM start_time) = EXTRACT(DAY FROM CURRENT_DATE)
          AND EXTRACT(YEAR FROM start_time) <> EXTRACT(YEAR FROM CURRENT_DATE)
        ORDER BY start_time DESC
      `,
        [personOf(context)],
      );
      return rows.map(mapActivityRow);
    },

    activityStreak: async (_parent, _args, context) => {
      const { rows } = await pool.query(
        `
        SELECT DISTINCT DATE(start_time) AS day
        FROM activities a
        WHERE ${visibleTo("a", 1)}
        ORDER BY day
      `,
        [personOf(context)],
      );

      const days = rows.map((row) => new Date(row.day));
      const MS_PER_DAY = 24 * 60 * 60 * 1000;

      let longestStreakDays = 0;
      let runLength = 0;
      let previousDay = null;
      for (const day of days) {
        if (previousDay !== null && day.getTime() - previousDay.getTime() === MS_PER_DAY) {
          runLength += 1;
        } else {
          runLength = 1;
        }
        longestStreakDays = Math.max(longestStreakDays, runLength);
        previousDay = day;
      }

      let currentStreakDays = 0;
      if (days.length > 0) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const lastDay = days[days.length - 1];
        const daysSinceLast = Math.round((today.getTime() - lastDay.getTime()) / MS_PER_DAY);
        // Streak is alive if the most recent activity was today or yesterday;
        // otherwise a full day has passed with no activity and it's broken.
        if (daysSinceLast <= 1) {
          currentStreakDays = 1;
          for (let i = days.length - 1; i > 0; i--) {
            if (days[i].getTime() - days[i - 1].getTime() === MS_PER_DAY) {
              currentStreakDays += 1;
            } else {
              break;
            }
          }
        }
      }

      return { currentStreakDays, longestStreakDays };
    },

    yearOverYearComparison: async (_parent, _args, context) => {
      const { rows } = await pool.query(
        `
        SELECT
          EXTRACT(YEAR FROM CURRENT_DATE)::int AS current_year,
          EXTRACT(YEAR FROM CURRENT_DATE)::int - 1 AS previous_year,
          COUNT(*) FILTER (
            WHERE start_time >= date_trunc('year', CURRENT_DATE)
              AND start_time <= CURRENT_DATE
          )::int AS current_count,
          COALESCE(SUM(distance_meters) FILTER (
            WHERE start_time >= date_trunc('year', CURRENT_DATE)
              AND start_time <= CURRENT_DATE
          ), 0) AS current_distance_meters,
          COALESCE(SUM(total_elevation_gain) FILTER (
            WHERE start_time >= date_trunc('year', CURRENT_DATE)
              AND start_time <= CURRENT_DATE
          ), 0) AS current_elevation_gain_meters,
          COUNT(*) FILTER (
            WHERE start_time >= date_trunc('year', CURRENT_DATE) - INTERVAL '1 year'
              AND start_time <= CURRENT_DATE - INTERVAL '1 year'
          )::int AS previous_count,
          COALESCE(SUM(distance_meters) FILTER (
            WHERE start_time >= date_trunc('year', CURRENT_DATE) - INTERVAL '1 year'
              AND start_time <= CURRENT_DATE - INTERVAL '1 year'
          ), 0) AS previous_distance_meters,
          COALESCE(SUM(total_elevation_gain) FILTER (
            WHERE start_time >= date_trunc('year', CURRENT_DATE) - INTERVAL '1 year'
              AND start_time <= CURRENT_DATE - INTERVAL '1 year'
          ), 0) AS previous_elevation_gain_meters
        FROM activities a
        WHERE ${visibleTo("a", 1)}
      `,
        [personOf(context)],
      );
      const row = rows[0];
      return {
        currentYear: {
          year: row.current_year,
          activityCount: row.current_count,
          totalDistanceMeters: Number(row.current_distance_meters),
          totalElevationGainMeters: Number(row.current_elevation_gain_meters),
        },
        previousYear: {
          year: row.previous_year,
          activityCount: row.previous_count,
          totalDistanceMeters: Number(row.previous_distance_meters),
          totalElevationGainMeters: Number(row.previous_elevation_gain_meters),
        },
      };
    },

    trainingLoad: async (_parent, _args, context) => {
      const { rows } = await pool.query(
        `
        SELECT
          COALESCE(SUM(distance_meters) FILTER (
            WHERE start_time >= CURRENT_DATE - INTERVAL '6 days'
          ), 0) AS acute_distance_meters,
          COALESCE(SUM(distance_meters) FILTER (
            WHERE start_time >= CURRENT_DATE - INTERVAL '27 days'
          ), 0) AS chronic_28day_distance_meters
        FROM activities a
        WHERE ${visibleTo("a", 1)}
      `,
        [personOf(context)],
      );
      const row = rows[0];
      const acuteDistanceMeters = Number(row.acute_distance_meters);
      const chronicWeeklyAvgDistanceMeters = Number(row.chronic_28day_distance_meters) / 4;
      const ratio =
        chronicWeeklyAvgDistanceMeters > 0
          ? acuteDistanceMeters / chronicWeeklyAvgDistanceMeters
          : null;
      let label = "steady";
      if (ratio !== null) {
        if (ratio > 1.5) label = "ramping up";
        else if (ratio < 0.8) label = "detraining";
      }
      return { acuteDistanceMeters, chronicWeeklyAvgDistanceMeters, ratio, label };
    },

    // Longest distance / biggest elevation gain are plain MAX() aggregates;
    // fastest 1km/5km/10km are MIN() over the best_*_seconds columns, which
    // are precomputed once per activity at ingest time by
    // track/personalRecords.js (see gpx/processor.js) rather than scanned
    // live here — a live sliding-window scan across every activity on every
    // Stats-page load would be far too expensive. MIN()/MAX() ignore NULLs,
    // so activity types with no activity long enough for a given target
    // distance correctly come back null for that field instead of erroring.
    personalRecordsByType: async (_parent, _args, context) => {
      const { rows } = await pool.query(
        `
        SELECT
          activity_type,
          MAX(distance_meters) AS longest_distance_meters,
          MAX(total_elevation_gain) AS biggest_elevation_gain_meters,
          MIN(best_1km_seconds) AS best_1km_seconds,
          MIN(best_5km_seconds) AS best_5km_seconds,
          MIN(best_10km_seconds) AS best_10km_seconds
        FROM activities a
        WHERE ${visibleTo("a", 1)}
        GROUP BY activity_type
        ORDER BY activity_type
      `,
        [personOf(context)],
      );
      return rows.map((row) => ({
        activityType: row.activity_type,
        longestDistanceMeters: Number(row.longest_distance_meters),
        biggestElevationGainMeters:
          row.biggest_elevation_gain_meters !== null
            ? Number(row.biggest_elevation_gain_meters)
            : null,
        best1kmSeconds: row.best_1km_seconds !== null ? Number(row.best_1km_seconds) : null,
        best5kmSeconds: row.best_5km_seconds !== null ? Number(row.best_5km_seconds) : null,
        best10kmSeconds: row.best_10km_seconds !== null ? Number(row.best_10km_seconds) : null,
      }));
    },

    activitySummary: async (_parent, _args, context) => {
      const { rows } = await pool.query(
        `
        SELECT
          COUNT(*)::int AS total_activities,
          COALESCE(SUM(distance_meters), 0) AS total_distance_meters,
          COALESCE(SUM(duration_seconds), 0)::bigint AS total_duration_seconds,
          COALESCE(SUM(total_elevation_gain), 0) AS total_elevation_gain_meters,
          MAX(updated_at) AS last_reanalysis
        FROM activities a
        WHERE ${visibleTo("a", 1)}
      `,
        [personOf(context)],
      );
      const row = rows[0];
      return {
        totalActivities: row.total_activities,
        totalDistanceMeters: Number(row.total_distance_meters),
        totalDurationSeconds: Number(row.total_duration_seconds),
        totalElevationGainMeters: Number(row.total_elevation_gain_meters),
        lastReanalysis: row.last_reanalysis,
      };
    },

    aggregatedStatsByType: async (_parent, { activityType, startDate, endDate }, context) => {
      const params = [personOf(context)];
      const conditions = [visibleTo("a", 1)];

      if (activityType) {
        params.push(activityType);
        conditions.push(`activity_type = $${params.length}`);
      }
      if (startDate) {
        params.push(startDate);
        conditions.push(`start_time >= $${params.length}`);
      }
      if (endDate) {
        params.push(endDate);
        conditions.push(`start_time <= $${params.length}`);
      }
      const whereClause = `WHERE ${conditions.join(" AND ")}`;

      const { rows } = await pool.query(
        `
        SELECT
          activity_type,
          COUNT(*)::int AS count,
          SUM(distance_meters) AS total_distance_meters,
          SUM(duration_seconds)::bigint AS total_duration_seconds,
          AVG(distance_meters) AS average_distance_meters,
          AVG(duration_seconds)::bigint AS average_duration_seconds,
          AVG(total_elevation_gain) AS average_elevation_gain_meters
        FROM activities a
        ${whereClause}
        GROUP BY activity_type
        ORDER BY activity_type
      `,
        params,
      );

      return rows.map((row) => ({
        activityType: row.activity_type,
        count: row.count,
        totalDistanceMeters: Number(row.total_distance_meters),
        totalDurationSeconds: Number(row.total_duration_seconds),
        averageDistanceMeters: Number(row.average_distance_meters),
        averageDurationSeconds: Number(row.average_duration_seconds),
        averageElevationGainMeters:
          row.average_elevation_gain_meters !== null
            ? Number(row.average_elevation_gain_meters)
            : null,
      }));
    },

    // Sampling happens in SQL rather than fetching full-resolution points_data
    // and sampling in JS: the latter pulled every stored point (hundreds of
    // MB of JSON text across all activities) over the wire just to keep 300
    // of them per route, which is what made this query slow.
    heatmapPoints: async (_parent, _args, context) => {
      const person = personOf(context);
      const cached = heatmapCache.get(person);
      if (cached && Date.now() - cached.computedAt < HEATMAP_CACHE_TTL_MS) {
        return cached.points;
      }
      const { rows } = await pool.query(
        `
        WITH lens AS MATERIALIZED (
          SELECT activity_id, jsonb_array_length(points_data) AS len FROM activity_routes
        )
        SELECT jsonb_agg(
          jsonb_build_array(
            (elem->>'lat')::float8,
            (elem->>'lon')::float8,
            (elem->>'elevation')::float8
          )
        ) AS sampled
        FROM activity_routes r
        JOIN activities a ON a.id = r.activity_id
        JOIN lens l ON l.activity_id = r.activity_id,
        LATERAL jsonb_array_elements(r.points_data) WITH ORDINALITY AS e(elem, ord)
        WHERE (ord - 1) % GREATEST(1, l.len / $1) = 0
          AND ${visibleTo("a", 2)}
        `,
        [MAX_HEATMAP_POINTS_PER_ROUTE, person],
      );
      const points = rows[0]?.sampled ?? [];
      heatmapCache.set(person, { points, computedAt: Date.now() });
      return points;
    },

    // Bounding box of activity routes from the last `months` months, used by
    // the heatmap page to default its initial view to wherever the user has
    // actually been active lately instead of a fixed region. Deliberately a
    // separate, much cheaper query than heatmapPoints (ST_Extent over an
    // already-indexed geometry column for a small recent subset) rather than
    // deriving it from the full, sampled-down heatmapPoints result, since
    // that result carries no per-point timestamp to filter by. Returns null
    // if there's no activity in the window (e.g. fresh install, or a stale
    // deployment), so the caller can fall back to its existing default.
    recentActivityBounds: async (_parent, { months = 6 }, context) => {
      const { rows } = await pool.query(
        `
        SELECT
          ST_YMin(ST_Extent(r.route_geom)) AS min_lat,
          ST_YMax(ST_Extent(r.route_geom)) AS max_lat,
          ST_XMin(ST_Extent(r.route_geom)) AS min_lon,
          ST_XMax(ST_Extent(r.route_geom)) AS max_lon
        FROM activity_routes r
        JOIN activities a ON a.id = r.activity_id
        WHERE a.start_time >= NOW() - ($1 || ' months')::interval
          AND ${visibleTo("a", 2)}
        `,
        [months, personOf(context)],
      );
      const row = rows[0];
      if (!row || row.min_lat == null) return null;
      return [
        [row.min_lat, row.min_lon],
        [row.max_lat, row.max_lon],
      ];
    },

    // Owner-only rather than visibleTo: these lists exist to fix the
    // source file, which only the owner can do.
    activitiesWithOutliers: async (_parent, _args, context) => {
      const { rows } = await pool.query(
        `
        SELECT a.id, a.title, a.activity_type, a.start_time, a.gpx_filename, r.points_data
        FROM activities a
        JOIN activity_routes r ON r.activity_id = a.id
        WHERE a.owner = $1
      `,
        [personOf(context)],
      );
      return rows
        .map((row) => {
          const points = row.points_data || [];
          const removedIndices = detectOutliers(points);
          const cleanedPoints = points.filter((_, i) => !removedIndices.includes(i));
          const distanceDeltaMeters =
            removedIndices.length > 0
              ? Math.abs(
                  computeTrackStats(points).distanceMeters -
                    computeTrackStats(cleanedPoints).distanceMeters,
                )
              : 0;
          return {
            activityId: row.id,
            title: row.title,
            activityType: row.activity_type,
            startTime: row.start_time,
            gpxFilename: row.gpx_filename,
            outlierPointCount: removedIndices.length,
            distanceDeltaMeters,
          };
        })
        .filter((r) => r.distanceDeltaMeters > MIN_OUTLIER_DISTANCE_DELTA_METERS)
        .sort((a, b) => b.outlierPointCount - a.outlierPointCount);
    },

    // Runs the removal against a throwaway copy of the source file and
    // re-parses it with the real format parser, rather than estimating
    // post-clean distance/speed with a generic haversine pass over
    // points_data: gpx/parser.js trusts gpxparser's own distance/elevation
    // algorithm (not haversine) for .gpx files, so a haversine estimate here
    // would silently disagree with what cleanActivityOutliers actually
    // produces once saved.
    activityOutlierDiff: async (_parent, { id }) => {
      const { rows } = await pool.query("SELECT * FROM activities WHERE id = $1", [id]);
      if (!rows[0]) throw new Error(`Activity ${id} not found`);
      const activityRow = rows[0];

      const { rows: routeRows } = await pool.query(
        "SELECT points_data FROM activity_routes WHERE activity_id = $1",
        [id],
      );
      const points = routeRows[0]?.points_data || [];
      const removedIndices = detectOutliers(points);

      const outlierPoints = removedIndices.map((i) => {
        const prev = points[i - 1];
        const curr = points[i];
        let impliedSpeedMps = null;
        if (prev?.timestamp && curr?.timestamp) {
          const dtSeconds = (curr.timestamp - prev.timestamp) / 1000;
          if (dtSeconds > 0) impliedSpeedMps = haversineMeters(prev, curr) / dtSeconds;
        }
        return {
          index: i,
          lat: curr.lat,
          lon: curr.lon,
          elevation: curr.elevation ?? null,
          timestamp: curr.timestamp ?? null,
          impliedSpeedMps,
        };
      });

      let cleanedPointCount = points.length;
      let cleanedMaxSpeedMps =
        activityRow.max_speed_mps !== null ? Number(activityRow.max_speed_mps) : null;
      let cleanedDistanceMeters = Number(activityRow.distance_meters);

      if (removedIndices.length > 0) {
        const filename = activityRow.gpx_filename.toLowerCase();
        const originalPath = path.join(GPX_FILES_DIRECTORY, activityRow.gpx_filename);
        const tempPath = path.join(
          os.tmpdir(),
          `outlier-preview-${randomBytes(6).toString("hex")}${path.extname(activityRow.gpx_filename)}`,
        );
        await copyFile(originalPath, tempPath);
        try {
          await removeTrackPointsByFormat(tempPath, filename, removedIndices);
          const parsed = await parseActivityFile(tempPath);
          cleanedPointCount = parsed.points.length;
          cleanedMaxSpeedMps = parsed.maxSpeedMps;
          cleanedDistanceMeters = totalsExcludingLifts(parsed).distanceMeters;
        } finally {
          await rm(tempPath, { force: true });
        }
      }

      return {
        activityId: id,
        outlierPoints,
        originalPointCount: points.length,
        cleanedPointCount,
        originalMaxSpeedMps:
          activityRow.max_speed_mps !== null ? Number(activityRow.max_speed_mps) : null,
        cleanedMaxSpeedMps,
        originalDistanceMeters: Number(activityRow.distance_meters),
        cleanedDistanceMeters,
      };
    },

    activitiesWithElevationSpikes: async (_parent, _args, context) => {
      const { rows } = await pool.query(
        `
        SELECT a.id, a.title, a.activity_type, a.start_time, a.gpx_filename, r.points_data
        FROM activities a
        JOIN activity_routes r ON r.activity_id = a.id
        WHERE a.owner = $1
      `,
        [personOf(context)],
      );
      return rows
        .map((row) => {
          const points = row.points_data || [];
          const spikeRuns = detectElevationSpikes(points);
          const correctedPoints = correctElevationSpikes(points, spikeRuns);
          const totalElevationDeltaMeters = spikeRuns.reduce((sum, { startIndex, endIndex }) => {
            for (let i = startIndex; i <= endIndex; i++) {
              sum += Math.abs(correctedPoints[i].elevation - points[i].elevation);
            }
            return sum;
          }, 0);
          return {
            activityId: row.id,
            title: row.title,
            activityType: row.activity_type,
            startTime: row.start_time,
            gpxFilename: row.gpx_filename,
            spikeCount: spikeRuns.reduce(
              (sum, { startIndex, endIndex }) => sum + (endIndex - startIndex + 1),
              0,
            ),
            totalElevationDeltaMeters,
          };
        })
        .filter((r) => r.totalElevationDeltaMeters > MIN_ELEVATION_SPIKE_DELTA_METERS)
        .sort((a, b) => b.totalElevationDeltaMeters - a.totalElevationDeltaMeters);
    },

    // Doesn't need activityOutlierDiff's temp-file-reparse dance: fixing an
    // elevation spike only ever changes one field (elevation) on already-
    // flagged indices, never point count or lat/lon, so gain/loss can be
    // recomputed directly from the corrected points with the same
    // computeElevationGainLoss() every parser already uses at ingest time.
    activityElevationFixDiff: async (_parent, { id }) => {
      const { rows: routeRows } = await pool.query(
        "SELECT points_data FROM activity_routes WHERE activity_id = $1",
        [id],
      );
      const points = routeRows[0]?.points_data || [];
      const spikeRuns = detectElevationSpikes(points);
      const correctedPoints = correctElevationSpikes(points, spikeRuns);

      const spikePoints = [];
      for (const { startIndex, endIndex } of spikeRuns) {
        for (let i = startIndex; i <= endIndex; i++) {
          spikePoints.push({
            index: i,
            lat: points[i].lat,
            lon: points[i].lon,
            originalElevation: points[i].elevation ?? null,
            correctedElevation: correctedPoints[i].elevation ?? null,
            timestamp: points[i].timestamp ?? null,
          });
        }
      }

      const original = computeElevationGainLoss(points.map((p) => p.elevation));
      const corrected = computeElevationGainLoss(correctedPoints.map((p) => p.elevation));

      return {
        activityId: id,
        spikePoints,
        originalElevationGain: original.gain,
        correctedElevationGain: corrected.gain,
        originalElevationLoss: original.loss,
        correctedElevationLoss: corrected.loss,
      };
    },

    activitiesWithLiftSegments: async (_parent, _args, context) => {
      const { rows } = await pool.query(
        `
        SELECT a.id, a.title, a.activity_type, a.start_time, r.points_data
        FROM activities a
        JOIN activity_routes r ON r.activity_id = a.id
        WHERE ${visibleTo("a", 1)}
      `,
        [personOf(context)],
      );
      return rows
        .map((row) => {
          const segments = detectLiftSegments(row.points_data || []);
          return {
            activityId: row.id,
            title: row.title,
            activityType: row.activity_type,
            startTime: row.start_time,
            liftSegmentCount: segments.length,
            totalLiftElevationGainMeters: segments.reduce(
              (sum, s) => sum + Math.max(0, s.elevationGainMeters),
              0,
            ),
          };
        })
        .filter((r) => r.liftSegmentCount > 0)
        .sort((a, b) => b.totalLiftElevationGainMeters - a.totalLiftElevationGainMeters);
    },

    immichSettings: async () => {
      const baseUrl = await getImmichBaseUrl();
      return { immichBaseUrl: baseUrl, configured: baseUrl != null };
    },

    people: async () => listPeople(GPX_FILES_DIRECTORY),

    trips: async (_parent, _args, context) => {
      const { rows } = await pool.query(
        `SELECT ${TRIP_COLUMNS} FROM trips t
         JOIN trip_participants p ON p.trip_id = t.id
         WHERE p.person = $1
         ORDER BY t.end_date, t.id`,
        [personOf(context)],
      );
      return rows.map(mapTripRow);
    },

    trip: async (_parent, { id }, context) => findTrip(id, context),

    effortFactors: () => EFFORT_FACTORS,
  },

  Mutation: {
    reanalyzeAllActivities: async () => reanalyzeAll(GPX_FILES_DIRECTORY),
    reanalyzeActivitiesByDateRange: async (_parent, { startDate, endDate }) =>
      reanalyzeByDateRange(GPX_FILES_DIRECTORY, startDate, endDate),

    updateActivityTitle: async (_parent, { id, title }, context) => {
      const activity = await requireOwnedActivity(id, context);
      const filename = activity.gpx_filename.toLowerCase();
      if (!filename.endsWith(".gpx") && !filename.endsWith(".skiz")) {
        throw new Error("Editing is only supported for .gpx and .skiz files");
      }

      const filePath = path.join(GPX_FILES_DIRECTORY, activity.gpx_filename);
      await (filename.endsWith(".skiz") ? updateSkizTitle : updateGpxTitle)(filePath, title);
      await processFile(filePath);

      const { rows: updated } = await pool.query("SELECT * FROM activities WHERE id = $1", [id]);
      return mapActivityRow(updated[0]);
    },

    updateActivityNotes: async (_parent, { id, notes }, context) => {
      await requireOwnedActivity(id, context);
      const { rows } = await pool.query(
        "UPDATE activities SET notes = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
        [notes, id],
      );
      if (!rows[0]) throw new Error(`Activity ${id} not found`);
      return mapActivityRow(rows[0]);
    },

    updateActivityType: async (_parent, { id, activityType }, context) => {
      const activity = await requireOwnedActivity(id, context);
      const filename = activity.gpx_filename.toLowerCase();
      if (!filename.endsWith(".gpx") && !filename.endsWith(".skiz")) {
        throw new Error("Editing is only supported for .gpx and .skiz files");
      }

      const filePath = path.join(GPX_FILES_DIRECTORY, activity.gpx_filename);
      if (filename.endsWith(".skiz")) {
        await updateSkizType(filePath, activityType);
      } else {
        await updateGpxType(filePath, activityTypeToRawType(activityType));
      }
      await processFile(filePath);

      const { rows: updated } = await pool.query("SELECT * FROM activities WHERE id = $1", [id]);
      return mapActivityRow(updated[0]);
    },

    trimActivity: async (_parent, { id, startIndex, endIndex }, context) => {
      const activity = await requireOwnedActivity(id, context);
      const filename = activity.gpx_filename.toLowerCase();
      if (!filename.endsWith(".gpx") && !filename.endsWith(".skiz")) {
        throw new Error("Editing is only supported for .gpx and .skiz files");
      }

      const filePath = path.join(GPX_FILES_DIRECTORY, activity.gpx_filename);
      await (filename.endsWith(".skiz") ? trimSkizTrack : trimGpxTrack)(
        filePath,
        startIndex,
        endIndex,
      );
      await processFile(filePath);

      const { rows: updated } = await pool.query("SELECT * FROM activities WHERE id = $1", [id]);
      return mapActivityRow(updated[0]);
    },

    // Puts back the file as it was before its first edit. Title and type live
    // in the file, so they revert too; notes are database-only and stay. The
    // current version is backed up first, so a restore can be undone by hand.
    restoreActivityOriginal: async (_parent, { id }, context) => {
      const activity = await requireOwnedActivity(id, context);
      const filePath = path.join(GPX_FILES_DIRECTORY, activity.gpx_filename);
      const original = await findOriginalBackup(filePath);
      if (!original)
        throw new Error("This activity hasn't been edited, so there's nothing to restore");

      await backupFile(filePath);
      await copyFile(original, filePath);
      await processFile(filePath);

      const { rows: updated } = await pool.query("SELECT * FROM activities WHERE id = $1", [id]);
      return mapActivityRow(updated[0]);
    },

    saveRecordedActivity: async (_parent, { gpxContent, clientId }, context) => {
      if (typeof gpxContent !== "string" || gpxContent.trim().length === 0) {
        throw new Error("gpxContent must be a non-empty string");
      }
      if (Buffer.byteLength(gpxContent, "utf-8") > MAX_RECORDED_GPX_BYTES) {
        throw new Error("Recorded GPX content is too large");
      }
      if (!/<gpx[\s>]/i.test(gpxContent) || !/<trkpt\b/i.test(gpxContent)) {
        throw new Error("gpxContent does not look like a valid GPX track");
      }

      if (clientId != null && !/^[A-Za-z0-9-]{8,64}$/.test(clientId)) {
        throw new Error("clientId must be 8-64 letters, digits, or dashes");
      }

      // A clientId (the mobile app's per-recording UUID) makes retries
      // idempotent: an upload whose response was lost gets re-sent with the
      // same id, and the "wx" flag refuses to write a second copy. Written
      // into the recorder's own folder, which is what makes them its owner.
      const person = personOf(context);
      const basename = clientId
        ? `recorded-${clientId}.gpx`
        : `recorded-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}.gpx`;
      const filename = `${person}/${basename}`;
      await mkdir(path.join(GPX_FILES_DIRECTORY, person), { recursive: true });
      try {
        await writeFile(path.join(GPX_FILES_DIRECTORY, filename), gpxContent, {
          encoding: "utf-8",
          flag: "wx",
        });
      } catch (err) {
        if (!clientId || err.code !== "EEXIST") throw err;
      }
      // Not processed synchronously here — the directory watcher (watcher.js)
      // picks the new file up and runs it through the same processFile()
      // path as any synced file. The frontend polls for the resulting
      // activity rather than blocking on it.
      return { filename };
    },

    // Refusals are REJECTED results rather than errors, so the phone's queue
    // knows not to retry them; a thrown error means "try again later".
    importActivityFile: async (_parent, { filename, contentBase64 }, context) => {
      const person = personOf(context);
      const reject = (reason) => ({ status: "REJECTED", reason });

      if (!IMPORT_EXTENSIONS.includes(path.extname(filename ?? "").toLowerCase())) {
        return reject("Not a GPX, IGC, or SKIZ file");
      }
      const bytes = Buffer.from(contentBase64 ?? "", "base64");
      if (bytes.length === 0) return reject("The file is empty");
      if (bytes.length > MAX_IMPORT_BYTES) return reject("The file is larger than 20 MB");

      const name = cleanImportName(filename);
      const tmpDir = await mkdtemp(path.join(os.tmpdir(), "gpx-import-"));
      try {
        const tmpPath = path.join(tmpDir, name);
        await writeFile(tmpPath, bytes);

        let parsed;
        try {
          parsed = await parseActivityFile(tmpPath);
        } catch {
          return reject("Couldn't read this file as a GPS track");
        }
        if (!parsed?.startTime || !parsed?.endTime) {
          return reject("This file has no timestamps, so it can't be an activity");
        }

        // Same bytes as the matching activity's file means this was already
        // imported (including a retry after a lost response); different bytes
        // with the same start is the same activity from another source.
        const start = parsed.startTime.getTime();
        const { rows: matches } = await pool.query(
          `SELECT id, title, gpx_filename FROM activities
           WHERE owner = $1 AND start_time BETWEEN $2 AND $3
           ORDER BY abs(extract(epoch FROM start_time) - $4) LIMIT 1`,
          [
            person,
            new Date(start - DUPLICATE_START_WINDOW_MS),
            new Date(start + DUPLICATE_START_WINDOW_MS),
            start / 1000,
          ],
        );
        const match = matches[0];
        if (match) {
          const existing = await readFile(path.join(GPX_FILES_DIRECTORY, match.gpx_filename)).catch(
            () => null,
          );
          const status = existing?.equals(bytes) ? "ALREADY_IMPORTED" : "DUPLICATE";
          return { status, activityId: match.id, title: match.title };
        }

        const dir = path.join(GPX_FILES_DIRECTORY, person);
        await mkdir(dir, { recursive: true });
        const placed = await placeImport(tmpPath, dir, name);
        await processFile(path.join(dir, placed));

        const { rows } = await pool.query(
          "SELECT id, title FROM activities WHERE gpx_filename = $1",
          [`${person}/${placed}`],
        );
        return {
          status: "IMPORTED",
          activityId: rows[0]?.id,
          title: rows[0]?.title ?? parsed.title,
        };
      } finally {
        await rm(tmpDir, { recursive: true, force: true });
      }
    },

    cleanActivityOutliers: async (_parent, { id }, context) => {
      const activity = await requireOwnedActivity(id, context);
      const filename = activity.gpx_filename.toLowerCase();

      const { rows: routeRows } = await pool.query(
        "SELECT points_data FROM activity_routes WHERE activity_id = $1",
        [id],
      );
      const removedIndices = detectOutliers(routeRows[0]?.points_data || []);

      if (removedIndices.length > 0) {
        const filePath = path.join(GPX_FILES_DIRECTORY, activity.gpx_filename);
        await removeTrackPointsByFormat(filePath, filename, removedIndices);
        await processFile(filePath);
      }

      const { rows: updated } = await pool.query("SELECT * FROM activities WHERE id = $1", [id]);
      return mapActivityRow(updated[0]);
    },

    fixActivityElevationSpikes: async (_parent, { id }, context) => {
      const activity = await requireOwnedActivity(id, context);
      const filename = activity.gpx_filename.toLowerCase();

      const { rows: routeRows } = await pool.query(
        "SELECT points_data FROM activity_routes WHERE activity_id = $1",
        [id],
      );
      const points = routeRows[0]?.points_data || [];
      const spikeRuns = detectElevationSpikes(points);

      if (spikeRuns.length > 0) {
        const correctedPoints = correctElevationSpikes(points, spikeRuns);
        const corrections = correctionsFromSpikeRuns(spikeRuns, correctedPoints);
        const filePath = path.join(GPX_FILES_DIRECTORY, activity.gpx_filename);
        await fixTrackElevationsByFormat(filePath, filename, corrections);
        await processFile(filePath);
      }

      const { rows: updated } = await pool.query("SELECT * FROM activities WHERE id = $1", [id]);
      return mapActivityRow(updated[0]);
    },

    // activity_routes.activity_id has ON DELETE CASCADE (see db/init.sql), so
    // deleting the activities row alone removes the route too. A share
    // recipient "deleting" only removes themselves from the share; the file
    // and row stay for the owner.
    deleteActivity: async (_parent, { id }, context) => {
      const person = personOf(context);
      const { rows } = await pool.query(
        "SELECT gpx_filename, owner FROM activities WHERE id = $1",
        [id],
      );
      if (!rows[0]) throw new Error(`Activity ${id} not found`);
      if (rows[0].owner !== person) {
        const { rowCount } = await pool.query(
          "DELETE FROM activity_shares WHERE gpx_filename = $1 AND person = $2",
          [rows[0].gpx_filename, person],
        );
        if (!rowCount) throw new Error(`Only ${rows[0].owner} can delete this activity`);
        return true;
      }

      // Keep a copy in _backups/ so a deleted activity can be recovered by hand.
      const filePath = path.join(GPX_FILES_DIRECTORY, rows[0].gpx_filename);
      try {
        await backupFile(filePath);
        await unlink(filePath);
      } catch (err) {
        if (err.code !== "ENOENT") throw err;
      }

      await pool.query("DELETE FROM activity_shares WHERE gpx_filename = $1", [
        rows[0].gpx_filename,
      ]);
      await pool.query("DELETE FROM activities WHERE id = $1", [id]);
      return true;
    },

    // "Did this with...": replaces the full set of people this activity is
    // shared with. Only existing people (listPeople) are accepted, so a typo
    // can't silently create a share nobody sees.
    setActivitySharedWith: async (_parent, { id, people }, context) => {
      const activity = await requireOwnedActivity(id, context);
      const known = await listPeople(GPX_FILES_DIRECTORY);
      const slugs = new Set<string>();
      for (const name of people) {
        const slug = slugifyPerson(name);
        if (!slug || !known.includes(slug)) throw new Error(`Unknown person: ${name}`);
        if (slug === activity.owner) throw new Error("Can't share an activity with its owner");
        slugs.add(slug);
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM activity_shares WHERE gpx_filename = $1", [
          activity.gpx_filename,
        ]);
        for (const slug of slugs) {
          await client.query("INSERT INTO activity_shares (gpx_filename, person) VALUES ($1, $2)", [
            activity.gpx_filename,
            slug,
          ]);
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }

      const { rows } = await pool.query("SELECT * FROM activities WHERE id = $1", [id]);
      return mapActivityRow(rows[0]);
    },

    updateImmichSettings: async (_parent, { immichBaseUrl, immichApiKey }) => {
      await saveImmichSettings(immichBaseUrl, immichApiKey);
      return true;
    },

    scanActivityMedia: async (_parent, { activityIds }) => {
      return scanActivityMedia(activityIds ? activityIds.map((id) => Number(id)) : undefined);
    },

    // Creates a trip (no id) or replaces one the requester is on. Whoever
    // creates a trip is always on it; after that any participant can change
    // anything, including who else is on it.
    saveTrip: async (_parent, { id, input }, context) => {
      const name = input.name.trim();
      if (!name) throw new Error("A trip needs a name");
      if (!DATE_RE.test(input.startDate) || !DATE_RE.test(input.endDate)) {
        throw new Error("Dates must be YYYY-MM-DD");
      }
      if (input.endDate < input.startDate) throw new Error("The end date is before the start date");
      if (!(input.goalMeters > 0)) throw new Error("The goal must be more than zero");
      if (id && !(await findTrip(id, context))) throw new Error("Trip not found");

      const known = await listPeople(GPX_FILES_DIRECTORY);
      const slugs = new Set<string>(id ? [] : [personOf(context)]);
      for (const person of input.participants) {
        const slug = slugifyPerson(person);
        if (!slug || !known.includes(slug)) throw new Error(`Unknown person: ${person}`);
        slugs.add(slug);
      }
      if (slugs.size === 0) throw new Error("A trip needs at least one person");

      const values = [name, input.startDate, input.endDate, input.goalMeters];
      const client = await pool.connect();
      let tripId = id;
      try {
        await client.query("BEGIN");
        if (id) {
          await client.query(
            "UPDATE trips SET name = $1, start_date = $2, end_date = $3, goal_meters = $4 WHERE id = $5",
            [...values, id],
          );
          await client.query("DELETE FROM trip_participants WHERE trip_id = $1", [id]);
        } else {
          const { rows } = await client.query(
            "INSERT INTO trips (name, start_date, end_date, goal_meters) VALUES ($1, $2, $3, $4) RETURNING id",
            values,
          );
          tripId = rows[0].id;
        }
        for (const slug of slugs) {
          await client.query("INSERT INTO trip_participants (trip_id, person) VALUES ($1, $2)", [
            tripId,
            slug,
          ]);
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }

      return {
        id: String(tripId),
        name,
        startDate: input.startDate,
        endDate: input.endDate,
        goalMeters: input.goalMeters,
      };
    },

    deleteTrip: async (_parent, { id }, context) => {
      if (!(await findTrip(id, context))) throw new Error("Trip not found");
      await pool.query("DELETE FROM trips WHERE id = $1", [id]);
      return true;
    },
  },

  Trip: {
    // Each person's total comes from what that person can see, not what
    // the requester can see. Only the total leaves the server.
    participants: async (parent) => {
      const { rows } = await pool.query(
        "SELECT person FROM trip_participants WHERE trip_id = $1 ORDER BY person",
        [parent.id],
      );
      const participants = [];
      for (const { person } of rows) {
        const activities = await tripActivities(parent, person);
        participants.push({
          person,
          equivalentMeters: activities.reduce((sum, a) => sum + a.equivalentMeters, 0),
        });
      }
      return participants;
    },

    myActivities: (parent, _args, context) => tripActivities(parent, personOf(context)),
  },

  Activity: {
    trackEdited: async (parent) => {
      const filePath = path.join(GPX_FILES_DIRECTORY, parent.gpxFilename);
      const original = await findOriginalBackup(filePath);
      if (!original) return false;
      const [before, after] = await Promise.all([
        parseActivityFile(original, filePath),
        parseActivityFile(filePath),
      ]);
      return !sameTrackPoints(before.points, after.points);
    },

    sharedWith: async (parent) => {
      const { rows } = await pool.query(
        "SELECT person FROM activity_shares WHERE gpx_filename = $1 ORDER BY person",
        [parent.gpxFilename],
      );
      return rows.map((r) => r.person);
    },

    // Heuristic-ranked type suggestions, computed live from stats already on
    // the row (no extra query) — see track/suggestType.js. Used by the
    // frontend to prioritize suggestions in the type-editing dropdown for
    // activities whose type fell back to "Unknown".
    suggestedActivityTypes: (parent) =>
      suggestActivityTypes({
        avgSpeedMps: parent.avgSpeedMps,
        maxSpeedMps: parent.maxSpeedMps,
        totalElevationGain: parent.totalElevationGain,
        totalElevationLoss: parent.totalElevationLoss,
        distanceMeters: parent.distanceMeters,
      }).map((r) => r.type),

    route: async (parent) => {
      const { rows } = await pool.query(
        "SELECT points_data, elevation_profile_data FROM activity_routes WHERE activity_id = $1",
        [parent.id],
      );
      const row = rows[0];
      return {
        coordinates: row?.points_data ?? [],
        elevationProfile: row?.elevation_profile_data ?? [],
        liftSegments: detectLiftSegments(row?.points_data ?? []),
      };
    },

    similarActivities: async (parent, _args, context) => {
      const { rows } = await pool.query(
        `
        WITH target AS (
          SELECT ST_Simplify(route_geom, $2) AS geom
          FROM activity_routes WHERE activity_id = $1
        ), scored AS (
          SELECT a.id, a.title, a.activity_type, a.start_time, a.distance_meters,
                 ST_HausdorffDistance(ST_Simplify(r.route_geom, $2), target.geom) * $4 AS hausdorff_meters
          FROM activity_routes r
          JOIN activities a ON a.id = r.activity_id
          CROSS JOIN target
          WHERE r.activity_id != $1 AND ${visibleTo("a", 5)}
        )
        SELECT * FROM scored
        WHERE hausdorff_meters <= $3
        ORDER BY hausdorff_meters ASC
        LIMIT 5
        `,
        [
          parent.id,
          SIMILAR_ROUTE_SIMPLIFY_TOLERANCE_DEGREES,
          SIMILAR_ROUTE_THRESHOLD_METERS,
          DEGREES_TO_METERS,
          personOf(context),
        ],
      );
      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        activityType: row.activity_type,
        startTime: row.start_time,
        distanceMeters: Number(row.distance_meters),
      }));
    },

    // "Previous"/"next" mean chronologically older/more recent by start_time,
    // matching the Dashboard's newest-first ordering (next = closer to now).
    // A plain neighbor lookup rather than fetching the whole activities list.
    previousActivityId: async (parent, _args, context) => {
      const { rows } = await pool.query(
        `SELECT id FROM activities a WHERE start_time < $1 AND ${visibleTo("a", 2)}
         ORDER BY start_time DESC LIMIT 1`,
        [parent.startTime, personOf(context)],
      );
      return rows[0]?.id ?? null;
    },

    nextActivityId: async (parent, _args, context) => {
      const { rows } = await pool.query(
        `SELECT id FROM activities a WHERE start_time > $1 AND ${visibleTo("a", 2)}
         ORDER BY start_time ASC LIMIT 1`,
        [parent.startTime, personOf(context)],
      );
      return rows[0]?.id ?? null;
    },

    // The activities() list query already joins a media count in (see
    // MAX_THUMBNAIL_POINTS_PER_ROUTE's neighboring LEFT JOIN LATERAL above),
    // avoiding an N+1 per dashboard row; activity(id) doesn't, so fall back
    // to a direct count for that single-activity case.
    mediaCount: async (parent) => {
      if (parent.mediaCount !== null && parent.mediaCount !== undefined) return parent.mediaCount;
      const { rows } = await pool.query(
        "SELECT COUNT(*) AS count FROM activity_media WHERE activity_id = $1",
        [parent.id],
      );
      return Number(rows[0].count);
    },

    media: async (parent) => {
      const { rows } = await pool.query(
        `SELECT id, immich_asset_id, asset_type, taken_at, lat, lon, duration_seconds
         FROM activity_media WHERE activity_id = $1 ORDER BY taken_at ASC`,
        [parent.id],
      );
      return rows.map((row) => ({
        id: row.id,
        immichAssetId: row.immich_asset_id,
        assetType: row.asset_type,
        takenAt: row.taken_at,
        lat: row.lat !== null ? Number(row.lat) : null,
        lon: row.lon !== null ? Number(row.lon) : null,
        durationSeconds: row.duration_seconds !== null ? Number(row.duration_seconds) : null,
      }));
    },
  },
};
