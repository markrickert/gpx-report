import { describe, it, expect } from "vitest";
import { isWithinWindow, assignMediaToActivities } from "./match.js";

describe("isWithinWindow", () => {
  const window = {
    activityId: 1,
    startTime: "2026-01-01T10:00:00Z",
    endTime: "2026-01-01T11:00:00Z",
  };

  it("matches a timestamp inside the activity window", () => {
    expect(isWithinWindow("2026-01-01T10:30:00Z", window, 0)).toBe(true);
  });

  it("rejects a timestamp well outside the window", () => {
    expect(isWithinWindow("2026-01-01T13:00:00Z", window, 0)).toBe(false);
  });

  it("accepts a timestamp just outside the raw window when covered by the clock-skew buffer", () => {
    expect(isWithinWindow("2026-01-01T11:10:00Z", window, 15 * 60 * 1000)).toBe(true);
  });

  it("rejects a timestamp outside the window even with a buffer if too far", () => {
    expect(isWithinWindow("2026-01-01T11:30:00Z", window, 15 * 60 * 1000)).toBe(false);
  });
});

describe("assignMediaToActivities", () => {
  it("assigns a single-window asset directly", () => {
    const candidates = new Map([
      [
        1,
        [
          {
            immichAssetId: "a1",
            assetType: "IMAGE" as const,
            takenAt: "2026-01-01T10:30:00Z",
            lat: null,
            lon: null,
            durationSeconds: null,
          },
        ],
      ],
    ]);
    const windows = new Map([
      [1, { activityId: 1, startTime: "2026-01-01T10:00:00Z", endTime: "2026-01-01T11:00:00Z" }],
    ]);

    const result = assignMediaToActivities(candidates, windows, () => null);
    expect(result).toEqual([
      {
        immichAssetId: "a1",
        assetType: "IMAGE",
        takenAt: "2026-01-01T10:30:00Z",
        lat: null,
        lon: null,
        durationSeconds: null,
        activityId: 1,
      },
    ]);
  });

  it("uses geo distance to the route as a tiebreak when two activities overlap", () => {
    const asset = {
      immichAssetId: "a1",
      assetType: "IMAGE" as const,
      takenAt: "2026-01-01T10:30:00Z",
      lat: 40.1,
      lon: -111.1,
      durationSeconds: null,
    };
    const candidates = new Map([
      [1, [asset]],
      [2, [asset]],
    ]);
    const windows = new Map([
      [1, { activityId: 1, startTime: "2026-01-01T09:00:00Z", endTime: "2026-01-01T11:00:00Z" }],
      [2, { activityId: 2, startTime: "2026-01-01T10:00:00Z", endTime: "2026-01-01T12:00:00Z" }],
    ]);

    const distances: Record<number, number> = { 1: 500, 2: 20 };
    const result = assignMediaToActivities(
      candidates,
      windows,
      (activityId) => distances[activityId],
    );
    expect(result[0].activityId).toBe(2);
  });

  it("falls back to the earlier-starting activity when an overlapping asset has no GPS data", () => {
    const asset = {
      immichAssetId: "a1",
      assetType: "IMAGE" as const,
      takenAt: "2026-01-01T10:30:00Z",
      lat: null,
      lon: null,
      durationSeconds: null,
    };
    const candidates = new Map([
      [1, [asset]],
      [2, [asset]],
    ]);
    const windows = new Map([
      [1, { activityId: 1, startTime: "2026-01-01T09:30:00Z", endTime: "2026-01-01T11:00:00Z" }],
      [2, { activityId: 2, startTime: "2026-01-01T09:00:00Z", endTime: "2026-01-01T12:00:00Z" }],
    ]);

    const result = assignMediaToActivities(candidates, windows, () => null);
    expect(result[0].activityId).toBe(2);
  });

  it("deduplicates an asset returned as a candidate for the same activity twice", () => {
    const asset = {
      immichAssetId: "a1",
      assetType: "VIDEO" as const,
      takenAt: "2026-01-01T10:30:00Z",
      lat: null,
      lon: null,
      durationSeconds: 12,
    };
    const candidates = new Map([[1, [asset, asset]]]);
    const windows = new Map([
      [1, { activityId: 1, startTime: "2026-01-01T09:00:00Z", endTime: "2026-01-01T12:00:00Z" }],
    ]);

    const result = assignMediaToActivities(candidates, windows, () => null);
    expect(result).toHaveLength(1);
  });
});
