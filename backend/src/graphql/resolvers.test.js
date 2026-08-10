import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../db.js", () => ({ pool: { query: vi.fn() } }));
vi.mock("../track/outliers.js", () => ({ detectOutliers: vi.fn() }));
vi.mock("../track/liftDetection.js", () => ({ detectLiftSegments: vi.fn() }));
vi.mock("../track/geo.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, computeTrackStats: vi.fn() };
});

const { pool } = await import("../db.js");
const { detectOutliers } = await import("../track/outliers.js");
const { detectLiftSegments } = await import("../track/liftDetection.js");
const { computeTrackStats } = await import("../track/geo.js");
const { resolvers } = await import("./resolvers.js");

const { activityStreak, yearOverYearComparison, trainingLoad, personalRecordsByType } =
  resolvers.Query;
const { activitiesWithOutliers, activitiesWithLiftSegments } = resolvers.Query;

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

    const result = await activityStreak();
    expect(result.longestStreakDays).toBe(3);
  });

  it("reports a live current streak when the last activity was today", async () => {
    pool.query.mockResolvedValue({
      rows: [{ day: "2026-08-08" }, { day: "2026-08-09" }, { day: "2026-08-10" }],
    });
    vi.setSystemTime(new Date("2026-08-10T15:00:00Z"));

    const result = await activityStreak();
    expect(result.currentStreakDays).toBe(3);
    expect(result.longestStreakDays).toBe(3);
  });

  it("reports a live current streak when the last activity was yesterday", async () => {
    pool.query.mockResolvedValue({
      rows: [{ day: "2026-08-08" }, { day: "2026-08-09" }],
    });
    vi.setSystemTime(new Date("2026-08-10T15:00:00Z"));

    const result = await activityStreak();
    expect(result.currentStreakDays).toBe(2);
  });

  it("resets the current streak to 0 once more than a full day has passed", async () => {
    pool.query.mockResolvedValue({
      rows: [{ day: "2026-08-01" }, { day: "2026-08-02" }],
    });
    vi.setSystemTime(new Date("2026-08-10T15:00:00Z"));

    const result = await activityStreak();
    expect(result.currentStreakDays).toBe(0);
    expect(result.longestStreakDays).toBe(2);
  });

  it("returns zeros when there are no activities", async () => {
    pool.query.mockResolvedValue({ rows: [] });
    vi.setSystemTime(new Date("2026-08-10T15:00:00Z"));

    const result = await activityStreak();
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

    const result = await yearOverYearComparison();

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

    const result = await trainingLoad();
    expect(result.ratio).toBeCloseTo(1200 / 700, 5);
    expect(result.label).toBe("ramping up");
  });

  it("labels 'detraining' when acute load is below 0.8x chronic weekly average", async () => {
    // chronic weekly avg = 2800/4 = 700; acute = 100 -> ratio ≈ 0.143
    pool.query.mockResolvedValue({
      rows: [{ acute_distance_meters: "100", chronic_28day_distance_meters: "2800" }],
    });

    const result = await trainingLoad();
    expect(result.ratio).toBeCloseTo(100 / 700, 5);
    expect(result.label).toBe("detraining");
  });

  it("labels 'steady' when acute load is within [0.8, 1.5]x chronic weekly average", async () => {
    // chronic weekly avg = 2800/4 = 700; acute = 700 -> ratio 1
    pool.query.mockResolvedValue({
      rows: [{ acute_distance_meters: "700", chronic_28day_distance_meters: "2800" }],
    });

    const result = await trainingLoad();
    expect(result.ratio).toBe(1);
    expect(result.label).toBe("steady");
  });

  it("returns a null ratio and 'steady' label when chronic distance is zero", async () => {
    pool.query.mockResolvedValue({
      rows: [{ acute_distance_meters: "0", chronic_28day_distance_meters: "0" }],
    });

    const result = await trainingLoad();
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

    const result = await personalRecordsByType();
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

  // The SQL does COALESCE(elevation_gain_excluding_lift_meters, total_elevation_gain)
  // before this ever reaches JS, so the fallback itself isn't observable here -
  // this covers the resolver's own null-vs-number mapping on both sides of it:
  // an activity type with no elevation data at all (both source columns NULL,
  // so COALESCE's result is also NULL) still comes back as null rather than NaN,
  // while distances requiring no fallback still convert normally.
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

    const result = await personalRecordsByType();
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

    const result = await activitiesWithLiftSegments();

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

    const result = await activitiesWithLiftSegments();
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

    const result = await activitiesWithOutliers();

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

    const result = await activitiesWithOutliers();

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

    const result = await activitiesWithOutliers();

    expect(result.map((r) => r.activityId)).toEqual([2, 1]);
  });
});
