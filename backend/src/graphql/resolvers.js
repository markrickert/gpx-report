import path from "node:path";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { pool } from "../db.js";
import { reanalyzeAll, reanalyzeByDateRange, processFile } from "../gpx/processor.js";
import { updateGpxTitle, updateGpxType, trimGpxTrack } from "../gpx/writer.js";
import { updateSkizTitle, updateSkizType, trimSkizTrack } from "../skiz/writer.js";
import { activityTypeToRawType } from "../gpx/parser.js";
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

function sampleRoutePoints(points) {
  if (!points || points.length <= MAX_HEATMAP_POINTS_PER_ROUTE) return points ?? [];
  const step = points.length / MAX_HEATMAP_POINTS_PER_ROUTE;
  const sampled = [];
  for (let i = 0; i < MAX_HEATMAP_POINTS_PER_ROUTE; i++) {
    sampled.push(points[Math.floor(i * step)]);
  }
  return sampled;
}

export const resolvers = {
  DateTime: DateTimeScalar,
  JSON: JSONScalar,

  Query: {
    activity: async (_parent, { id }) => {
      const { rows } = await pool.query("SELECT * FROM activities WHERE id = $1", [id]);
      return rows[0] ? mapActivityRow(rows[0]) : null;
    },

    activities: async (_parent, { limit = 20, offset = 0, activityType, startDate, endDate }) => {
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
      params.push(limit, offset);

      const { rows } = await pool.query(
        `SELECT * FROM activities ${whereClause}
         ORDER BY start_time DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return rows.map(mapActivityRow);
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

    heatmapPoints: async () => {
      const { rows } = await pool.query("SELECT points_data FROM activity_routes");
      const points = [];
      for (const row of rows) {
        for (const p of sampleRoutePoints(row.points_data)) {
          points.push([p.lat, p.lon, p.elevation ?? null]);
        }
      }
      return points;
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
      };
    },
  },
};
