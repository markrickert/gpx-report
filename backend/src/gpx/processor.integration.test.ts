// Integration tests for processFile()/reanalyzeAll() against a real
// Postgres/PostGIS instance, spun up via testcontainers (the same
// postgis/postgis image docker-compose.yml uses for the live `db` service)
// rather than mocking `pg` — the upsert path, PostGIS geometry functions,
// and JSONB round-tripping are exactly the class of bug a `pg` mock would
// hide. Runs in a disposable container on a testcontainers-assigned random
// port, never the live deployment's Postgres (localhost:5432) — DATABASE_URL
// is only ever set here, in this file, to the container's own mapped port,
// and only after that container is up.
//
// Needs a Docker daemon reachable from the test runner (the Docker socket
// mounted in) to start the container — see the "test:integration" script
// and CLAUDE.md. Excluded from the default `npm test` run (vitest.config.ts)
// for that reason.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("../geocoding.js", () => ({ reverseGeocode: vi.fn() }));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const START_TIME = Date.parse("2024-01-01T00:00:00Z");
const METERS_PER_DEGREE_LAT = 111320;

function gpx(trkpts: string[]) {
  return `<?xml version="1.0"?><gpx version="1.1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><metadata></metadata><trk><name>Test Track</name><trkseg>${trkpts.join("")}</trkseg></trk></gpx>`;
}

function trkpt(lat: number, lon: number, ele: number, timeMs: number) {
  return `<trkpt lat="${lat}" lon="${lon}"><ele>${ele}</ele><time>${new Date(timeMs).toISOString()}</time></trkpt>`;
}

// Straight-line, steady-speed, steady-climb points — same shape
// liftDetection.test.ts uses to model a chairlift ride, since
// detectLiftSegments() is what elevation_gain_excluding_lift_meters depends
// on.
function liftPoints({
  count = 30,
  startLat = 45,
  startLon = 7,
  stepMeters = 5,
  climbPerStep = 2,
  startElevation = 1500,
  startTimeMs = START_TIME,
}) {
  const points: Array<{
    lat: number;
    lon: number;
    elevation: number;
    timestamp: number;
  }> = [];
  let t = startTimeMs;
  for (let i = 0; i < count; i++) {
    points.push({
      lat: startLat + (i * stepMeters) / METERS_PER_DEGREE_LAT,
      lon: startLon,
      elevation: startElevation + i * climbPerStep,
      timestamp: t,
    });
    t += 10_000;
    if (i === 15) t += 60_000; // mid-ride stop, still under the lift heuristic's stop cap
  }
  return points;
}

// Noisy, irregular-heading, irregular-elevation walk — same shape
// liftDetection.test.ts uses to model a hiker, so detectLiftSegments()
// should not flag any of it.
function hikerPoints({ count = 30, startLat = 46, startLon = 7, startTimeMs = START_TIME }) {
  const points: Array<{
    lat: number;
    lon: number;
    elevation: number;
    timestamp: number;
  }> = [];
  let lat = startLat;
  let lon = startLon;
  let elevation = 1500;
  let t = startTimeMs;
  for (let i = 0; i < count; i++) {
    lat += (i % 2 === 0 ? 1 : -1) * 0.00004;
    lon += 0.00003;
    elevation += i % 3 === 0 ? 8 : -5;
    points.push({ lat, lon, elevation, timestamp: t });
    t += (5 + (i % 4) * 7) * 1000;
  }
  return points;
}

function pointsToGpx(
  points: Array<{
    lat: number;
    lon: number;
    elevation: number;
    timestamp: number;
  }>,
) {
  return gpx(points.map((p) => trkpt(p.lat, p.lon, p.elevation, p.timestamp)));
}

// Straight line at a constant pace, long enough to exercise all three
// best-effort distances (1/5/10km) — 60 points, 200m/24s apart, 12km total
// at 8.33 m/s.
function pacePoints({ startLat = 50, startLon = 0, startTimeMs = START_TIME }) {
  const points: Array<{
    lat: number;
    lon: number;
    elevation: number;
    timestamp: number;
  }> = [];
  const stepMeters = 200;
  const stepSeconds = 24;
  let t = startTimeMs;
  for (let i = 0; i < 60; i++) {
    points.push({
      lat: startLat + (i * stepMeters) / METERS_PER_DEGREE_LAT,
      lon: startLon,
      elevation: 100,
      timestamp: t,
    });
    t += stepSeconds * 1000;
  }
  return points;
}

let container: StartedTestContainer;
let dir: string;
let pool: any;
let processFile: any;
let reanalyzeAll: any;
let reverseGeocode: any;

beforeAll(async () => {
  const initSql = await readFile(path.join(__dirname, "../../db/init.sql"), "utf-8");

  container = await new GenericContainer("postgis/postgis:15-3.4")
    .withEnvironment({
      POSTGRES_USER: "test",
      POSTGRES_PASSWORD: "test",
      POSTGRES_DB: "test",
    })
    .withCopyContentToContainer([
      { content: initSql, target: "/docker-entrypoint-initdb.d/init.sql" },
    ])
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .start();

  // Only ever pointed at the disposable container above, never the live
  // deployment's DATABASE_URL (which, if this ran outside this harness,
  // would point at localhost:5432 — testcontainers assigns its own random
  // host port, so this can't collide with or touch that database).
  process.env.DATABASE_URL = `postgresql://test:test@${container.getHost()}:${container.getMappedPort(5432)}/test`;

  ({ processFile, reanalyzeAll } = await import("./processor.js"));
  ({ pool } = await import("../db.js"));
  ({ reverseGeocode } = await import("../geocoding.js"));

  dir = await mkdtemp(path.join(tmpdir(), "processor-integration-test-"));
}, 60_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await pool.query("TRUNCATE activities CASCADE");
  vi.mocked(reverseGeocode).mockReset();
  vi.mocked(reverseGeocode).mockResolvedValue("Test Town");
});

async function writeGpxFile(filename: string, content: string) {
  const filePath = path.join(dir, filename);
  await writeFile(filePath, content, "utf-8");
  return filePath;
}

describe("processFile", () => {
  it("inserts a new activity + route on first ingest", async () => {
    const filePath = await writeGpxFile("insert-test.gpx", pointsToGpx(hikerPoints({})));

    const activityId = await processFile(filePath, { skipGeocode: true });

    const { rows } = await pool.query("SELECT * FROM activities WHERE id = $1", [activityId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].gpx_filename).toBe("insert-test.gpx");
    expect(rows[0].title).toBe("Test Track");

    const { rows: routeRows } = await pool.query(
      "SELECT * FROM activity_routes WHERE activity_id = $1",
      [activityId],
    );
    expect(routeRows).toHaveLength(1);
    expect(routeRows[0].points_data).toHaveLength(30);

    const { rows: countRows } = await pool.query("SELECT COUNT(*)::int FROM activities");
    expect(countRows[0].count).toBe(1);
  });

  it("updates the existing row via ON CONFLICT rather than duplicating it", async () => {
    const filename = "conflict-test.gpx";
    const filePath = await writeGpxFile(filename, pointsToGpx(hikerPoints({})));
    const firstId = await processFile(filePath, { skipGeocode: true });

    // Re-write the same filename with different track data (a longer,
    // steeper climb) and re-process.
    await writeFile(filePath, pointsToGpx(hikerPoints({ count: 40 })), "utf-8");
    const secondId = await processFile(filePath, { skipGeocode: true });

    expect(secondId).toBe(firstId);

    const { rows } = await pool.query("SELECT COUNT(*)::int FROM activities");
    expect(rows[0].count).toBe(1);

    const { rows: routeRows } = await pool.query(
      "SELECT points_data FROM activity_routes WHERE activity_id = $1",
      [firstId],
    );
    expect(routeRows[0].points_data).toHaveLength(40);
  });

  it("is idempotent: processing the same unchanged file twice yields the same end state", async () => {
    const filePath = await writeGpxFile("idempotent-test.gpx", pointsToGpx(hikerPoints({})));

    const firstId = await processFile(filePath, { skipGeocode: true });
    const { rows: firstRows } = await pool.query("SELECT * FROM activities WHERE id = $1", [
      firstId,
    ]);

    const secondId = await processFile(filePath, { skipGeocode: true });
    const { rows: secondRows } = await pool.query("SELECT * FROM activities WHERE id = $1", [
      secondId,
    ]);

    expect(secondId).toBe(firstId);
    const { rows: countRows } = await pool.query("SELECT COUNT(*)::int FROM activities");
    expect(countRows[0].count).toBe(1);

    // updated_at legitimately changes on every re-process; compare everything
    // else.
    const firstRest = { ...firstRows[0] };
    const secondRest = { ...secondRows[0] };
    delete firstRest.updated_at;
    delete secondRest.updated_at;
    expect(secondRest).toEqual(firstRest);
  });

  it("computes elevation_gain_excluding_lift_meters, subtracting detected lift-segment gain", async () => {
    const filePath = await writeGpxFile("lift-test.gpx", pointsToGpx(liftPoints({})));

    const activityId = await processFile(filePath, { skipGeocode: true });

    const { rows } = await pool.query(
      "SELECT total_elevation_gain, elevation_gain_excluding_lift_meters FROM activities WHERE id = $1",
      [activityId],
    );
    const { total_elevation_gain, elevation_gain_excluding_lift_meters } = rows[0];
    expect(Number(total_elevation_gain)).toBeGreaterThan(0);
    expect(Number(elevation_gain_excluding_lift_meters)).toBeLessThan(Number(total_elevation_gain));
  });

  it("leaves elevation_gain_excluding_lift_meters equal to total_elevation_gain when no lift segment is detected", async () => {
    const filePath = await writeGpxFile("no-lift-test.gpx", pointsToGpx(hikerPoints({})));

    const activityId = await processFile(filePath, { skipGeocode: true });

    const { rows } = await pool.query(
      "SELECT total_elevation_gain, elevation_gain_excluding_lift_meters FROM activities WHERE id = $1",
      [activityId],
    );
    expect(Number(rows[0].elevation_gain_excluding_lift_meters)).toBeCloseTo(
      Number(rows[0].total_elevation_gain),
    );
  });

  it("computes best_1km/5km/10km_seconds for a track long enough to cover them", async () => {
    const filePath = await writeGpxFile("pace-test.gpx", pointsToGpx(pacePoints({})));

    const activityId = await processFile(filePath, { skipGeocode: true });

    const { rows } = await pool.query(
      "SELECT best_1km_seconds, best_5km_seconds, best_10km_seconds FROM activities WHERE id = $1",
      [activityId],
    );
    const best1km = Number(rows[0].best_1km_seconds);
    const best5km = Number(rows[0].best_5km_seconds);
    const best10km = Number(rows[0].best_10km_seconds);
    // Constant ~200m/24s pace over a straight line: all three should resolve
    // (track covers 12km) to roughly 1x/5x/10x of the same per-km time.
    // Loose bounds rather than an exact constant, since the real distance
    // per step depends on gpxparser's own haversine calc, not the nominal
    // 200m used to build the fixture.
    expect(best1km).toBeGreaterThan(60);
    expect(best1km).toBeLessThan(200);
    // Window quantization (24s steps) means these aren't exact multiples of
    // best1km, just roughly proportional.
    expect(best5km).toBeGreaterThan(best1km * 4);
    expect(best5km).toBeLessThan(best1km * 6);
    expect(best10km).toBeGreaterThan(best1km * 8);
    expect(best10km).toBeLessThan(best1km * 12);
  });

  it("leaves best_*km_seconds null when the track never covers that distance", async () => {
    const filePath = await writeGpxFile("short-test.gpx", pointsToGpx(hikerPoints({})));

    const activityId = await processFile(filePath, { skipGeocode: true });

    const { rows } = await pool.query(
      "SELECT best_1km_seconds, best_5km_seconds, best_10km_seconds FROM activities WHERE id = $1",
      [activityId],
    );
    expect(rows[0].best_1km_seconds).toBeNull();
    expect(rows[0].best_5km_seconds).toBeNull();
    expect(rows[0].best_10km_seconds).toBeNull();
  });

  it("skips reverseGeocode entirely when skipGeocode is true", async () => {
    const filePath = await writeGpxFile("skip-geocode-test.gpx", pointsToGpx(hikerPoints({})));

    const activityId = await processFile(filePath, { skipGeocode: true });

    expect(reverseGeocode).not.toHaveBeenCalled();
    const { rows } = await pool.query("SELECT location_name FROM activities WHERE id = $1", [
      activityId,
    ]);
    expect(rows[0].location_name).toBeNull();
  });

  it("calls reverseGeocode and stores its result when skipGeocode is false (default)", async () => {
    const filePath = await writeGpxFile("geocode-test.gpx", pointsToGpx(hikerPoints({})));

    const activityId = await processFile(filePath);

    expect(reverseGeocode).toHaveBeenCalledTimes(1);
    const { rows } = await pool.query("SELECT location_name FROM activities WHERE id = $1", [
      activityId,
    ]);
    expect(rows[0].location_name).toBe("Test Town");
  });

  it("does not re-geocode a file that already has a location_name", async () => {
    const filePath = await writeGpxFile("already-geocoded-test.gpx", pointsToGpx(hikerPoints({})));

    await processFile(filePath); // first pass sets location_name
    expect(reverseGeocode).toHaveBeenCalledTimes(1);

    await processFile(filePath); // second pass, geocode not skipped, but already resolved
    expect(reverseGeocode).toHaveBeenCalledTimes(1);
  });
});

describe("processAll (via reanalyzeAll)", () => {
  it("processes every file in the directory in bounded-size batches, never exceeding 5 concurrent DB clients", async () => {
    const bulkDir = await mkdtemp(path.join(tmpdir(), "processor-bulk-test-"));
    const fileCount = 12;
    for (let i = 0; i < fileCount; i++) {
      await writeFile(
        path.join(bulkDir, `bulk-${i}.gpx`),
        pointsToGpx(hikerPoints({ startTimeMs: START_TIME + i * 3_600_000 })),
        "utf-8",
      );
    }

    let active = 0;
    let maxActive = 0;
    const originalConnect = pool.connect.bind(pool);
    const spy = vi.spyOn(pool, "connect").mockImplementation(async (...args: any[]) => {
      active++;
      maxActive = Math.max(maxActive, active);
      const client = await originalConnect(...args);
      const originalRelease = client.release.bind(client);
      client.release = (...releaseArgs: any[]) => {
        active--;
        return originalRelease(...releaseArgs);
      };
      return client;
    });

    const result = await reanalyzeAll(bulkDir);
    spy.mockRestore();

    expect(result.success).toBe(true);
    expect(maxActive).toBeLessThanOrEqual(5);

    const { rows } = await pool.query("SELECT COUNT(*)::int FROM activities");
    expect(rows[0].count).toBe(fileCount);

    await rm(bulkDir, { recursive: true, force: true });
  });
});
