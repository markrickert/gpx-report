import { pool } from "../db.js";
import { getImmichSettings } from "./settings.js";
import { searchMetadataByTimeWindow } from "./client.js";
import {
  assignMediaToActivities,
  isWithinWindow,
  type ActivityWindow,
  type ImmichCandidateAsset,
} from "./match.js";

// A photo taken right as a GPS track starts/ends recording can still belong
// to the activity — phone clocks and GPS timestamps aren't perfectly
// synced. 15 minutes matches the buffer named in docs/TODO.md's spec.
const CLOCK_SKEW_BUFFER_MS = 15 * 60 * 1000;

// Bounded concurrency against Immich's API and the Postgres pool, same
// reasoning/shape as gpx/processor.ts's processAll().
const CONCURRENCY = 5;

export interface ScanResult {
  scannedActivities: number;
  matchedAssets: number;
}

// Scans either the given activity ids, or (when omitted) every activity, for
// matching Immich photos/videos and upserts the results into
// activity_media. See docs/TODO.md's "Time-Primary Matching" spec.
export async function scanActivityMedia(activityIds?: number[]): Promise<ScanResult> {
  const settings = await getImmichSettings();
  if (!settings) {
    throw new Error("Immich is not configured (missing base URL or API key)");
  }

  const { rows } = await pool.query(
    activityIds && activityIds.length
      ? `SELECT id, start_time, end_time FROM activities WHERE id = ANY($1) ORDER BY start_time DESC`
      : `SELECT id, start_time, end_time FROM activities ORDER BY start_time DESC`,
    activityIds && activityIds.length ? [activityIds] : [],
  );

  const windows: ActivityWindow[] = rows.map((r) => ({
    activityId: r.id,
    startTime: r.start_time,
    endTime: r.end_time,
  }));
  const windowsByActivityId = new Map(windows.map((w) => [w.activityId, w]));

  const candidatesByActivity = new Map<number, ImmichCandidateAsset[]>();
  for (let i = 0; i < windows.length; i += CONCURRENCY) {
    const batch = windows.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (w) => {
        const takenAfter = new Date(
          new Date(w.startTime).getTime() - CLOCK_SKEW_BUFFER_MS,
        ).toISOString();
        const takenBefore = new Date(
          new Date(w.endTime).getTime() + CLOCK_SKEW_BUFFER_MS,
        ).toISOString();
        const assets = await searchMetadataByTimeWindow(settings, takenAfter, takenBefore);
        candidatesByActivity.set(
          w.activityId,
          assets.filter((a) => isWithinWindow(a.takenAt, w, CLOCK_SKEW_BUFFER_MS)),
        );
      }),
    );
  }

  const overlapDistances = await computeOverlapDistances(candidatesByActivity);

  const assigned = assignMediaToActivities(
    candidatesByActivity,
    windowsByActivityId,
    (activityId, lat, lon) => overlapDistances.get(overlapKey(activityId, lat, lon)) ?? null,
  );

  for (const media of assigned) {
    await pool.query(
      `INSERT INTO activity_media (activity_id, immich_asset_id, asset_type, taken_at, lat, lon, duration_seconds)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (activity_id, immich_asset_id) DO UPDATE SET
         asset_type = EXCLUDED.asset_type,
         taken_at = EXCLUDED.taken_at,
         lat = EXCLUDED.lat,
         lon = EXCLUDED.lon,
         duration_seconds = EXCLUDED.duration_seconds`,
      [
        media.activityId,
        media.immichAssetId,
        media.assetType,
        media.takenAt,
        media.lat,
        media.lon,
        media.durationSeconds,
      ],
    );
  }

  return { scannedActivities: windows.length, matchedAssets: assigned.length };
}

function overlapKey(activityId: number, lat: number, lon: number) {
  return `${activityId}:${lat},${lon}`;
}

// For assets that landed inside more than one activity's window (same-day
// overlapping tracks), compute the real distance from the asset's GPS to
// each candidate activity's route via PostGIS — only for that rare overlap
// case, not for every match, since ST_Distance is comparatively expensive.
async function computeOverlapDistances(
  candidatesByActivity: Map<number, ImmichCandidateAsset[]>,
): Promise<Map<string, number>> {
  const activityIdsByAsset = new Map<string, Set<number>>();
  const assetById = new Map<string, ImmichCandidateAsset>();
  for (const [activityId, assets] of candidatesByActivity) {
    for (const asset of assets) {
      assetById.set(asset.immichAssetId, asset);
      const set = activityIdsByAsset.get(asset.immichAssetId) ?? new Set<number>();
      set.add(activityId);
      activityIdsByAsset.set(asset.immichAssetId, set);
    }
  }

  const distances = new Map<string, number>();
  for (const [assetId, activityIds] of activityIdsByAsset) {
    if (activityIds.size < 2) continue;
    const asset = assetById.get(assetId)!;
    if (asset.lat == null || asset.lon == null) continue;

    for (const activityId of activityIds) {
      const { rows } = await pool.query(
        `SELECT ST_Distance(route_geom::geography, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography) AS dist
         FROM activity_routes WHERE activity_id = $1`,
        [activityId, asset.lon, asset.lat],
      );
      if (rows[0]?.dist != null) {
        distances.set(overlapKey(activityId, asset.lat, asset.lon), Number(rows[0].dist));
      }
    }
  }
  return distances;
}
