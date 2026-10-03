import { describe, it, expect } from "vitest";
import { detectLiftSegments } from "./liftDetection.js";

const START_TIME = Date.parse("2024-01-01T00:00:00Z");

// Straight line north, steady speed/climb, one stop partway through —
// modeling a chairlift restart.
function buildLiftPoints({
  count = 30,
  startLat = 45,
  startLon = 7,
  stepMeters = 35,
  climbPerStep = 8,
  stopSeconds = 60, // under MAX_STOP_SECONDS
  wobbleMeters = 0,
}) {
  const points = [];
  const metersPerDegreeLat = 111320;
  let t = START_TIME;
  for (let i = 0; i < count; i++) {
    points.push({
      lat: startLat + (i * stepMeters) / metersPerDegreeLat,
      lon: startLon + ((i % 2 === 0 ? 1 : -1) * wobbleMeters) / metersPerDegreeLat,
      elevation: 1500 + i * climbPerStep,
      timestamp: t,
    });
    t += 10_000;
    if (i === 15) t += stopSeconds * 1000;
  }
  return points;
}

// The same ride taken back down the same line, starting `gapSeconds` after
// `upload` ends.
function buildDownloadPoints(upload, gapSeconds = 600) {
  const end = upload[upload.length - 1].timestamp;
  return [...upload]
    .reverse()
    .map((p, i) => ({ ...p, timestamp: end + gapSeconds * 1000 + i * 10_000 }));
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
    const points = buildLiftPoints({ climbPerStep: -8 });
    expect(detectLiftSegments(points)).toEqual([]);
  });

  it("flags a ride down that retraces a ride up", () => {
    // Real case: activities/7563, a hike that rode the chair up and, hours
    // later, back down (2026-10-03).
    const upload = buildLiftPoints({});
    const points = [...upload, ...buildDownloadPoints(upload)];
    const segments = detectLiftSegments(points);
    expect(segments).toHaveLength(2);
    expect(segments[0].elevationGainMeters).toBeGreaterThan(0);
    expect(segments[1].startIndex).toBe(upload.length);
    expect(segments[1].endIndex).toBe(points.length - 1);
    expect(segments[1].elevationGainMeters).toBeLessThan(0);
  });

  it("keeps a ride whole across side-to-side GPS wobble", () => {
    // Phone GPS on a chair drifts a few meters either side of the cable, so
    // consecutive fixes swing in heading while the track stays on one line.
    // Real bug: activities/7563 reported 201m of a 499m ride (2026-10-03).
    const points = buildLiftPoints({ wobbleMeters: 8 });
    const segments = detectLiftSegments(points);
    expect(segments).toHaveLength(1);
    expect(segments[0].startIndex).toBe(0);
    expect(segments[0].endIndex).toBe(points.length - 1);
  });

  it("keeps a ride whole across a lift stop lasting minutes", () => {
    const points = buildLiftPoints({ stopSeconds: 240 });
    const segments = detectLiftSegments(points);
    expect(segments).toHaveLength(1);
    expect(segments[0].endIndex).toBe(points.length - 1);
  });

  it("does not flag a straight, steady, gentle climb", () => {
    // An e-bike on a straight road: lift-like speed and line, but far too flat.
    const points = buildLiftPoints({ stepMeters: 40, climbPerStep: 1.5 });
    expect(detectLiftSegments(points)).toEqual([]);
  });

  it("does not flag a mostly-stationary stretch with drifting elevation as a lift", () => {
    // A hiker stopped for several minutes (e.g. at a viewpoint); GPS/elevation
    // sensor drifts slowly upward, and a handful of 1-2s jitter blips happen
    // to share a bearing. Real bug: activities/409, a
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
