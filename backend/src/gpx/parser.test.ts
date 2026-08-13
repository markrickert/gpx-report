import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseGpxFile, activityTypeToRawType } from "./parser.js";

function gpx({ name, type, trkpts }: { name?: string; type?: string; trkpts: string[] }) {
  const trk = `<trk>${name ? `<name>${name}</name>` : ""}${type ? `<type>${type}</type>` : ""}<trkseg>${trkpts.join("")}</trkseg></trk>`;
  return `<?xml version="1.0"?><gpx version="1.1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><metadata></metadata>${trk}</gpx>`;
}

function trkpt(lat, lon, ele, time) {
  return `<trkpt lat="${lat}" lon="${lon}">${ele != null ? `<ele>${ele}</ele>` : ""}${time ? `<time>${time}</time>` : ""}</trkpt>`;
}

function trkptWithExt(
  lat,
  lon,
  ele,
  time,
  { hr, cad, atemp }: { hr?: number; cad?: number; atemp?: number } = {},
) {
  const ext = `<gpxtpx:TrackPointExtension>${hr != null ? `<gpxtpx:hr>${hr}</gpxtpx:hr>` : ""}${cad != null ? `<gpxtpx:cad>${cad}</gpxtpx:cad>` : ""}${atemp != null ? `<gpxtpx:atemp>${atemp}</gpxtpx:atemp>` : ""}</gpxtpx:TrackPointExtension>`;
  return `<trkpt lat="${lat}" lon="${lon}">${ele != null ? `<ele>${ele}</ele>` : ""}${time ? `<time>${time}</time>` : ""}<extensions>${ext}</extensions></trkpt>`;
}

describe("parseGpxFile", () => {
  let dir;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "gpx-parser-test-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeGpx(filename, content) {
    const filePath = path.join(dir, filename);
    await writeFile(filePath, content, "utf-8");
    return filePath;
  }

  it("computes distance/duration/speed from two timestamped points", async () => {
    const filePath = await writeGpx(
      "run.gpx",
      gpx({
        name: "Morning Run",
        type: "running",
        trkpts: [
          trkpt(0, 0, 100, "2024-01-01T00:00:00Z"),
          trkpt(0, 0.001, 110, "2024-01-01T00:01:00Z"),
        ],
      }),
    );

    const result = await parseGpxFile(filePath);

    expect(result.title).toBe("Morning Run");
    expect(result.activityType).toBe("Running");
    expect(result.durationSeconds).toBe(60);
    expect(result.distanceMeters).toBeGreaterThan(0);
    expect(result.avgSpeedMps).toBeCloseTo(result.distanceMeters / 60);
    expect(result.totalElevationGain).toBeCloseTo(10);
    expect(result.totalElevationLoss).toBeCloseTo(0);
    expect(result.points).toHaveLength(2);
  });

  it("falls back to the filename stem when <name> is missing", async () => {
    const filePath = await writeGpx(
      "unnamed-hike.gpx",
      gpx({
        trkpts: [
          trkpt(0, 0, 0, "2024-01-01T00:00:00Z"),
          trkpt(0, 0.001, 0, "2024-01-01T00:01:00Z"),
        ],
      }),
    );

    const result = await parseGpxFile(filePath);
    expect(result.title).toBe("unnamed-hike");
  });

  it("guesses activity type from filename when <type> is missing", async () => {
    const filePath = await writeGpx(
      "evening-hiking-trip.gpx",
      gpx({
        trkpts: [
          trkpt(0, 0, 0, "2024-01-01T00:00:00Z"),
          trkpt(0, 0.001, 0, "2024-01-01T00:01:00Z"),
        ],
      }),
    );

    const result = await parseGpxFile(filePath);
    expect(result.activityType).toBe("Hiking");
  });

  it("falls back to Unknown activity type when nothing matches and the track has no usable stats", async () => {
    // No timestamps, no elevation, and no movement between the two points
    // means avgSpeedMps/maxSpeedMps are null and elevation-gain/loss-per-km
    // can't be computed (zero distance), so the track-data heuristic (see
    // next test) has nothing to score and every candidate type ties at 0 —
    // Unknown is left as-is rather than picking an arbitrary tie-break.
    const filePath = await writeGpx(
      "track123.gpx",
      gpx({
        trkpts: [trkpt(0, 0, null, null), trkpt(0, 0, null, null)],
      }),
    );

    const result = await parseGpxFile(filePath);
    expect(result.activityType).toBe("Unknown");
  });

  it("suggests a likely activity type from track stats when the filename doesn't match either", async () => {
    // ~2.7 m/s over flat ground with no filename keyword match — squarely a
    // Running-shaped speed/elevation profile per track/suggestType.js's band
    // fit, so the parser should assign it instead of leaving it "Unknown".
    const filePath = await writeGpx(
      "track456.gpx",
      gpx({
        trkpts: [
          trkpt(0, 0, 100, "2024-01-01T00:00:00Z"),
          trkpt(0, 0.0027, 100, "2024-01-01T00:01:40Z"),
        ],
      }),
    );

    const result = await parseGpxFile(filePath);
    expect(result.activityType).toBe("Running");
  });

  it("maps a known raw <type> to its display label", async () => {
    const filePath = await writeGpx(
      "ride.gpx",
      gpx({
        type: "EMountainBikeRide",
        trkpts: [
          trkpt(0, 0, 0, "2024-01-01T00:00:00Z"),
          trkpt(0, 0.001, 0, "2024-01-01T00:01:00Z"),
        ],
      }),
    );

    const result = await parseGpxFile(filePath);
    expect(result.activityType).toBe("E-Mountain Bike Ride");
  });

  it("title-cases an unrecognized raw <type>", async () => {
    const filePath = await writeGpx(
      "custom.gpx",
      gpx({
        type: "backcountry_touring",
        trkpts: [
          trkpt(0, 0, 0, "2024-01-01T00:00:00Z"),
          trkpt(0, 0.001, 0, "2024-01-01T00:01:00Z"),
        ],
      }),
    );

    const result = await parseGpxFile(filePath);
    expect(result.activityType).toBe("Backcountry Touring");
  });

  it("returns null avgSpeedMps/duration 0 when points have no timestamps", async () => {
    const filePath = await writeGpx(
      "no-time.gpx",
      gpx({ trkpts: [trkpt(0, 0, 0, null), trkpt(0, 0.001, 0, null)] }),
    );

    const result = await parseGpxFile(filePath);
    expect(result.durationSeconds).toBe(0);
    expect(result.avgSpeedMps).toBeNull();
  });

  it("extracts hr/cad/atemp from gpxtpx:TrackPointExtension and computes avg/max hr", async () => {
    const filePath = await writeGpx(
      "hr-run.gpx",
      gpx({
        name: "HR Run",
        trkpts: [
          trkptWithExt(0, 0, 100, "2024-01-01T00:00:00Z", { hr: 140, cad: 80, atemp: 20 }),
          trkptWithExt(0, 0.001, 100, "2024-01-01T00:01:00Z", { hr: 160, cad: 85, atemp: 21 }),
        ],
      }),
    );

    const result = await parseGpxFile(filePath);
    expect(result.points[0]).toMatchObject({ hr: 140, cad: 80, atemp: 20 });
    expect(result.points[1]).toMatchObject({ hr: 160, cad: 85, atemp: 21 });
    expect(result.elevationProfile[0]).toMatchObject({ hr: 140, cad: 80, atemp: 20 });
    expect(result.avgHr).toBe(150);
    expect(result.maxHr).toBe(160);
  });

  it("returns null hr/cad/atemp and null avg/max hr when no extension data is present", async () => {
    const filePath = await writeGpx(
      "no-ext.gpx",
      gpx({
        trkpts: [
          trkpt(0, 0, 100, "2024-01-01T00:00:00Z"),
          trkpt(0, 0.001, 100, "2024-01-01T00:01:00Z"),
        ],
      }),
    );

    const result = await parseGpxFile(filePath);
    expect(result.points[0]).toMatchObject({ hr: null, cad: null, atemp: null });
    expect(result.avgHr).toBeNull();
    expect(result.maxHr).toBeNull();
  });

  it("throws when the file has fewer than two track points", async () => {
    const filePath = await writeGpx(
      "single-point.gpx",
      gpx({ trkpts: [trkpt(0, 0, 0, "2024-01-01T00:00:00Z")] }),
    );

    await expect(parseGpxFile(filePath)).rejects.toThrow(/does not contain enough track points/);
  });
});

describe("activityTypeToRawType", () => {
  it("reverses a known display label back to its raw <trk><type> value", () => {
    expect(activityTypeToRawType("Mountain Biking")).toBe("mountain_biking");
  });

  it("passes through labels with no known raw mapping unchanged", () => {
    expect(activityTypeToRawType("Backcountry Touring")).toBe("Backcountry Touring");
  });
});
