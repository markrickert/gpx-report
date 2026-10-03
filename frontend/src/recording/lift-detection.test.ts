import { describe, it, expect } from "vitest";
import { detectLiftSegments } from "./lift-detection";

const START_TIME = Date.parse("2024-01-01T00:00:00Z");
const METERS_PER_DEGREE_LAT = 111320;

// Straight line north at 3.5 m/s, climbing steadily: a chairlift ride.
function liftPoints(count = 30) {
  return Array.from({ length: count }, (_, i) => ({
    lat: 45 + (i * 35) / METERS_PER_DEGREE_LAT,
    lon: 7,
    elevation: 1500 + i * 8,
    timestamp: START_TIME + i * 10_000,
  }));
}

// Mirrors backend/src/track/liftDetection.test.ts; the full suite lives there.
describe("detectLiftSegments", () => {
  it("flags a ride up and reports the distance it covered", () => {
    const [ride, ...rest] = detectLiftSegments(liftPoints());
    expect(rest).toEqual([]);
    expect(ride.startIndex).toBe(0);
    expect(ride.endIndex).toBe(29);
    expect(ride.distanceMeters).toBeCloseTo(29 * 35, -1);
  });

  it("flags a ride back down the same line", () => {
    const up = liftPoints();
    const end = up[up.length - 1].timestamp;
    const down = [...up].reverse().map((p, i) => ({ ...p, timestamp: end + 600_000 + i * 10_000 }));
    const rides = detectLiftSegments([...up, ...down]);
    expect(rides.map((r) => Math.sign(r.elevationGainMeters))).toEqual([1, -1]);
  });

  it("does not flag a walk at the same grade", () => {
    const walk = liftPoints().map((p, i) => ({ ...p, timestamp: START_TIME + i * 35_000 }));
    expect(detectLiftSegments(walk)).toEqual([]);
  });
});
