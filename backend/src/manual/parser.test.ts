import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isManualFilename, manualActivityFields, parseManualFile } from "./parser.js";

const HIKE = {
  title: "Afternoon Hiking",
  activityType: "Hiking",
  startTime: "2026-10-04T18:00:00.000Z",
  distanceMeters: 6437.4,
};

describe("manual parser", () => {
  let dir;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "manual-parser-test-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function parse(fields) {
    const filePath = path.join(dir, "a.manual.json");
    await writeFile(filePath, JSON.stringify(fields));
    return parseManualFile(filePath);
  }

  it("recognizes only the double extension", () => {
    expect(isManualFilename("kristin/manual-1.MANUAL.json")).toBe(true);
    expect(isManualFilename("kristin/settings.json")).toBe(false);
  });

  it("parses an activity with no duration as zero time and no speed", async () => {
    const parsed = await parse(HIKE);
    expect(parsed).toMatchObject({
      title: "Afternoon Hiking",
      activityType: "Hiking",
      durationSeconds: 0,
      distanceMeters: 6437.4,
      avgSpeedMps: null,
      movingAvgSpeedMps: null,
      maxSpeedMps: null,
      totalElevationGain: null,
      totalElevationLoss: null,
      description: null,
      points: [],
      elevationProfile: [],
    });
    expect(parsed.startTime.toISOString()).toBe("2026-10-04T18:00:00.000Z");
    expect(parsed.endTime).toEqual(parsed.startTime);
  });

  it("derives the end time and speed from a duration", async () => {
    const parsed = await parse({
      ...HIKE,
      durationSeconds: 3600,
      elevationGainMeters: 120,
      notes: " Roads by the condo ",
    });
    expect(parsed.durationSeconds).toBe(3600);
    expect(parsed.endTime.toISOString()).toBe("2026-10-04T19:00:00.000Z");
    expect(parsed.avgSpeedMps).toBeCloseTo(6437.4 / 3600);
    expect(parsed.totalElevationGain).toBe(120);
    expect(parsed.description).toBe("Roads by the condo");
  });

  it("rejects fields that can't make an activity", () => {
    expect(() => manualActivityFields({ ...HIKE, title: " " })).toThrow(/title/);
    expect(() => manualActivityFields({ ...HIKE, startTime: "yesterday" })).toThrow(/date/);
    expect(() => manualActivityFields({ ...HIKE, distanceMeters: 0 })).toThrow(/distance/);
    expect(() => manualActivityFields({ ...HIKE, durationSeconds: 0 })).toThrow(/duration/);
    expect(() => manualActivityFields({ ...HIKE, elevationGainMeters: -1 })).toThrow(/elevation/);
  });

  it("defaults a missing type to Unknown", () => {
    expect(manualActivityFields({ ...HIKE, activityType: "" }).activityType).toBe("Unknown");
  });
});
