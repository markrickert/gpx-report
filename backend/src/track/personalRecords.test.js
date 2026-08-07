import { describe, it, expect } from "vitest";
import { bestEffortSeconds, computeBestEfforts } from "./personalRecords.js";

// Builds points for a steady pace: 1 point/sec, `speedMps` constant.
function steadyPoints(count, speedMps, startTime = 0) {
  const points = [];
  for (let i = 0; i < count; i++) {
    points.push({ distanceMeters: i * speedMps, timestamp: startTime + i * 1000 });
  }
  return points;
}

describe("bestEffortSeconds", () => {
  it("finds the exact split time at steady pace", () => {
    // 5 m/s for 300s covers 1500m; 1km should take exactly 200s.
    const points = steadyPoints(301, 5);
    expect(bestEffortSeconds(points, 1000)).toBe(200);
  });

  it("returns null when the activity never covers the target distance", () => {
    const points = steadyPoints(101, 5); // covers 500m total
    expect(bestEffortSeconds(points, 1000)).toBeNull();
  });

  it("picks the fastest window, not the first one that qualifies", () => {
    // Slow first half (1 m/s for 500s = 500m), then fast second half
    // (10 m/s), so the fastest 1km is entirely within the fast section.
    const points = [];
    let t = 0;
    let d = 0;
    for (let i = 0; i < 500; i++) {
      points.push({ distanceMeters: d, timestamp: t });
      d += 1;
      t += 1000;
    }
    for (let i = 0; i < 200; i++) {
      points.push({ distanceMeters: d, timestamp: t });
      d += 10;
      t += 1000;
    }
    // Fastest 1km should be ~100s (10 m/s), far faster than crossing the
    // slow section would allow.
    expect(bestEffortSeconds(points, 1000)).toBe(100);
  });

  it("is not thrown off by a pause late in the track (flat distance, advancing time)", () => {
    const points = steadyPoints(401, 5); // 0..2000m over 400s
    // Insert a 60s pause after index 350 (1750m in), well past where a
    // 1km window can be found entirely in the unpaused front section.
    const paused = points.map((p, i) =>
      i <= 350 ? p : { distanceMeters: p.distanceMeters, timestamp: p.timestamp + 60_000 },
    );
    // The fastest 1km is still the unpaused 200s window near the start
    // (steady 5 m/s); a window straddling or following the pause would
    // only ever be slower, so the pause shouldn't change the result.
    expect(bestEffortSeconds(paused, 1000)).toBe(200);
  });
});

describe("computeBestEfforts", () => {
  it("returns a result per target distance, null where too short", () => {
    const points = steadyPoints(1201, 5); // 6000m over 1200s
    const result = computeBestEfforts(points, [1000, 5000, 10000]);
    expect(result[1000]).toBe(200);
    expect(result[5000]).toBe(1000);
    expect(result[10000]).toBeNull();
  });

  it("drops points missing distance or timestamp before computing", () => {
    const points = [
      { distanceMeters: null, timestamp: 0 },
      ...steadyPoints(201, 5, 1000).map((p) => ({
        distanceMeters: p.distanceMeters,
        timestamp: p.timestamp,
      })),
    ];
    const result = computeBestEfforts(points, [1000]);
    expect(result[1000]).toBe(200);
  });
});
