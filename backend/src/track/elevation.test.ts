import { describe, it, expect } from "vitest";
import { smoothElevations, computeElevationGainLoss } from "./elevation.js";

describe("smoothElevations", () => {
  it("returns the same values when the input is already flat", () => {
    expect(smoothElevations([100, 100, 100, 100, 100])).toEqual([100, 100, 100, 100, 100]);
  });

  it("averages a centered window, clamping at the array edges", () => {
    const smoothed = smoothElevations([0, 0, 10, 0, 0], 3);
    // Edges only average 2 neighbors (clamped window); the middle averages 3.
    expect(smoothed[0]).toBeCloseTo(0);
    expect(smoothed[2]).toBeCloseTo(10 / 3);
    expect(smoothed[4]).toBeCloseTo(0);
  });

  it("skips null elevations rather than treating them as 0", () => {
    const smoothed = smoothElevations([100, null, 100], 3);
    expect(smoothed[1]).toBeCloseTo(100);
  });

  it("returns null for an all-null window", () => {
    expect(smoothElevations([null, null, null], 3)).toEqual([null, null, null]);
  });
});

describe("computeElevationGainLoss", () => {
  it("sums positive and negative deltas separately", () => {
    // Long enough (>5 points) that smoothing kicks in; a clean monotonic
    // ramp up then down survives smoothing without changing the total.
    const elevations = [0, 10, 20, 30, 20, 10, 0];
    const { gain, loss } = computeElevationGainLoss(elevations);
    expect(gain).toBeGreaterThan(0);
    expect(loss).toBeGreaterThan(0);
    expect(gain).toBeCloseTo(loss, 0);
  });

  it("smooths out single-point jitter that would otherwise inflate gain", () => {
    // A sawtooth around a flat baseline: raw deltas would sum to a lot of
    // gain+loss, but the centered moving average should mostly cancel it.
    const elevations = [100, 105, 100, 105, 100, 105, 100, 105, 100];
    const rawGain = elevations
      .slice(1)
      .reduce((sum, e, i) => sum + Math.max(0, e - elevations[i]), 0);
    const { gain } = computeElevationGainLoss(elevations);
    expect(gain).toBeLessThan(rawGain);
  });

  it("falls back to raw deltas for tracks at or below the window size", () => {
    const elevations = [0, 10, 5];
    const { gain, loss } = computeElevationGainLoss(elevations, 5);
    expect(gain).toBeCloseTo(10);
    expect(loss).toBeCloseTo(5);
  });

  it("ignores null elevations when summing deltas", () => {
    const elevations = [0, null, 10, 20, 30, 40, 50];
    const { gain } = computeElevationGainLoss(elevations);
    expect(gain).toBeGreaterThan(0);
    expect(Number.isNaN(gain)).toBe(false);
  });

  it("returns zero gain/loss for a flat track", () => {
    expect(computeElevationGainLoss([100, 100, 100, 100, 100, 100])).toEqual({
      gain: 0,
      loss: 0,
    });
  });
});
