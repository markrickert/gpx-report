import { describe, it, expect } from "vitest";
import { detectElevationSpikes, correctElevationSpikes } from "./elevationSpikes.js";

const START_TIME = Date.parse("2024-01-01T00:00:00Z");

// A smooth, gently climbing ride: 1 point every ~3s, elevation rising ~1m
// per point. Nothing here should ever be flagged.
function buildSmoothClimb(count = 60) {
  const points = [];
  let t = START_TIME;
  for (let i = 0; i < count; i++) {
    points.push({ lat: 45 + i * 0.0001, lon: 7, elevation: 2000 + i, timestamp: t });
    t += 3000;
  }
  return points;
}

// Splices a run of `spikeLength` points into a smooth base track, offsetting
// their elevation by `offset` meters, starting at `at` — models the real
// 951-961 plateau case (elevation jumps, holds, then returns to trend).
function withPlateauSpike(basePoints, { at, spikeLength, offset }) {
  return basePoints.map((p, i) =>
    i >= at && i < at + spikeLength ? { ...p, elevation: p.elevation + offset } : p,
  );
}

describe("detectElevationSpikes", () => {
  it("returns nothing for fewer than 3 points", () => {
    expect(detectElevationSpikes([])).toEqual([]);
    expect(
      detectElevationSpikes([
        { elevation: 100, timestamp: START_TIME },
        { elevation: 101, timestamp: START_TIME + 1000 },
      ]),
    ).toEqual([]);
  });

  it("does not flag a smooth, sustained climb", () => {
    expect(detectElevationSpikes(buildSmoothClimb())).toEqual([]);
  });

  it("flags a single-point spike that self-corrects on the next point", () => {
    const points = buildSmoothClimb().map((p, i) =>
      i === 30 ? { ...p, elevation: p.elevation - 54 } : p,
    );
    const spikes = detectElevationSpikes(points);
    expect(spikes).toEqual([{ startIndex: 30, endIndex: 30 }]);
  });

  it("flags a short plateau that jumps off trend and holds before returning", () => {
    // ~11 points at 3s each = ~30s, offset +50m — mirrors the real
    // mid-descent glitch this feature was built for.
    const points = withPlateauSpike(buildSmoothClimb(), { at: 30, spikeLength: 11, offset: 50 });
    const spikes = detectElevationSpikes(points);
    expect(spikes).toEqual([{ startIndex: 30, endIndex: 40 }]);
  });

  it("flags two adjacent glitches sharing a boundary jump as two separate runs", () => {
    // Real elevations from activity 27597 (the case this feature was built
    // for): a jump up that holds and drifts slightly, then immediately a
    // jump down into a dip that also holds, then a jump back up to the real
    // trend — the shared boundary jump has to serve as both the first run's
    // exit and the second run's entry.
    const rawElevations = [
      2600, 2598, 2598, 2598, 2597, 2596, 2647, 2646, 2644, 2641, 2640, 2639, 2638, 2586, 2585,
      2583, 2633, 2630, 2629, 2629,
    ];
    const points = rawElevations.map((elevation, i) => ({
      lat: 45 + i * 0.0001,
      lon: 7,
      elevation,
      timestamp: START_TIME + i * 3000,
    }));
    const spikes = detectElevationSpikes(points);
    expect(spikes).toEqual([
      { startIndex: 6, endIndex: 12 },
      { startIndex: 13, endIndex: 15 },
    ]);
  });

  it("flags a plateau whose entry/exit jumps aren't near-symmetric", () => {
    // Real elevations from activity 27597, indices 1012-1020: a single-point
    // dip (already handled elsewhere), then a plateau that jumps back up
    // +50 and holds, then exits with a -60 drop back to the real trend — the
    // 10m gap between the two jump magnitudes must not block the match.
    const rawElevations = [2563, 2509, 2559, 2558, 2556, 2559, 2555, 2555, 2495, 2492];
    const points = rawElevations.map((elevation, i) => ({
      lat: 45 + i * 0.0001,
      lon: 7,
      elevation,
      timestamp: START_TIME + i * 3000,
    }));
    const spikes = detectElevationSpikes(points);
    expect(spikes).toEqual([
      { startIndex: 1, endIndex: 1 },
      { startIndex: 2, endIndex: 7 },
    ]);
  });

  it("does not flag good data just because its boundary happens to net out close to an unrelated later jump", () => {
    // A single-point dip (self-corrects immediately) followed, a few points
    // later, by a real elevation drop well outside the entry/exit magnitude
    // tolerance — the dip's "return to trend" jump must not get reused as a
    // false entry pairing with the unrelated later jump.
    const base = buildSmoothClimb();
    const points = base.map((p, i) => (i === 30 ? { ...p, elevation: p.elevation - 50 } : p));
    const withLaterDrop = points.map((p, i) =>
      i >= 40 ? { ...p, elevation: p.elevation - 100 } : p,
    );
    const spikes = detectElevationSpikes(withLaterDrop);
    expect(spikes).toEqual([{ startIndex: 30, endIndex: 30 }]);
  });

  it("does not flag a plateau lasting longer than maxSpikeDurationSeconds", () => {
    // 30 points at 3s each = 90s, well past the default 60s cutoff — this
    // should read as a real elevation change, not a transient glitch.
    const points = withPlateauSpike(buildSmoothClimb(), { at: 15, spikeLength: 30, offset: 50 });
    expect(detectElevationSpikes(points)).toEqual([]);
  });

  it("drops a run touching either end of the track (no good neighbor to compare/interpolate against)", () => {
    const points = withPlateauSpike(buildSmoothClimb(), { at: 0, spikeLength: 5, offset: 50 });
    expect(detectElevationSpikes(points)).toEqual([]);
  });

  it("ignores points with a null elevation rather than throwing", () => {
    const points = buildSmoothClimb().map((p, i) => (i === 30 ? { ...p, elevation: null } : p));
    expect(() => detectElevationSpikes(points)).not.toThrow();
  });
});

describe("correctElevationSpikes", () => {
  it("returns the same array reference when there are no spikes", () => {
    const points = buildSmoothClimb();
    expect(correctElevationSpikes(points, [])).toBe(points);
  });

  it("interpolates a flagged run between its good neighbors, leaving everything else untouched", () => {
    const base = buildSmoothClimb();
    const points = withPlateauSpike(base, { at: 30, spikeLength: 11, offset: 50 });
    const spikes = detectElevationSpikes(points);
    const corrected = correctElevationSpikes(points, spikes);

    // Untouched region matches the original exactly.
    expect(corrected[10].elevation).toBe(points[10].elevation);
    expect(corrected[50].elevation).toBe(points[50].elevation);

    // Corrected region is close to the original (un-spiked) smooth climb,
    // not the spiked value, and monotonically increasing like the base.
    for (let i = 30; i <= 40; i++) {
      expect(Math.abs(corrected[i].elevation - base[i].elevation)).toBeLessThan(1);
    }
    expect(corrected[30].elevation).toBeLessThan(corrected[40].elevation);

    // Input array is not mutated.
    expect(points[35].elevation).toBe(base[35].elevation + 50);
  });
});
