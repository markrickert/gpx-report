import { describe, it, expect } from "vitest";
import { matchedRecords } from "./ActivityDetail.jsx";

function activity(overrides = {}) {
  return {
    distanceMeters: 5000,
    totalElevationGain: 200,
    best1kmSeconds: 300,
    best5kmSeconds: 1500,
    best10kmSeconds: null,
    route: { liftSegments: [] },
    ...overrides,
  };
}

function record(overrides = {}) {
  return {
    longestDistanceMeters: 5000,
    biggestElevationGainMeters: 200,
    best1kmSeconds: 300,
    best5kmSeconds: 1500,
    best10kmSeconds: 3000,
    ...overrides,
  };
}

describe("matchedRecords", () => {
  it("returns an empty array when there is no record", () => {
    expect(matchedRecords(activity(), null)).toEqual([]);
  });

  it("returns an empty array when nothing matches", () => {
    const act = activity({
      distanceMeters: 1000,
      totalElevationGain: 10,
      best1kmSeconds: 400,
      best5kmSeconds: 2000,
    });
    expect(matchedRecords(act, record())).toEqual([]);
  });

  it("matches longest distance", () => {
    expect(matchedRecords(activity(), record())).toContain("Longest Distance");
  });

  it("matches biggest elevation gain, excluding lift-segment gain", () => {
    const act = activity({
      totalElevationGain: 250,
      route: { liftSegments: [{ elevationGainMeters: 50 }] },
    });
    expect(matchedRecords(act, record({ biggestElevationGainMeters: 200 }))).toContain(
      "Biggest Elevation Gain",
    );
  });

  it("ignores negative lift-segment elevation gain when computing the comparison basis", () => {
    const act = activity({
      totalElevationGain: 200,
      route: { liftSegments: [{ elevationGainMeters: -30 }] },
    });
    expect(matchedRecords(act, record({ biggestElevationGainMeters: 200 }))).toContain(
      "Biggest Elevation Gain",
    );
  });

  it("matches fastest 1km/5km/10km splits independently", () => {
    expect(matchedRecords(activity(), record())).toEqual(
      expect.arrayContaining(["Fastest 1km", "Fastest 5km"]),
    );
    expect(matchedRecords(activity(), record())).not.toContain("Fastest 10km");

    const act = activity({ best10kmSeconds: 3000 });
    expect(matchedRecords(act, record())).toContain("Fastest 10km");
  });

  it("does not match a split the activity does not have", () => {
    const act = activity({ best1kmSeconds: null });
    expect(matchedRecords(act, record())).not.toContain("Fastest 1km");
  });
});
