import { describe, it, expect } from "vitest";
import { detectOutliers } from "./outliers.js";

const START = Date.parse("2024-01-01T00:00:00Z");

describe("detectOutliers", () => {
  it("returns no outliers for fewer than 2 points", () => {
    expect(detectOutliers([])).toEqual([]);
    expect(detectOutliers([{ lat: 0, lon: 0, timestamp: START }])).toEqual([]);
  });

  it("does not flag a normal walking-pace track", () => {
    const points = [
      { lat: 45, lon: 7, timestamp: START },
      { lat: 45.00001, lon: 7, timestamp: START + 10_000 },
      { lat: 45.00002, lon: 7, timestamp: START + 20_000 },
    ];
    expect(detectOutliers(points)).toEqual([]);
  });

  it("flags a single point that implies an implausible speed jump", () => {
    const points = [
      { lat: 45, lon: 7, timestamp: START },
      { lat: 46, lon: 7, timestamp: START + 1_000 }, // ~111km in 1s: a GPS teleport
      { lat: 45.00001, lon: 7, timestamp: START + 11_000 },
    ];
    expect(detectOutliers(points)).toEqual([1]);
  });

  it("does not cascade-flag every point after one bad fix", () => {
    // Point 1 teleports away, then points 2/3 continue normally from point 0
    // (the last *kept* point) rather than from the bad fix.
    const points = [
      { lat: 45, lon: 7, timestamp: START },
      { lat: 46, lon: 7, timestamp: START + 1_000 },
      { lat: 45.00001, lon: 7, timestamp: START + 11_000 },
      { lat: 45.00002, lon: 7, timestamp: START + 21_000 },
    ];
    expect(detectOutliers(points)).toEqual([1]);
  });

  it("never flags points with a missing timestamp on either side", () => {
    const points = [
      { lat: 45, lon: 7, timestamp: null },
      { lat: 46, lon: 7, timestamp: START + 1_000 },
      { lat: 45.00001, lon: 7, timestamp: null },
    ];
    expect(detectOutliers(points)).toEqual([]);
  });

  it("honors a custom max plausible speed threshold", () => {
    const points = [
      { lat: 45, lon: 7, timestamp: START },
      { lat: 45.001, lon: 7, timestamp: START + 10_000 }, // ~11 m/s, fine for running but not walking
    ];
    expect(detectOutliers(points, 50)).toEqual([]);
    expect(detectOutliers(points, 1)).toEqual([1]);
  });
});
