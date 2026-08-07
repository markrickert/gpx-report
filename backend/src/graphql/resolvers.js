import path from "node:path";
import os from "node:os";
import { writeFile, readFile, mkdir, copyFile, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { pool } from "../db.js";
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
} from "../gpx/writer.js";
import {
  updateSkizTitle,
  updateSkizType,
  trimSkizTrack,
  removeSkizTrackPoints,
} from "../skiz/writer.js";
import { removeIgcTrackPoints } from "../igc/writer.js";
import { activityTypeToRawType } from "../gpx/parser.js";
import { detectOutliers } from "../track/outliers.js";
import { detectLiftSegments } from "../track/liftDetection.js";
import { haversineMeters } from "../track/geo.js";
import { DateTimeScalar, JSONScalar } from "./scalars.js";

function mapActivityRow(row) {
  return {
    id: row.id,
    gpxFilename: row.gpx_filename,
    title: row.title,
    activityType: row.activity_type,
    startTime: row.start_time,
    endTime: row.end_time,
    durationSeconds: row.duration_seconds,
    distanceMeters: Number(row.distance_meters),
    avgSpeedMps: row.avg_speed_mps !== null ? Number(row.avg_speed_mps) : null,
    maxSpeedMps: row.max_speed_mps !== null ? Number(row.max_speed_mps) : null,
    totalElevationGain: row.total_elevation_gain !== null ? Number(row.total_elevation_gain) : null,
    totalElevationLoss: row.total_elevation_loss !== null ? Number(row.total_elevation_loss) : null,
    notes: row.notes,
  };
}

const GPX_FILES_DIRECTORY = process.env.GPX_FILES_DIRECTORY;

// code-server's home volume is bind-mounted read-write here so the
// dashboard's theme toggle can flip its VS Code Web color theme to match.
const CODE_SERVER_SETTINGS_PATH =
  process.env.CODE_SERVER_SETTINGS_PATH || "/code-server-home/share/code-server/User/settings.json";
const CODE_SERVER_COLOR_THEMES = {
  dark: "Default Dark+",
  light: "Default Light+",
};

// In-app GPS recording (Record.jsx) submits the full GPX XML it built
// client-side here for a plain disk write, reusing the existing watcher/
// processFile() pipeline rather than a parallel DB-insert code path. The
// filename is always generated server-side from a timestamp + random
// suffix — never derived from client input — since this is a new surface
// that writes an arbitrary client-submitted string to a file on disk, and a
// client-controlled filename/path would be a traversal/overwrite risk.
const MAX_RECORDED_GPX_BYTES = 10 * 1024 * 1024;

// Heatmap points are sent to the browser as [lat, lon, elevation] triples
// for every activity at once, so each route is capped/sampled rather than
// sent at full resolution (a few hundred activities at full GPS density
// would be tens of MB of JSON).
const MAX_HEATMAP_POINTS_PER_ROUTE = 300;

// heatmapPoints is expensive (scans every stored track point across all
// activities to sample it down) and rarely changes between requests, so
// cache the result for a few minutes instead of recomputing on every page
// load. Staleness up to HEATMAP_CACHE_TTL_MS after a new activity is
// ingested is acceptable for this personal, single-user app.
const HEATMAP_CACHE_TTL_MS = 5 * 60 * 1000;
let heatmapCache = null;

async function removeTrackPointsByFormat(filePath, filename, indices) {
  if (filename.endsWith(".skiz")) return removeSkizTrackPoints(filePath, indices);
  if (filename.endsWith(".igc")) return removeIgcTrackPoints(filePath, indices);
  if (filename.endsWith(".gpx")) return removeGpxTrackPoints(filePath, indices);
  throw new Error("Cleaning is only supported for .gpx, .skiz, and .igc files");
}

export const resolvers = {
  DateTime: DateTimeScalar,
  JSON: JSONScalar,

  Query: {
    activity: async (_parent, { id }) => {
      const { rows } = await pool.query("SELECT * FROM activities WHERE id = $1", [id]);
      return rows[0] ? mapActivityRow(rows[0]) : null;
    },

    activities: async (
      _parent,
      { limit = 20, offset = 0, activityType, startDate, endDate, search },
    ) => {
      const conditions = [];
      const params = [];

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

      const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      params.push(limit, offset);

      const { rows } = await pool.query(
        `SELECT * FROM activities ${whereClause}
         ORDER BY start_time DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return rows.map(mapActivityRow);
    },

    onThisDay: async () => {
      const { rows } = await pool.query(`
        SELECT * FROM activities
        WHERE EXTRACT(MONTH FROM start_time) = EXTRACT(MONTH FROM CURRENT_DATE)
          AND EXTRACT(DAY FROM start_time) = EXTRACT(DAY FROM CURRENT_DATE)
          AND EXTRACT(YEAR FROM start_time) <> EXTRACT(YEAR FROM CURRENT_DATE)
        ORDER BY start_time DESC
      `);
      return rows.map(mapActivityRow);
    },

    activityStreak: async () => {
      const { rows } = await pool.query(`
        SELECT DISTINCT DATE(start_time) AS day
        FROM activities
        ORDER BY day
      `);

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

    yearOverYearComparison: async () => {
      const { rows } = await pool.query(`
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
        FROM activities
      `);
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

    trainingLoad: async () => {
      const { rows } = await pool.query(`
        SELECT
          COALESCE(SUM(distance_meters) FILTER (
            WHERE start_time >= CURRENT_DATE - INTERVAL '6 days'
          ), 0) AS acute_distance_meters,
          COALESCE(SUM(distance_meters) FILTER (
            WHERE start_time >= CURRENT_DATE - INTERVAL '27 days'
          ), 0) AS chronic_28day_distance_meters
        FROM activities
      `);
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

    activitySummary: async () => {
      const { rows } = await pool.query(`
        SELECT
          COUNT(*)::int AS total_activities,
          COALESCE(SUM(distance_meters), 0) AS total_distance_meters,
          COALESCE(SUM(duration_seconds), 0)::bigint AS total_duration_seconds,
          COALESCE(SUM(total_elevation_gain), 0) AS total_elevation_gain_meters,
          MAX(updated_at) AS last_reanalysis
        FROM activities
      `);
      const row = rows[0];
      return {
        totalActivities: row.total_activities,
        totalDistanceMeters: Number(row.total_distance_meters),
        totalDurationSeconds: Number(row.total_duration_seconds),
        totalElevationGainMeters: Number(row.total_elevation_gain_meters),
        lastReanalysis: row.last_reanalysis,
      };
    },

    aggregatedStatsByType: async (_parent, { activityType, startDate, endDate }) => {
      const conditions = [];
      const params = [];

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
      const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

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
        FROM activities
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
    heatmapPoints: async () => {
      if (heatmapCache && Date.now() - heatmapCache.computedAt < HEATMAP_CACHE_TTL_MS) {
        return heatmapCache.points;
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
        JOIN lens l ON l.activity_id = r.activity_id,
        LATERAL jsonb_array_elements(r.points_data) WITH ORDINALITY AS e(elem, ord)
        WHERE (ord - 1) % GREATEST(1, l.len / $1) = 0
        `,
        [MAX_HEATMAP_POINTS_PER_ROUTE],
      );
      const points = rows[0]?.sampled ?? [];
      heatmapCache = { points, computedAt: Date.now() };
      return points;
    },

    activitiesWithOutliers: async () => {
      const { rows } = await pool.query(`
        SELECT a.id, a.title, a.activity_type, a.start_time, a.gpx_filename, r.points_data
        FROM activities a
        JOIN activity_routes r ON r.activity_id = a.id
      `);
      return rows
        .map((row) => ({
          activityId: row.id,
          title: row.title,
          activityType: row.activity_type,
          startTime: row.start_time,
          gpxFilename: row.gpx_filename,
          outlierPointCount: detectOutliers(row.points_data || []).length,
        }))
        .filter((r) => r.outlierPointCount > 0)
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
          cleanedDistanceMeters = parsed.distanceMeters;
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

    activitiesWithLiftSegments: async () => {
      const { rows } = await pool.query(`
        SELECT a.id, a.title, a.activity_type, a.start_time, r.points_data
        FROM activities a
        JOIN activity_routes r ON r.activity_id = a.id
      `);
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
  },

  Mutation: {
    reanalyzeAllActivities: async () => reanalyzeAll(GPX_FILES_DIRECTORY),
    reanalyzeActivitiesByDateRange: async (_parent, { startDate, endDate }) =>
      reanalyzeByDateRange(GPX_FILES_DIRECTORY, startDate, endDate),

    updateActivityTitle: async (_parent, { id, title }) => {
      const { rows } = await pool.query("SELECT gpx_filename FROM activities WHERE id = $1", [id]);
      if (!rows[0]) throw new Error(`Activity ${id} not found`);
      const filename = rows[0].gpx_filename.toLowerCase();
      if (!filename.endsWith(".gpx") && !filename.endsWith(".skiz")) {
        throw new Error("Editing is only supported for .gpx and .skiz files");
      }

      const filePath = path.join(GPX_FILES_DIRECTORY, rows[0].gpx_filename);
      await (filename.endsWith(".skiz") ? updateSkizTitle : updateGpxTitle)(filePath, title);
      await processFile(filePath);

      const { rows: updated } = await pool.query("SELECT * FROM activities WHERE id = $1", [id]);
      return mapActivityRow(updated[0]);
    },

    updateActivityNotes: async (_parent, { id, notes }) => {
      const { rows } = await pool.query(
        "UPDATE activities SET notes = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
        [notes, id],
      );
      if (!rows[0]) throw new Error(`Activity ${id} not found`);
      return mapActivityRow(rows[0]);
    },

    updateActivityType: async (_parent, { id, activityType }) => {
      const { rows } = await pool.query("SELECT gpx_filename FROM activities WHERE id = $1", [id]);
      if (!rows[0]) throw new Error(`Activity ${id} not found`);
      const filename = rows[0].gpx_filename.toLowerCase();
      if (!filename.endsWith(".gpx") && !filename.endsWith(".skiz")) {
        throw new Error("Editing is only supported for .gpx and .skiz files");
      }

      const filePath = path.join(GPX_FILES_DIRECTORY, rows[0].gpx_filename);
      if (filename.endsWith(".skiz")) {
        await updateSkizType(filePath, activityType);
      } else {
        await updateGpxType(filePath, activityTypeToRawType(activityType));
      }
      await processFile(filePath);

      const { rows: updated } = await pool.query("SELECT * FROM activities WHERE id = $1", [id]);
      return mapActivityRow(updated[0]);
    },

    trimActivity: async (_parent, { id, startIndex, endIndex }) => {
      const { rows } = await pool.query("SELECT gpx_filename FROM activities WHERE id = $1", [id]);
      if (!rows[0]) throw new Error(`Activity ${id} not found`);
      const filename = rows[0].gpx_filename.toLowerCase();
      if (!filename.endsWith(".gpx") && !filename.endsWith(".skiz")) {
        throw new Error("Editing is only supported for .gpx and .skiz files");
      }

      const filePath = path.join(GPX_FILES_DIRECTORY, rows[0].gpx_filename);
      await (filename.endsWith(".skiz") ? trimSkizTrack : trimGpxTrack)(
        filePath,
        startIndex,
        endIndex,
      );
      await processFile(filePath);

      const { rows: updated } = await pool.query("SELECT * FROM activities WHERE id = $1", [id]);
      return mapActivityRow(updated[0]);
    },

    saveRecordedActivity: async (_parent, { gpxContent }) => {
      if (typeof gpxContent !== "string" || gpxContent.trim().length === 0) {
        throw new Error("gpxContent must be a non-empty string");
      }
      if (Buffer.byteLength(gpxContent, "utf-8") > MAX_RECORDED_GPX_BYTES) {
        throw new Error("Recorded GPX content is too large");
      }
      if (!/<gpx[\s>]/i.test(gpxContent) || !/<trkpt\b/i.test(gpxContent)) {
        throw new Error("gpxContent does not look like a valid GPX track");
      }

      const filename = `recorded-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}.gpx`;
      await writeFile(path.join(GPX_FILES_DIRECTORY, filename), gpxContent, "utf-8");
      // Not processed synchronously here — the directory watcher (watcher.js)
      // picks the new file up and runs it through the same processFile()
      // path as any synced file. The frontend polls for the resulting
      // activity rather than blocking on it.
      return { filename };
    },

    cleanActivityOutliers: async (_parent, { id }) => {
      const { rows } = await pool.query("SELECT gpx_filename FROM activities WHERE id = $1", [id]);
      if (!rows[0]) throw new Error(`Activity ${id} not found`);
      const filename = rows[0].gpx_filename.toLowerCase();

      const { rows: routeRows } = await pool.query(
        "SELECT points_data FROM activity_routes WHERE activity_id = $1",
        [id],
      );
      const removedIndices = detectOutliers(routeRows[0]?.points_data || []);

      if (removedIndices.length > 0) {
        const filePath = path.join(GPX_FILES_DIRECTORY, rows[0].gpx_filename);
        await removeTrackPointsByFormat(filePath, filename, removedIndices);
        await processFile(filePath);
      }

      const { rows: updated } = await pool.query("SELECT * FROM activities WHERE id = $1", [id]);
      return mapActivityRow(updated[0]);
    },

    setCodeServerTheme: async (_parent, { theme }) => {
      const colorTheme = CODE_SERVER_COLOR_THEMES[theme];
      if (!colorTheme) throw new Error(`Unknown theme: ${theme}`);

      await mkdir(path.dirname(CODE_SERVER_SETTINGS_PATH), { recursive: true });
      let settings = {};
      try {
        settings = JSON.parse(await readFile(CODE_SERVER_SETTINGS_PATH, "utf-8"));
      } catch {
        settings = {};
      }
      settings["workbench.colorTheme"] = colorTheme;
      await writeFile(CODE_SERVER_SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8");
      return true;
    },
  },

  Activity: {
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
  },
};
