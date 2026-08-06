import path from "node:path";
import { pool } from "../db.js";
import { reanalyzeAll, reanalyzeByDateRange, processFile } from "../gpx/processor.js";
import { updateGpxTitle, updateGpxType, trimGpxTrack } from "../gpx/writer.js";
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
        params
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

      const { rows } = await pool.query(`
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
      `, params);

      return rows.map((row) => ({
        activityType: row.activity_type,
        count: row.count,
        totalDistanceMeters: Number(row.total_distance_meters),
        totalDurationSeconds: Number(row.total_duration_seconds),
        averageDistanceMeters: Number(row.average_distance_meters),
        averageDurationSeconds: Number(row.average_duration_seconds),
        averageElevationGainMeters:
          row.average_elevation_gain_meters !== null ? Number(row.average_elevation_gain_meters) : null,
      }));
    },
  },

  Mutation: {
    reanalyzeAllActivities: async () => reanalyzeAll(GPX_FILES_DIRECTORY),
    reanalyzeActivitiesByDateRange: async (_parent, { startDate, endDate }) =>
      reanalyzeByDateRange(GPX_FILES_DIRECTORY, startDate, endDate),

    updateActivityTitle: async (_parent, { id, title }) => {
      const { rows } = await pool.query("SELECT gpx_filename FROM activities WHERE id = $1", [id]);
      if (!rows[0]) throw new Error(`Activity ${id} not found`);
      if (!rows[0].gpx_filename.toLowerCase().endsWith(".gpx")) {
        throw new Error("Editing is only supported for .gpx files");
      }

      const filePath = path.join(GPX_FILES_DIRECTORY, rows[0].gpx_filename);
      await updateGpxTitle(filePath, title);
      await processFile(filePath);

      const { rows: updated } = await pool.query("SELECT * FROM activities WHERE id = $1", [id]);
      return mapActivityRow(updated[0]);
    },

    updateActivityType: async (_parent, { id, activityType }) => {
      const { rows } = await pool.query("SELECT gpx_filename FROM activities WHERE id = $1", [id]);
      if (!rows[0]) throw new Error(`Activity ${id} not found`);
      if (!rows[0].gpx_filename.toLowerCase().endsWith(".gpx")) {
        throw new Error("Editing is only supported for .gpx files");
      }

      const filePath = path.join(GPX_FILES_DIRECTORY, rows[0].gpx_filename);
      await updateGpxType(filePath, activityTypeToRawType(activityType));
      await processFile(filePath);

      const { rows: updated } = await pool.query("SELECT * FROM activities WHERE id = $1", [id]);
      return mapActivityRow(updated[0]);
    },

    trimActivity: async (_parent, { id, startIndex, endIndex }) => {
      const { rows } = await pool.query("SELECT gpx_filename FROM activities WHERE id = $1", [id]);
      if (!rows[0]) throw new Error(`Activity ${id} not found`);
      if (!rows[0].gpx_filename.toLowerCase().endsWith(".gpx")) {
        throw new Error("Editing is only supported for .gpx files");
      }

      const filePath = path.join(GPX_FILES_DIRECTORY, rows[0].gpx_filename);
      await trimGpxTrack(filePath, startIndex, endIndex);
      await processFile(filePath);

      const { rows: updated } = await pool.query("SELECT * FROM activities WHERE id = $1", [id]);
      return mapActivityRow(updated[0]);
    },
  },

  Activity: {
    route: async (parent) => {
      const { rows } = await pool.query(
        "SELECT points_data, elevation_profile_data FROM activity_routes WHERE activity_id = $1",
        [parent.id]
      );
      const row = rows[0];
      return {
        coordinates: row?.points_data ?? [],
        elevationProfile: row?.elevation_profile_data ?? [],
      };
    },
  },
};
