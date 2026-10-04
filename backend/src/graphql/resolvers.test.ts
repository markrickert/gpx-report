import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";

vi.mock("../db.js", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../track/outliers.js", () => ({ detectOutliers: vi.fn() }));
vi.mock("../track/liftDetection.js", () => ({
  detectLiftSegments: vi.fn(),
  totalsExcludingLifts: vi.fn((parsed) => parsed),
}));
vi.mock("../gpx/processor.js", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return { ...actual, processFile: vi.fn() };
});
vi.mock("../track/geo.js", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return { ...actual, computeTrackStats: vi.fn() };
});

const { pool } = (await import("../db.js")) as any;
const { detectOutliers } = (await import("../track/outliers.js")) as any;
const { detectLiftSegments } = (await import("../track/liftDetection.js")) as any;
const { computeTrackStats } = (await import("../track/geo.js")) as any;
const { processFile } = (await import("../gpx/processor.js")) as any;
const { backupFile } = await import("../backup.js");
process.env.GPX_FILES_DIRECTORY = mkdtempSync(path.join(tmpdir(), "resolvers-test-"));
const { resolvers } = await import("./resolvers.js");

const { activityStreak, yearOverYearComparison, trainingLoad, personalRecordsByType } =
  resolvers.Query;
const { activitiesWithOutliers, activitiesWithLiftSegments } = resolvers.Query;

const mark = { person: "mark" };
const kristin = { person: "kristin" };

describe("activityStreak", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("finds the longest run of consecutive days, ignoring gaps", async () => {
    pool.query.mockResolvedValue({
      rows: [
        { day: "2026-01-01" },
        { day: "2026-01-02" },
        { day: "2026-01-03" },
        // gap
        { day: "2026-01-10" },
        { day: "2026-01-11" },
      ],
    });
    vi.setSystemTime(new Date("2026-06-01T00:00:00Z"));

    const result = await activityStreak(null, {}, mark);
    expect(result.longestStreakDays).toBe(3);
  });

  it("reports a live current streak when the last activity was today", async () => {
    pool.query.mockResolvedValue({
      rows: [{ day: "2026-08-08" }, { day: "2026-08-09" }, { day: "2026-08-10" }],
    });
    vi.setSystemTime(new Date("2026-08-10T15:00:00Z"));

    const result = await activityStreak(null, {}, mark);
    expect(result.currentStreakDays).toBe(3);
    expect(result.longestStreakDays).toBe(3);
  });

  it("reports a live current streak when the last activity was yesterday", async () => {
    pool.query.mockResolvedValue({
      rows: [{ day: "2026-08-08" }, { day: "2026-08-09" }],
    });
    vi.setSystemTime(new Date("2026-08-10T15:00:00Z"));

    const result = await activityStreak(null, {}, mark);
    expect(result.currentStreakDays).toBe(2);
  });

  it("resets the current streak to 0 once more than a full day has passed", async () => {
    pool.query.mockResolvedValue({
      rows: [{ day: "2026-08-01" }, { day: "2026-08-02" }],
    });
    vi.setSystemTime(new Date("2026-08-10T15:00:00Z"));

    const result = await activityStreak(null, {}, mark);
    expect(result.currentStreakDays).toBe(0);
    expect(result.longestStreakDays).toBe(2);
  });

  it("returns zeros when there are no activities", async () => {
    pool.query.mockResolvedValue({ rows: [] });
    vi.setSystemTime(new Date("2026-08-10T15:00:00Z"));

    const result = await activityStreak(null, {}, mark);
    expect(result).toEqual({ currentStreakDays: 0, longestStreakDays: 0 });
  });
});

describe("yearOverYearComparison", () => {
  it("maps current/previous year rows and converts numeric strings to numbers", async () => {
    pool.query.mockResolvedValue({
      rows: [
        {
          current_year: 2026,
          previous_year: 2025,
          current_count: 10,
          current_distance_meters: "50000.5",
          current_elevation_gain_meters: "1200",
          previous_count: 8,
          previous_distance_meters: "40000",
          previous_elevation_gain_meters: "900.25",
        },
      ],
    });

    const result = await yearOverYearComparison(null, {}, mark);

    expect(result).toEqual({
      currentYear: {
        year: 2026,
        activityCount: 10,
        totalDistanceMeters: 50000.5,
        totalElevationGainMeters: 1200,
      },
      previousYear: {
        year: 2025,
        activityCount: 8,
        totalDistanceMeters: 40000,
        totalElevationGainMeters: 900.25,
      },
    });
  });
});

describe("trainingLoad", () => {
  it("labels 'ramping up' when acute load exceeds 1.5x chronic weekly average", async () => {
    // chronic weekly avg = 28-day total / 4 = 700; acute = 1200 -> ratio 1200/700 ≈ 1.714
    pool.query.mockResolvedValue({
      rows: [{ acute_distance_meters: "1200", chronic_28day_distance_meters: "2800" }],
    });

    const result = await trainingLoad(null, {}, mark);
    expect(result.ratio).toBeCloseTo(1200 / 700, 5);
    expect(result.label).toBe("ramping up");
  });

  it("labels 'detraining' when acute load is below 0.8x chronic weekly average", async () => {
    // chronic weekly avg = 2800/4 = 700; acute = 100 -> ratio ≈ 0.143
    pool.query.mockResolvedValue({
      rows: [{ acute_distance_meters: "100", chronic_28day_distance_meters: "2800" }],
    });

    const result = await trainingLoad(null, {}, mark);
    expect(result.ratio).toBeCloseTo(100 / 700, 5);
    expect(result.label).toBe("detraining");
  });

  it("labels 'steady' when acute load is within [0.8, 1.5]x chronic weekly average", async () => {
    // chronic weekly avg = 2800/4 = 700; acute = 700 -> ratio 1
    pool.query.mockResolvedValue({
      rows: [{ acute_distance_meters: "700", chronic_28day_distance_meters: "2800" }],
    });

    const result = await trainingLoad(null, {}, mark);
    expect(result.ratio).toBe(1);
    expect(result.label).toBe("steady");
  });

  it("returns a null ratio and 'steady' label when chronic distance is zero", async () => {
    pool.query.mockResolvedValue({
      rows: [{ acute_distance_meters: "0", chronic_28day_distance_meters: "0" }],
    });

    const result = await trainingLoad(null, {}, mark);
    expect(result.ratio).toBeNull();
    expect(result.label).toBe("steady");
  });
});

describe("personalRecordsByType", () => {
  it("maps a row with all fields present", async () => {
    pool.query.mockResolvedValue({
      rows: [
        {
          activity_type: "Running",
          longest_distance_meters: "10000",
          biggest_elevation_gain_meters: "150.5",
          best_1km_seconds: "240",
          best_5km_seconds: "1300",
          best_10km_seconds: "2700",
        },
      ],
    });

    const result = await personalRecordsByType(null, {}, mark);
    expect(result).toEqual([
      {
        activityType: "Running",
        longestDistanceMeters: 10000,
        biggestElevationGainMeters: 150.5,
        best1kmSeconds: 240,
        best5kmSeconds: 1300,
        best10kmSeconds: 2700,
      },
    ]);
  });

  // An activity type with no elevation data at all (MAX over all-NULL rows is
  // NULL) still comes back as null rather than NaN, while distances still
  // convert normally.
  it("passes through null for fields with no qualifying activity, without fallback error", async () => {
    pool.query.mockResolvedValue({
      rows: [
        {
          activity_type: "Skiing",
          longest_distance_meters: "5000",
          biggest_elevation_gain_meters: null,
          best_1km_seconds: null,
          best_5km_seconds: null,
          best_10km_seconds: null,
        },
      ],
    });

    const result = await personalRecordsByType(null, {}, mark);
    expect(result).toEqual([
      {
        activityType: "Skiing",
        longestDistanceMeters: 5000,
        biggestElevationGainMeters: null,
        best1kmSeconds: null,
        best5kmSeconds: null,
        best10kmSeconds: null,
      },
    ]);
  });
});

describe("activitiesWithLiftSegments", () => {
  beforeEach(() => {
    detectLiftSegments.mockReset();
  });

  it("excludes activities with no detected lift segments and sorts the rest by total gain descending", async () => {
    pool.query.mockResolvedValue({
      rows: [
        { id: 1, title: "No lifts", activity_type: "Hiking", start_time: "t1", points_data: [] },
        { id: 2, title: "Small lift", activity_type: "Skiing", start_time: "t2", points_data: [] },
        { id: 3, title: "Big lift", activity_type: "Skiing", start_time: "t3", points_data: [] },
      ],
    });
    detectLiftSegments
      .mockReturnValueOnce([]) // activity 1: no lifts
      .mockReturnValueOnce([{ elevationGainMeters: 100 }]) // activity 2
      .mockReturnValueOnce([{ elevationGainMeters: 300 }, { elevationGainMeters: 50 }]); // activity 3

    const result = await activitiesWithLiftSegments(null, {}, mark);

    expect(result.map((r) => r.activityId)).toEqual([3, 2]);
    expect(result[0].liftSegmentCount).toBe(2);
    expect(result[0].totalLiftElevationGainMeters).toBe(350);
    expect(result[1].totalLiftElevationGainMeters).toBe(100);
  });

  it("clamps negative segment elevation gains to 0 rather than letting them reduce the total", async () => {
    pool.query.mockResolvedValue({
      rows: [{ id: 1, title: "Mixed", activity_type: "Skiing", start_time: "t1", points_data: [] }],
    });
    detectLiftSegments.mockReturnValueOnce([
      { elevationGainMeters: 100 },
      { elevationGainMeters: -40 },
    ]);

    const result = await activitiesWithLiftSegments(null, {}, mark);
    expect(result[0].totalLiftElevationGainMeters).toBe(100);
  });
});

describe("activitiesWithOutliers", () => {
  beforeEach(() => {
    detectOutliers.mockReset();
    computeTrackStats.mockReset();
  });

  it("excludes activities whose distance delta doesn't clear the 100m threshold", async () => {
    pool.query.mockResolvedValue({
      rows: [
        {
          id: 1,
          title: "Small blip",
          activity_type: "Running",
          start_time: "t1",
          gpx_filename: "a.gpx",
          points_data: [{ lat: 0, lon: 0 }],
        },
        {
          id: 2,
          title: "Real outlier",
          activity_type: "Running",
          start_time: "t2",
          gpx_filename: "b.gpx",
          points_data: [{ lat: 0, lon: 0 }],
        },
      ],
    });
    detectOutliers.mockReturnValueOnce([0]).mockReturnValueOnce([0]);
    computeTrackStats
      // activity 1: original then cleaned - delta 50 (below threshold)
      .mockReturnValueOnce({ distanceMeters: 1050 })
      .mockReturnValueOnce({ distanceMeters: 1000 })
      // activity 2: delta 500 (above threshold)
      .mockReturnValueOnce({ distanceMeters: 2500 })
      .mockReturnValueOnce({ distanceMeters: 2000 });

    const result = await activitiesWithOutliers(null, {}, mark);

    expect(result.map((r) => r.activityId)).toEqual([2]);
    expect(result[0].distanceDeltaMeters).toBe(500);
  });

  it("skips the distance comparison entirely and reports 0 delta when nothing was flagged", async () => {
    pool.query.mockResolvedValue({
      rows: [
        {
          id: 1,
          title: "Clean",
          activity_type: "Running",
          start_time: "t1",
          gpx_filename: "a.gpx",
          points_data: [{ lat: 0, lon: 0 }],
        },
      ],
    });
    detectOutliers.mockReturnValueOnce([]);

    const result = await activitiesWithOutliers(null, {}, mark);

    expect(result).toEqual([]);
    expect(computeTrackStats).not.toHaveBeenCalled();
  });

  it("sorts surviving activities by outlier point count descending", async () => {
    pool.query.mockResolvedValue({
      rows: [
        {
          id: 1,
          title: "Fewer outliers",
          activity_type: "Running",
          start_time: "t1",
          gpx_filename: "a.gpx",
          points_data: [{ lat: 0, lon: 0 }],
        },
        {
          id: 2,
          title: "More outliers",
          activity_type: "Running",
          start_time: "t2",
          gpx_filename: "b.gpx",
          points_data: [{ lat: 0, lon: 0 }],
        },
      ],
    });
    detectOutliers.mockReturnValueOnce([0]).mockReturnValueOnce([0, 1]);
    computeTrackStats
      .mockReturnValueOnce({ distanceMeters: 1500 })
      .mockReturnValueOnce({ distanceMeters: 1000 })
      .mockReturnValueOnce({ distanceMeters: 3000 })
      .mockReturnValueOnce({ distanceMeters: 1000 });

    const result = await activitiesWithOutliers(null, {}, mark);

    expect(result.map((r) => r.activityId)).toEqual([2, 1]);
  });
});

describe("saveRecordedActivity", () => {
  const { saveRecordedActivity } = resolvers.Mutation;
  const gpx = (name: string) =>
    `<gpx><trk><name>${name}</name><trkseg><trkpt lat="1" lon="2"></trkpt></trkseg></trk></gpx>`;

  it("writes a clientId upload into the recorder's folder under a stable filename and ignores retries", async () => {
    const clientId = "0b6f3c2e-9a1d-4c7e-8f00-123456789abc";
    const first = await saveRecordedActivity(null, { gpxContent: gpx("first"), clientId }, kristin);
    const retry = await saveRecordedActivity(null, { gpxContent: gpx("retry"), clientId }, kristin);

    expect(first.filename).toBe(`kristin/recorded-${clientId}.gpx`);
    expect(retry.filename).toBe(first.filename);
    const written = readFileSync(
      path.join(process.env.GPX_FILES_DIRECTORY, first.filename),
      "utf-8",
    );
    expect(written).toContain("first");
  });

  it("generates a unique filename per call without a clientId", async () => {
    const a = await saveRecordedActivity(null, { gpxContent: gpx("a"), clientId: null }, mark);
    const b = await saveRecordedActivity(null, { gpxContent: gpx("b"), clientId: null }, mark);
    expect(a.filename).not.toBe(b.filename);
    expect(readdirSync(path.join(process.env.GPX_FILES_DIRECTORY, "mark"))).toEqual(
      expect.arrayContaining([path.basename(a.filename), path.basename(b.filename)]),
    );
  });

  it("rejects a clientId that could escape the filename", async () => {
    await expect(
      saveRecordedActivity(null, { gpxContent: gpx("x"), clientId: "../../etc/passwd" }, mark),
    ).rejects.toThrow(/clientId/);
  });
});

// A minimal GraphQLResolveInfo whose query selected these fields.
function selecting(...fields: string[]) {
  return {
    fieldNodes: [
      {
        selectionSet: {
          selections: fields.map((f) => ({ kind: "Field", name: { value: f } })),
        },
      },
    ],
  } as any;
}

describe("visibility", () => {
  beforeEach(() => {
    pool.query.mockReset();
  });

  it("scopes queries to the requesting person", async () => {
    pool.query.mockResolvedValue({ rows: [] });
    await resolvers.Query.activities(null, {} as any, kristin, selecting("id"));
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(
      /a\.owner = \$1 OR a\.gpx_filename IN \(SELECT gpx_filename FROM activity_shares/,
    );
    expect(params[0]).toBe("kristin");
  });

  it("only samples route thumbnails when routeThumbnail is selected", async () => {
    pool.query.mockResolvedValue({ rows: [] });
    await resolvers.Query.activities(null, { limit: 5 } as any, kristin, selecting("id"));
    await resolvers.Query.activities(
      null,
      { limit: 5 } as any,
      kristin,
      selecting("id", "routeThumbnail"),
    );
    const [[plainSql, plainParams], [thumbSql, thumbParams]] = pool.query.mock.calls;
    expect(plainSql).not.toMatch(/activity_routes/);
    expect(plainParams).toEqual(["kristin", 5, 0]);
    expect(thumbSql).toMatch(/activity_routes/);
    expect(thumbParams).toEqual(["kristin", 60, 5, 0]);
  });

  it("returns null for an activity the person can't see", async () => {
    pool.query.mockResolvedValue({ rows: [] });
    expect(await resolvers.Query.activity(null, { id: "1" }, kristin)).toBeNull();
    expect(pool.query.mock.calls[0][1]).toEqual(["1", "kristin"]);
  });
});

describe("ownership", () => {
  const { updateActivityNotes, deleteActivity, setActivitySharedWith } = resolvers.Mutation;

  beforeEach(() => {
    pool.query.mockReset();
    pool.connect.mockReset();
  });

  it("rejects edits from anyone but the owner", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ gpx_filename: "ride.gpx", owner: "mark" }] });
    await expect(updateActivityNotes(null, { id: "1", notes: "hi" }, kristin)).rejects.toThrow(
      "Only mark can edit this activity",
    );
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it("lets a share recipient delete only their share, leaving the file and row", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ gpx_filename: "ride.gpx", owner: "mark" }] })
      .mockResolvedValueOnce({ rowCount: 1 });

    expect(await deleteActivity(null, { id: "1" }, kristin)).toBe(true);
    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(pool.query.mock.calls[1]).toEqual([
      "DELETE FROM activity_shares WHERE gpx_filename = $1 AND person = $2",
      ["ride.gpx", "kristin"],
    ]);
  });

  it("rejects a delete from someone it isn't shared with", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ gpx_filename: "ride.gpx", owner: "mark" }] })
      .mockResolvedValueOnce({ rowCount: 0 });
    await expect(deleteActivity(null, { id: "1" }, kristin)).rejects.toThrow(/Only mark/);
  });

  describe("setActivitySharedWith", () => {
    let client;

    beforeEach(async () => {
      mkdirSync(path.join(process.env.GPX_FILES_DIRECTORY, "kristin"), { recursive: true });
      client = { query: vi.fn().mockResolvedValue({}), release: vi.fn() };
      pool.connect.mockResolvedValue(client);
    });

    it("replaces the share set for known people", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ gpx_filename: "ride.gpx", owner: "mark" }] })
        .mockResolvedValueOnce({ rows: [{ id: 1, gpx_filename: "ride.gpx", owner: "mark" }] });

      const result = await setActivitySharedWith(null, { id: "1", people: ["Kristin"] }, mark);

      expect(result.owner).toBe("mark");
      expect(client.query).toHaveBeenCalledWith(
        "INSERT INTO activity_shares (gpx_filename, person) VALUES ($1, $2)",
        ["ride.gpx", "kristin"],
      );
      expect(client.query).toHaveBeenLastCalledWith("COMMIT");
    });

    it("rejects unknown people and the owner themselves", async () => {
      pool.query.mockResolvedValue({ rows: [{ gpx_filename: "ride.gpx", owner: "mark" }] });
      await expect(
        setActivitySharedWith(null, { id: "1", people: ["nobody"] }, mark),
      ).rejects.toThrow(/Unknown person/);
      await expect(
        setActivitySharedWith(null, { id: "1", people: ["mark"] }, mark),
      ).rejects.toThrow(/owner/);
      expect(pool.connect).not.toHaveBeenCalled();
    });

    it("rejects a non-owner", async () => {
      pool.query.mockResolvedValue({ rows: [{ gpx_filename: "ride.gpx", owner: "mark" }] });
      await expect(
        setActivitySharedWith(null, { id: "1", people: ["mark"] }, kristin),
      ).rejects.toThrow(/Only mark/);
    });
  });
});

describe("original file", () => {
  const { restoreActivityOriginal, deleteActivity } = resolvers.Mutation;
  const dir = () => process.env.GPX_FILES_DIRECTORY;

  beforeEach(() => {
    pool.query.mockReset();
    processFile.mockReset();
  });

  it("reports trackEdited only once the points change, not for a title edit", async () => {
    const gpx = (name, points) =>
      `<?xml version="1.0"?><gpx version="1.1" creator="test"><trk><name>${name}</name><trkseg>${points
        .map(([lat, lon]) => `<trkpt lat="${lat}" lon="${lon}"><ele>100</ele></trkpt>`)
        .join("")}</trkseg></trk></gpx>`;
    const filePath = path.join(dir(), "fresh.gpx");
    const points = [
      [39.0, -105.0],
      [39.001, -105.001],
      [39.002, -105.002],
    ];
    writeFileSync(filePath, gpx("Walk", points));
    expect(await resolvers.Activity.trackEdited({ gpxFilename: "fresh.gpx" })).toBe(false);

    await backupFile(filePath);
    writeFileSync(filePath, gpx("Renamed walk", points));
    expect(await resolvers.Activity.trackEdited({ gpxFilename: "fresh.gpx" })).toBe(false);

    await backupFile(filePath);
    writeFileSync(filePath, gpx("Renamed walk", points.slice(1)));
    expect(await resolvers.Activity.trackEdited({ gpxFilename: "fresh.gpx" })).toBe(true);
  });

  it("restores the first version after two edits and backs up the current one first", async () => {
    const filePath = path.join(dir(), "hike.gpx");
    writeFileSync(filePath, "original");
    await backupFile(filePath);
    writeFileSync(filePath, "trimmed");
    await backupFile(filePath);
    writeFileSync(filePath, "trimmed and renamed");
    pool.query
      .mockResolvedValueOnce({ rows: [{ gpx_filename: "hike.gpx", owner: "mark" }] })
      .mockResolvedValueOnce({ rows: [{ id: 7, gpx_filename: "hike.gpx", owner: "mark" }] });

    await restoreActivityOriginal(null, { id: "7" }, mark);

    expect(readFileSync(filePath, "utf-8")).toBe("original");
    expect(processFile).toHaveBeenCalledWith(filePath);
    const backups = readdirSync(path.join(dir(), "_backups"))
      .filter((f) => f.startsWith("hike.gpx."))
      .sort();
    expect(backups).toHaveLength(3);
    expect(readFileSync(path.join(dir(), "_backups", backups[2]), "utf-8")).toBe(
      "trimmed and renamed",
    );
  });

  it("refuses to restore an activity that was never edited", async () => {
    writeFileSync(path.join(dir(), "never.gpx"), "v1");
    pool.query.mockResolvedValueOnce({ rows: [{ gpx_filename: "never.gpx", owner: "mark" }] });
    await expect(restoreActivityOriginal(null, { id: "8" }, mark)).rejects.toThrow(
      /nothing to restore/,
    );
  });

  it("keeps a copy of a deleted activity's file", async () => {
    const filePath = path.join(dir(), "gone.gpx");
    writeFileSync(filePath, "keep me");
    pool.query
      .mockResolvedValueOnce({ rows: [{ gpx_filename: "gone.gpx", owner: "mark" }] })
      .mockResolvedValue({ rows: [], rowCount: 0 });

    expect(await deleteActivity(null, { id: "9" }, mark)).toBe(true);
    expect(existsSync(filePath)).toBe(false);
    const copies = readdirSync(path.join(dir(), "_backups")).filter((f) =>
      f.startsWith("gone.gpx."),
    );
    expect(copies).toHaveLength(1);
    expect(readFileSync(path.join(dir(), "_backups", copies[0]), "utf-8")).toBe("keep me");
  });
});

describe("importActivityFile", () => {
  const { importActivityFile } = resolvers.Mutation;
  const dir = () => process.env.GPX_FILES_DIRECTORY;
  const b64 = (content: string | Buffer) => Buffer.from(content).toString("base64");
  const gpx = (name: string, start = "2021-05-01T10:00:00Z", withTimes = true) => {
    const t0 = Date.parse(start);
    const pts = [0, 1, 2]
      .map(
        (i) =>
          `<trkpt lat="${40 + i * 0.001}" lon="${-110 + i * 0.001}"><ele>${1000 + i}</ele>${
            withTimes ? `<time>${new Date(t0 + i * 60_000).toISOString()}</time>` : ""
          }</trkpt>`,
      )
      .join("");
    return `<?xml version="1.0"?><gpx version="1.1" creator="test"><trk><name>${name}</name><trkseg>${pts}</trkseg></trk></gpx>`;
  };
  const leftoverTempDirs = () => readdirSync(tmpdir()).filter((d) => d.startsWith("gpx-import-"));

  let tempDirsBefore: string[];
  beforeEach(() => {
    pool.query.mockReset();
    processFile.mockReset();
    tempDirsBefore = leftoverTempDirs();
  });
  afterEach(() => {
    expect(leftoverTempDirs()).toEqual(tempDirsBefore);
  });

  // No existing activity at that start, then the row processFile created.
  const freshImport = (id: number, title: string) =>
    pool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id, title }] });

  it("places a GPX in the person's folder under its cleaned name and processes it", async () => {
    freshImport(11, "Garmin hike");
    const result = await importActivityFile(
      null,
      { filename: "../Garmin hike?.gpx", contentBase64: b64(gpx("Garmin hike")) },
      kristin,
    );

    expect(result).toEqual({ status: "IMPORTED", activityId: 11, title: "Garmin hike" });
    const dest = path.join(dir(), "kristin", "Garmin hike_.gpx");
    expect(readFileSync(dest, "utf-8")).toContain("Garmin hike");
    expect(processFile).toHaveBeenCalledWith(dest);
    expect(pool.query.mock.calls[0][1][0]).toBe("kristin");
  });

  it("imports a .skiz file", async () => {
    const zip = new AdmZip();
    zip.addFile("Track.xml", Buffer.from(`<track name="Powder" activity="skiing"></track>`));
    zip.addFile(
      "Nodes.csv",
      Buffer.from(
        ["1704067200,45.0,7.0,1000,0,0,5,5", "1704067260,45.001,7.0,1050,0,0,5,5"].join("\n"),
      ),
    );
    freshImport(12, "Powder");
    const result = await importActivityFile(
      null,
      { filename: "powder.skiz", contentBase64: zip.toBuffer().toString("base64") },
      mark,
    );
    expect(result.status).toBe("IMPORTED");
    expect(existsSync(path.join(dir(), "mark", "powder.skiz"))).toBe(true);
  });

  it("numbers a different file that has the same name", async () => {
    freshImport(13, "First");
    await importActivityFile(
      null,
      { filename: "activity.gpx", contentBase64: b64(gpx("First")) },
      mark,
    );
    freshImport(14, "Second");
    await importActivityFile(
      null,
      { filename: "activity.gpx", contentBase64: b64(gpx("Second", "2021-06-01T10:00:00Z")) },
      mark,
    );
    expect(readFileSync(path.join(dir(), "mark", "activity-2.gpx"), "utf-8")).toContain("Second");
  });

  it.each([
    ["notes.txt", "hello", /Not a GPX/],
    ["empty.gpx", "", /empty/],
    ["broken.gpx", "not xml at all", /Couldn't read/],
    ["route.gpx", gpx("Planned route", undefined, false), /no timestamps/],
  ])("rejects %s without writing anything", async (filename, content, reason) => {
    const result: any = await importActivityFile(
      null,
      { filename, contentBase64: b64(content) },
      mark,
    );
    expect(result.status).toBe("REJECTED");
    expect(result.reason).toMatch(reason);
    expect(existsSync(path.join(dir(), "mark", filename))).toBe(false);
    expect(processFile).not.toHaveBeenCalled();
  });

  it("rejects a file over 20 MB", async () => {
    const result = await importActivityFile(
      null,
      {
        filename: "huge.gpx",
        contentBase64: Buffer.alloc(20 * 1024 * 1024 + 1).toString("base64"),
      },
      mark,
    );
    expect(result).toEqual({ status: "REJECTED", reason: "The file is larger than 20 MB" });
  });

  it("reports DUPLICATE for another file of an activity you already have", async () => {
    writeFileSync(path.join(dir(), "watch-export.gpx"), gpx("From my watch"));
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 20, title: "From my watch", gpx_filename: "watch-export.gpx" }],
    });
    const result = await importActivityFile(
      null,
      { filename: "phone-export.gpx", contentBase64: b64(gpx("From my phone")) },
      mark,
    );
    expect(result).toEqual({ status: "DUPLICATE", activityId: 20, title: "From my watch" });
    expect(existsSync(path.join(dir(), "mark", "phone-export.gpx"))).toBe(false);
    // Only this person's activities count as duplicates.
    expect(pool.query.mock.calls[0][0]).toMatch(/owner = \$1/);
  });

  it("reports ALREADY_IMPORTED when the same bytes are already on the server", async () => {
    const content = gpx("Same file");
    writeFileSync(path.join(dir(), "same.gpx"), content);
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 21, title: "Same file", gpx_filename: "same.gpx" }],
    });
    const result = await importActivityFile(
      null,
      { filename: "same.gpx", contentBase64: b64(content) },
      mark,
    );
    expect(result).toEqual({ status: "ALREADY_IMPORTED", activityId: 21, title: "Same file" });
    expect(processFile).not.toHaveBeenCalled();
  });
});

describe("trips", () => {
  const { saveTrip, deleteTrip } = resolvers.Mutation;
  const tripRow = {
    id: 3,
    name: "Tour du Mont Blanc",
    start_date: "2026-10-01",
    end_date: "2027-06-30",
    goal_meters: "500000",
    counts_elevation: true,
    weekly_targets_meters: null,
  };
  const trip = {
    id: "3",
    name: "Tour du Mont Blanc",
    startDate: "2026-10-01",
    endDate: "2027-06-30",
    goalMeters: 500000,
    countsElevation: true,
    weeklyTargetsMeters: null,
  };
  const input = {
    name: " Tour du Mont Blanc ",
    startDate: "2026-10-01",
    endDate: "2027-06-30",
    goalMeters: 500000,
    participants: ["Kristin"],
  };
  let client;

  beforeEach(() => {
    pool.query.mockReset();
    pool.connect.mockReset();
    mkdirSync(path.join(process.env.GPX_FILES_DIRECTORY, "kristin"), { recursive: true });
    client = { query: vi.fn().mockResolvedValue({ rows: [{ id: 3 }] }), release: vi.fn() };
    pool.connect.mockResolvedValue(client);
  });

  it("lists only the trips the requester is on", async () => {
    pool.query.mockResolvedValue({ rows: [tripRow] });
    expect(await resolvers.Query.trips(null, {}, kristin)).toEqual([trip]);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toMatch(/p\.person = \$1/);
    expect(params).toEqual(["kristin"]);
  });

  it("hides a trip from someone who isn't on it", async () => {
    pool.query.mockResolvedValue({ rows: [] });
    expect(await resolvers.Query.trip(null, { id: "3" }, kristin)).toBeNull();
    expect(pool.query.mock.calls[0][1]).toEqual(["3", "kristin"]);
  });

  it("puts the creator on a new trip", async () => {
    const result = await saveTrip(null, { id: null, input }, mark);

    expect(result).toEqual(trip);
    const inserted = client.query.mock.calls
      .filter(([sql]) => sql.startsWith("INSERT INTO trip_participants"))
      .map(([, params]) => params);
    expect(inserted).toEqual([
      [3, "mark"],
      [3, "kristin"],
    ]);
    expect(client.query).toHaveBeenLastCalledWith("COMMIT");
  });

  it("makes the goal the sum of a weekly plan", async () => {
    const plan = { ...input, startDate: "2026-10-05", endDate: "2026-10-25" };
    const result = await saveTrip(
      null,
      { id: null, input: { ...plan, countsElevation: false, weeklyTargetsMeters: [10, 0, 30] } },
      mark,
    );

    expect(result.goalMeters).toBe(40);
    expect(result.countsElevation).toBe(false);
    expect(result.weeklyTargetsMeters).toEqual([10, 0, 30]);
    const [, params] = client.query.mock.calls.find(([sql]) => sql.includes("INSERT INTO trips"));
    expect(params.slice(3)).toEqual([40, false, "[10,0,30]"]);

    await expect(
      saveTrip(null, { id: null, input: { ...plan, weeklyTargetsMeters: [10, 30] } }, mark),
    ).rejects.toThrow(/need 3 weekly targets/);
  });

  it("counts plain distance on a trip that doesn't count climbing", async () => {
    pool.query.mockResolvedValue({
      rows: [
        { id: 1, activity_type: "Hiking", distance_meters: "1000", total_elevation_gain: "100" },
      ],
    });
    const [activity] = await resolvers.Trip.myActivities(
      { ...trip, countsElevation: false },
      {},
      kristin,
    );
    expect(activity.equivalentMeters).toBe(1000);
  });

  it("replaces the participants of an existing trip", async () => {
    pool.query.mockResolvedValue({ rows: [tripRow] });

    await saveTrip(null, { id: "3", input }, mark);

    expect(client.query).toHaveBeenCalledWith("DELETE FROM trip_participants WHERE trip_id = $1", [
      "3",
    ]);
    const inserted = client.query.mock.calls
      .filter(([sql]) => sql.startsWith("INSERT INTO trip_participants"))
      .map(([, params]) => params);
    expect(inserted).toEqual([["3", "kristin"]]);
  });

  it("rejects bad input before writing anything", async () => {
    await expect(
      saveTrip(null, { id: null, input: { ...input, participants: ["nobody"] } }, mark),
    ).rejects.toThrow(/Unknown person/);
    await expect(
      saveTrip(null, { id: null, input: { ...input, endDate: "2026-09-30" } }, mark),
    ).rejects.toThrow(/before the start/);
    await expect(
      saveTrip(null, { id: null, input: { ...input, goalMeters: 0 } }, mark),
    ).rejects.toThrow(/more than zero/);
    await expect(
      saveTrip(null, { id: null, input: { ...input, name: "  " } }, mark),
    ).rejects.toThrow(/name/);
    pool.query.mockResolvedValue({ rows: [tripRow] });
    await expect(
      saveTrip(null, { id: "3", input: { ...input, participants: [] } }, mark),
    ).rejects.toThrow(/at least one person/);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it("won't change or delete a trip the requester isn't on", async () => {
    pool.query.mockResolvedValue({ rows: [] });
    await expect(saveTrip(null, { id: "3", input }, kristin)).rejects.toThrow(/Trip not found/);
    await expect(deleteTrip(null, { id: "3" }, kristin)).rejects.toThrow(/Trip not found/);
    expect(pool.connect).not.toHaveBeenCalled();
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  it("totals each participant from their own visible activities", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ person: "kristin" }, { person: "mark" }] })
      .mockResolvedValueOnce({
        rows: [
          { id: 1, activity_type: "Hiking", distance_meters: "1000", total_elevation_gain: "100" },
          { id: 2, activity_type: "Cycling", distance_meters: "10000", total_elevation_gain: null },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: 9, distance_meters: "2000", note: null }] })
      .mockResolvedValue({ rows: [] });

    const participants = await resolvers.Trip.participants(trip);

    expect(participants).toEqual([
      { person: "kristin", equivalentMeters: 1800 + 3000 + 2000 },
      { person: "mark", equivalentMeters: 0 },
    ]);
    const [sql, params] = pool.query.mock.calls[1];
    expect(sql).toMatch(
      /a\.owner = \$1 OR a\.gpx_filename IN \(SELECT gpx_filename FROM activity_shares/,
    );
    expect(params).toEqual(["kristin", "2026-10-01", "2027-06-30"]);
    expect(pool.query.mock.calls[2][1]).toEqual(["3", "kristin", "2026-10-01", "2027-06-30"]);
    expect(pool.query.mock.calls[3][1][0]).toBe("mark");
  });

  describe("manual entries", () => {
    const { addTripManualEntry, deleteTripManualEntry } = resolvers.Mutation;
    const entry = { tripId: "3", date: "2026-10-05", distanceMeters: 5000, note: " Treadmill " };

    it("adds distance for the requester", async () => {
      pool.query.mockResolvedValueOnce({ rows: [tripRow] }).mockResolvedValueOnce({
        rows: [{ id: 9, entry_date: "2026-10-05", distance_meters: "5000", note: "Treadmill" }],
      });

      expect(await addTripManualEntry(null, entry, kristin)).toEqual({
        id: "9",
        date: "2026-10-05",
        distanceMeters: 5000,
        note: "Treadmill",
      });
      expect(pool.query.mock.calls[1][1]).toEqual([
        "3",
        "kristin",
        "2026-10-05",
        5000,
        "Treadmill",
      ]);
    });

    it("rejects a date outside the window, a zero distance, and a trip the requester isn't on", async () => {
      pool.query.mockResolvedValue({ rows: [tripRow] });
      await expect(
        addTripManualEntry(null, { ...entry, date: "2026-09-30" }, kristin),
      ).rejects.toThrow(/outside/);
      await expect(
        addTripManualEntry(null, { ...entry, distanceMeters: 0 }, kristin),
      ).rejects.toThrow(/more than zero/);
      pool.query.mockResolvedValue({ rows: [] });
      await expect(addTripManualEntry(null, entry, kristin)).rejects.toThrow(/Trip not found/);
    });

    it("only deletes the requester's own entry", async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 0 }).mockResolvedValueOnce({ rowCount: 1 });
      await expect(deleteTripManualEntry(null, { id: "9" }, mark)).rejects.toThrow(/not found/);
      expect(await deleteTripManualEntry(null, { id: "9" }, kristin)).toBe(true);
      expect(pool.query.mock.calls[1][1]).toEqual(["9", "kristin"]);
    });
  });

  it("lists the requester's own activities with their equivalent distance", async () => {
    pool.query.mockResolvedValue({
      rows: [
        {
          id: 7,
          title: "Ridge walk",
          activity_type: "Paragliding",
          start_time: new Date("2026-10-02T10:00:00Z"),
          distance_meters: "30000",
          total_elevation_gain: "2000",
        },
      ],
    });

    const activities = await resolvers.Trip.myActivities(trip, {}, kristin);

    expect(activities).toEqual([
      {
        id: "7",
        title: "Ridge walk",
        activityType: "Paragliding",
        startTime: new Date("2026-10-02T10:00:00Z"),
        distanceMeters: 30000,
        totalElevationGain: 2000,
        factor: 0,
        equivalentMeters: 0,
      },
    ]);
    expect(pool.query.mock.calls[0][1][0]).toBe("kristin");
  });
});
