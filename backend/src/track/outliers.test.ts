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

  it("does not flag a duplicate-timestamp point with near-zero movement", () => {
    // Real-world pattern found on live ski activities: a device writes two
    // samples for the same instant (dt=0) while essentially stationary,
    // with a couple meters of GPS jitter. distance/0 used to evaluate to
    // Infinity m/s, which always exceeded the threshold regardless of how
    // little the point actually moved.
    const points = [
      { lat: 45, lon: 7, timestamp: START },
      { lat: 45.00001, lon: 7, timestamp: START }, // same timestamp, ~1.1m of jitter
      { lat: 45.00002, lon: 7, timestamp: START + 1_000 },
    ];
    expect(detectOutliers(points)).toEqual([]);
  });

  it("does not flag (and does not cascade after) a mistimed-but-real position that persists", () => {
    // Real-world pattern found on live mountain-biking activities: the
    // device holds a stationary position for several samples during a stop
    // (dt=1s each, distance 0), then needs one sample to "catch up" once it
    // reacquires and movement resumes — landing far away in a single
    // second. Unlike a bad GPS fix, the point *after* the jump continues on
    // plausibly from the jump itself rather than snapping back toward the
    // pre-jump trajectory, so it's real (just mistimed) and shouldn't be
    // flagged — nor should the points after it, which a stale last-kept
    // anchor used to wrongly cascade-flag too.
    const points = [
      { lat: 45, lon: 7, timestamp: START }, // stationary hold
      { lat: 45, lon: 7, timestamp: START + 1_000 },
      { lat: 45, lon: 7, timestamp: START + 2_000 },
      { lat: 45, lon: 7.0021, timestamp: START + 3_000 }, // ~165m in 1s: implausible from the stale anchor
      { lat: 45, lon: 7.00215, timestamp: START + 4_000 }, // ~3.9m in 1s: continues from the jump, not back to it
      { lat: 45, lon: 7.0022, timestamp: START + 5_000 }, // continues normally from the re-anchored point
    ];
    expect(detectOutliers(points)).toEqual([]);
  });

  it("still flags a genuine teleport that self-corrects, even though the point right after it isn't itself implausible", () => {
    // Contrast with the mistimed-but-real case above: here the point after
    // the jump lands back near the *pre-jump* trajectory rather than
    // continuing on from the jump, so it doesn't corroborate the jump as a
    // real position — it's a genuine bad GPS fix.
    const points = [
      { lat: 45, lon: 7.0, timestamp: START },
      { lat: 45, lon: 7.00003, timestamp: START + 1_000 }, // steady ~2.4 m/s
      { lat: 45, lon: 7.003, timestamp: START + 2_000 }, // bad fix: ~234m in 1s
      { lat: 45, lon: 7.00006, timestamp: START + 3_000 }, // back near the pre-jump trajectory, not near the jump
    ];
    expect(detectOutliers(points)).toEqual([2]);
  });
});
