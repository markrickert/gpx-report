import { describe, it, expect } from "vitest";
import { suggestActivityTypes, trackStats } from "./suggest-type";
import type { TrackPoint } from "./types";

const METERS_PER_DEGREE_LAT = 111_195;

/** A straight northbound track sampled every 5 s at a steady speed and climb. */
function track({
  speedMps,
  climbPerKm = 0,
  km = 2,
  segment = 0,
  startMs = 0,
  startLat = 40,
  startEle = 1000,
}: {
  speedMps: number;
  climbPerKm?: number;
  km?: number;
  segment?: number;
  startMs?: number;
  startLat?: number;
  startEle?: number;
}): TrackPoint[] {
  const stepM = speedMps * 5;
  const count = Math.round((km * 1000) / stepM);
  return Array.from({ length: count + 1 }, (_, i) => ({
    lat: startLat + (i * stepM) / METERS_PER_DEGREE_LAT,
    lon: -105,
    elevation: startEle + (i * stepM * climbPerKm) / 1000,
    timestamp: startMs + i * 5000,
    segment,
  }));
}

describe("suggestActivityTypes", () => {
  it("ranks a flat 1.4 m/s track as a walk", () => {
    expect(suggestActivityTypes(track({ speedMps: 1.4 }))[0]).toBe("Walking");
  });

  it("ranks a flat 7 m/s track as a ride", () => {
    expect(suggestActivityTypes(track({ speedMps: 7 }))[0]).toBe("Cycling");
  });

  it("ranks a slow, steep climb as a hike", () => {
    expect(suggestActivityTypes(track({ speedMps: 1, climbPerKm: 120 }))[0]).toBe("Hiking");
  });

  it("offers downhill types for a lift ride up and a fast run down", () => {
    const lift = track({ speedMps: 4, climbPerKm: 300, km: 1 });
    const top = lift[lift.length - 1];
    const run = track({
      speedMps: 10,
      climbPerKm: -300,
      km: 1,
      startMs: top.timestamp + 5000,
      startLat: top.lat,
      startEle: top.elevation!,
    });
    const types = suggestActivityTypes([...lift, ...run]);
    expect(types.slice(0, 2)).toEqual(expect.arrayContaining(["Alpine Skiing", "Paragliding"]));
    expect(types).not.toContain("Walking");
  });

  it("suggests nothing for a track too short to judge", () => {
    expect(suggestActivityTypes(track({ speedMps: 1.4, km: 0.05 }))).toEqual([]);
  });
});

describe("trackStats", () => {
  it("leaves a pause between segments out of distance and time", () => {
    const first = track({ speedMps: 2, km: 1 });
    const last = first[first.length - 1];
    const second = track({
      speedMps: 2,
      km: 1,
      segment: 1,
      startMs: last.timestamp + 3_600_000,
      startLat: last.lat + 0.05,
    });
    const stats = trackStats([...first, ...second]);
    expect(stats.distanceMeters).toBeCloseTo(2000, -1);
    expect(stats.avgSpeedMps).toBeCloseTo(2, 1);
  });

  it("ignores elevation wobble smaller than the noise threshold", () => {
    const points = track({ speedMps: 1.4 }).map((p, i) => ({
      ...p,
      elevation: 1000 + (i % 2 ? 2 : 0),
    }));
    expect(trackStats(points).elevationGain).toBe(0);
  });
});
