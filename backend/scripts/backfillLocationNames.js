// One-off backfill: reverse-geocodes location_name for existing activities
// that don't have one yet, using the start point of their route.
//
// Strictly sequential with a ~1.1s delay between requests (Nominatim caps at
// 1 req/s) — do NOT parallelize this. Run via:
//   docker compose exec backend node scripts/backfillLocationNames.js
import { pool } from "../src/db.js";
import { reverseGeocode } from "../src/geocoding.js";

const DELAY_MS = 1100;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const { rows } = await pool.query(
    `SELECT a.id, r.points_data
     FROM activities a
     JOIN activity_routes r ON r.activity_id = a.id
     WHERE a.location_name IS NULL
     ORDER BY a.id`,
  );

  console.log(`Backfilling location_name for ${rows.length} activity(ies)...`);

  let succeeded = 0;
  let failed = 0;

  for (const [i, row] of rows.entries()) {
    const points = row.points_data;
    const start = Array.isArray(points) && points.length > 0 ? points[0] : null;
    if (!start) {
      console.warn(`[${i + 1}/${rows.length}] Activity ${row.id}: no start point, skipping`);
      failed++;
      continue;
    }

    const locationName = await reverseGeocode(start.lat, start.lon);
    if (locationName) {
      await pool.query("UPDATE activities SET location_name = $1 WHERE id = $2", [
        locationName,
        row.id,
      ]);
      console.log(`[${i + 1}/${rows.length}] Activity ${row.id}: "${locationName}"`);
      succeeded++;
    } else {
      console.warn(`[${i + 1}/${rows.length}] Activity ${row.id}: lookup failed, left null`);
      failed++;
    }

    if (i < rows.length - 1) await sleep(DELAY_MS);
  }

  console.log(`Done. ${succeeded} succeeded, ${failed} failed/skipped.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
