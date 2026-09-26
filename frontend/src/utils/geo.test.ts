import { describe, it, expect } from "vitest";
import { trackDistanceMeters, formatDuration } from "./geo";

describe("trackDistanceMeters", () => {
  it("does not count the jump between segments (a pause) as distance", () => {
    const p = (lat: number, segment: number) => ({
      lat,
      lon: 0,
      elevation: null,
      timestamp: 0,
      segment,
    });
    const oneDegree = trackDistanceMeters([p(0, 0), p(1, 0)]);
    expect(oneDegree).toBeCloseTo(111195, -1);
    expect(trackDistanceMeters([p(0, 0), p(1, 0), p(5, 1), p(6, 1)])).toBeCloseTo(
      oneDegree * 2,
      -1,
    );
  });
});

describe("formatDuration", () => {
  it("formats minutes and hours", () => {
    expect(formatDuration(65_000)).toBe("1:05");
    expect(formatDuration(3_725_000)).toBe("1:02:05");
  });
});
