import { describe, it, expect } from "vitest";
import { suggestActivityTypes } from "./suggestType.js";

describe("suggestActivityTypes", () => {
  it("ranks Running highest for a fast, mostly-flat track", () => {
    const ranked = suggestActivityTypes({
      avgSpeedMps: 3.0, // ~10.8 km/h
      maxSpeedMps: 4.5,
      totalElevationGain: 60,
      totalElevationLoss: 60,
      distanceMeters: 8000,
    });
    expect(ranked[0].type).toBe("Running");
    expect(ranked[0].score).toBeGreaterThan(ranked[ranked.length - 1].score);
  });

  it("ranks Cycling highest for a fast track with little elevation change", () => {
    const ranked = suggestActivityTypes({
      avgSpeedMps: 7.5, // ~27 km/h
      maxSpeedMps: 12,
      totalElevationGain: 100,
      totalElevationLoss: 100,
      distanceMeters: 30000,
    });
    expect(ranked[0].type).toBe("Cycling");
  });

  it("ranks Hiking highest for a slow track with heavy elevation gain per km", () => {
    const ranked = suggestActivityTypes({
      avgSpeedMps: 1.1,
      maxSpeedMps: 2.5,
      totalElevationGain: 700,
      totalElevationLoss: 680,
      distanceMeters: 9000, // ~78m gain/km
    });
    expect(ranked[0].type).toBe("Hiking");
  });

  it("ranks Alpine Skiing highest for a fast track with heavy elevation loss per km", () => {
    const ranked = suggestActivityTypes({
      avgSpeedMps: 6,
      maxSpeedMps: 18,
      totalElevationGain: 200,
      totalElevationLoss: 900,
      distanceMeters: 6000, // ~150m loss/km
    });
    expect(ranked[0].type).toBe("Alpine Skiing");
  });

  it("returns all candidate types sorted descending by score", () => {
    const ranked = suggestActivityTypes({
      avgSpeedMps: 3.0,
      maxSpeedMps: 4.5,
      totalElevationGain: 60,
      totalElevationLoss: 60,
      distanceMeters: 8000,
    });
    expect(ranked.length).toBeGreaterThan(1);
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
    }
    // E-Mountain Bike Ride is deliberately excluded (indistinguishable from
    // Mountain Biking by speed/elevation alone).
    expect(ranked.some((r) => r.type === "E-Mountain Bike Ride")).toBe(false);
  });

  it("does not throw and still scores when optional metrics are missing", () => {
    const ranked = suggestActivityTypes({
      avgSpeedMps: null,
      maxSpeedMps: null,
      totalElevationGain: null,
      totalElevationLoss: null,
      distanceMeters: 5000,
    });
    expect(ranked.length).toBeGreaterThan(0);
    ranked.forEach((r) => expect(r.score).toBe(0));
  });
});
