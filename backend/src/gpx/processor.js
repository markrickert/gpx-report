import path from "node:path";
import { readdir } from "node:fs/promises";
import { pool } from "../db.js";
import { parseGpxFile } from "./parser.js";

function toLineStringWkt(points) {
  const coords = points.map((p) => `${p.lon} ${p.lat}`).join(", ");
  return `LINESTRING(${coords})`;
}

export async function processFile(filePath) {
  const filename = path.basename(filePath);
  const parsed = await parseGpxFile(filePath);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const activityResult = await client.query(
      `INSERT INTO activities (
         gpx_filename, activity_type, start_time, end_time, duration_seconds,
         distance_meters, avg_speed_mps, max_speed_mps, total_elevation_gain, total_elevation_loss, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW())
       ON CONFLICT (gpx_filename) DO UPDATE SET
         activity_type = EXCLUDED.activity_type,
         start_time = EXCLUDED.start_time,
         end_time = EXCLUDED.end_time,
         duration_seconds = EXCLUDED.duration_seconds,
         distance_meters = EXCLUDED.distance_meters,
         avg_speed_mps = EXCLUDED.avg_speed_mps,
         max_speed_mps = EXCLUDED.max_speed_mps,
         total_elevation_gain = EXCLUDED.total_elevation_gain,
         total_elevation_loss = EXCLUDED.total_elevation_loss,
         updated_at = NOW()
       RETURNING id`,
      [
        filename,
        parsed.activityType,
        parsed.startTime,
        parsed.endTime,
        parsed.durationSeconds,
        parsed.distanceMeters,
        parsed.avgSpeedMps,
        parsed.maxSpeedMps,
        parsed.totalElevationGain,
        parsed.totalElevationLoss,
      ]
    );
    const activityId = activityResult.rows[0].id;

    await client.query(
      `INSERT INTO activity_routes (activity_id, route_geom, elevation_profile_data, points_data)
       VALUES ($1, ST_GeomFromText($2, 4326), $3, $4)
       ON CONFLICT (activity_id) DO UPDATE SET
         route_geom = EXCLUDED.route_geom,
         elevation_profile_data = EXCLUDED.elevation_profile_data,
         points_data = EXCLUDED.points_data`,
      [
        activityId,
        toLineStringWkt(parsed.points),
        JSON.stringify(parsed.elevationProfile),
        JSON.stringify(parsed.points),
      ]
    );

    await client.query("COMMIT");
    return activityId;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function listGpxFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".gpx"))
    .map((e) => path.join(directory, e.name));
}

export async function reanalyzeAll(directory) {
  const files = await listGpxFiles(directory);
  const results = await Promise.allSettled(files.map((f) => processFile(f)));
  return summarize(files, results);
}

export async function reanalyzeByDateRange(directory, startDate, endDate) {
  const { rows } = await pool.query(
    `SELECT gpx_filename FROM activities WHERE start_time BETWEEN $1 AND $2`,
    [startDate, endDate]
  );
  const files = rows.map((r) => path.join(directory, r.gpx_filename));
  const results = await Promise.allSettled(files.map((f) => processFile(f)));
  return summarize(files, results);
}

function summarize(files, results) {
  const failures = results.filter((r) => r.status === "rejected");
  if (failures.length > 0) {
    console.error(
      `Re-analysis: ${failures.length}/${files.length} file(s) failed`,
      failures.map((f) => f.reason?.message)
    );
  }
  return {
    success: failures.length === 0,
    message: `Processed ${files.length - failures.length}/${files.length} file(s)${
      failures.length ? `; ${failures.length} failed` : ""
    }.`,
  };
}
