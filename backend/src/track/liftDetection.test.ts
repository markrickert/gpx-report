import { describe, it, expect } from "vitest";
import { detectLiftSegments } from "./liftDetection.js";

const START_TIME = Date.parse("2024-01-01T00:00:00Z");

// Straight line north, steady speed/climb, one short stop partway through —
// modeling a chairlift restart.
function buildLiftPoints({
  count = 30,
  startLat = 45,
  startLon = 7,
  stepMeters = 5,
  climbPerStep = 2,
}) {
  const points = [];
  const metersPerDegreeLat = 111320;
  let t = START_TIME;
  for (let i = 0; i < count; i++) {
    points.push({
      lat: startLat + (i * stepMeters) / metersPerDegreeLat,
      lon: startLon,
      elevation: 1500 + i * climbPerStep,
      timestamp: t,
    });
    t += 10_000;
    if (i === 15) t += 60_000; // mid-ride stop under MAX_STOP_SECONDS
  }
  return points;
}

// Noisy, irregular-heading, irregular-elevation walk — modeling a hiker.
function buildHikerPoints({ count = 30, startLat = 46, startLon = 7 }) {
  const points = [];
  let lat = startLat;
  let lon = startLon;
  let elevation = 1500;
  let t = START_TIME;
  for (let i = 0; i < count; i++) {
    lat += (i % 2 === 0 ? 1 : -1) * 0.00004;
    lon += 0.00003;
    elevation += i % 3 === 0 ? 8 : -5;
    points.push({ lat, lon, elevation, timestamp: t });
    t += (5 + (i % 4) * 7) * 1000;
  }
  return points;
}

describe("detectLiftSegments", () => {
  it("returns no segments for fewer than 2 points", () => {
    expect(detectLiftSegments([])).toEqual([]);
    expect(detectLiftSegments([{ lat: 0, lon: 0, elevation: 0, timestamp: 1 }])).toEqual([]);
  });

  it("flags a straight, steady-climb, mostly-constant-speed stretch as a lift", () => {
    const points = buildLiftPoints({});
    const segments = detectLiftSegments(points);
    expect(segments.length).toBeGreaterThan(0);
    const seg = segments[0];
    expect(seg.startIndex).toBe(0);
    expect(seg.endIndex).toBe(points.length - 1);
    expect(seg.elevationGainMeters).toBeGreaterThan(0);
  });

  it("does not flag a noisy, irregular-heading hiking stretch", () => {
    const points = buildHikerPoints({});
    expect(detectLiftSegments(points)).toEqual([]);
  });

  it("ignores intervals with missing timestamps rather than throwing", () => {
    const points = buildLiftPoints({}).map((p, i) => (i === 5 ? { ...p, timestamp: null } : p));
    expect(() => detectLiftSegments(points)).not.toThrow();
  });

  it("does not flag a straight, steady, fast downhill stretch as a lift", () => {
    // A bike-park singletrack descent: straight, roughly constant speed,
    // monotonically losing elevation — same track shape as an uphill lift
    // ride, just downhill and faster. Real bug: detected mid-descent on a
    // real activity (2026-08-08) between two genuine uphill lift segments.
    const points = buildLiftPoints({ climbPerStep: -2, stepMeters: 15 });
    expect(detectLiftSegments(points)).toEqual([]);
  });

  it("does not flag a mostly-stationary stretch with drifting elevation as a lift", () => {
    // A hiker stopped for several minutes (e.g. at a viewpoint); GPS/elevation
    // sensor drifts slowly upward, and the handful of 1-2s jitter blips that
    // clear MIN_MOVE_METERS happen to share a bearing. No single stall ever
    // exceeds MAX_STOP_SECONDS because sampling is dense (~1s), so only a
    // moving-time-fraction check catches this. Real bug: activities/409, a
    // hike with a petroglyph/swimming-hole stop (2026-08-10).
    const points = [];
    let t = START_TIME;
    for (let i = 0; i < 300; i++) {
      points.push({
        lat: 45 + (i % 5 === 0 ? 0.00002 : 0),
        lon: 7,
        elevation: 1500 + i * 0.12,
        timestamp: t,
      });
      t += 1_000;
    }
    expect(detectLiftSegments(points)).toEqual([]);
  });
});
