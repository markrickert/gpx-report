import { describe, it, expect } from "vitest";
import { haversineMeters, bearingDegrees, bearingDiffDegrees, computeTrackStats } from "./geo.js";

describe("haversineMeters", () => {
  it("computes the great-circle distance between two points", () => {
    const dist = haversineMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
    expect(dist).toBeGreaterThan(111000);
    expect(dist).toBeLessThan(111400);
  });

  it("returns 0 for identical points", () => {
    expect(haversineMeters({ lat: 45, lon: 10 }, { lat: 45, lon: 10 })).toBe(0);
  });
});

describe("bearingDegrees", () => {
  it("returns ~0 for due north", () => {
    expect(bearingDegrees({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(0, 1);
  });

  it("returns ~90 for due east", () => {
    expect(bearingDegrees({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90, 1);
  });

  it("returns ~180 for due south", () => {
    expect(bearingDegrees({ lat: 1, lon: 0 }, { lat: 0, lon: 0 })).toBeCloseTo(180, 1);
  });

  it("returns ~270 for due west", () => {
    expect(bearingDegrees({ lat: 0, lon: 1 }, { lat: 0, lon: 0 })).toBeCloseTo(270, 1);
  });

  it("stays within [0, 360)", () => {
    const bearing = bearingDegrees({ lat: 10, lon: 10 }, { lat: 9, lon: 9 });
    expect(bearing).toBeGreaterThanOrEqual(0);
    expect(bearing).toBeLessThan(360);
  });
});

describe("bearingDiffDegrees", () => {
  it("returns 0 for identical bearings", () => {
    expect(bearingDiffDegrees(90, 90)).toBe(0);
  });

  it("returns the short way around across the 0/360 wrap", () => {
    expect(bearingDiffDegrees(350, 10)).toBe(20);
  });

  it("never exceeds 180", () => {
    expect(bearingDiffDegrees(0, 179)).toBe(179);
    expect(bearingDiffDegrees(0, 181)).toBe(179);
    expect(bearingDiffDegrees(0, 360)).toBe(0);
  });
});

describe("computeTrackStats", () => {
  const START = Date.parse("2024-01-01T00:00:00Z");

  it("sums point-to-point distance and finds the max speed", () => {
    const points = [
      { lat: 0, lon: 0, timestamp: START },
      { lat: 0, lon: 0.001, timestamp: START + 10_000 },
      { lat: 0, lon: 0.002, timestamp: START + 10_100 }, // much faster segment
    ];
    const stats = computeTrackStats(points);
    expect(stats.distanceMeters).toBeGreaterThan(0);
    expect(stats.maxSpeedMps).toBeGreaterThan(0);
  });

  it("returns null maxSpeedMps rather than 0 when no interval has both timestamps", () => {
    const points = [
      { lat: 0, lon: 0, timestamp: null },
      { lat: 0, lon: 0.001, timestamp: null },
    ];
    const stats = computeTrackStats(points);
    expect(stats.distanceMeters).toBeGreaterThan(0);
    expect(stats.maxSpeedMps).toBeNull();
  });

  it("ignores non-positive time deltas when computing max speed", () => {
    const points = [
      { lat: 0, lon: 0, timestamp: START },
      { lat: 0, lon: 0.001, timestamp: START }, // same timestamp, dt = 0
    ];
    const stats = computeTrackStats(points);
    expect(stats.maxSpeedMps).toBeNull();
  });

  it("returns zero distance and null max speed for a single point", () => {
    expect(computeTrackStats([{ lat: 0, lon: 0, timestamp: START }])).toEqual({
      distanceMeters: 0,
      maxSpeedMps: null,
    });
  });
});
