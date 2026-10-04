import { describe, it, expect } from "vitest";
import { effortFactor, equivalentMeters } from "./effort.js";

const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;

function equivalentMiles(activityType, miles, feetGained) {
  return (
    equivalentMeters({
      activityType,
      distanceMeters: miles * METERS_PER_MILE,
      totalElevationGain: feetGained == null ? null : feetGained * METERS_PER_FOOT,
    }) / METERS_PER_MILE
  );
}

describe("effortFactor", () => {
  it("treats an unmapped type like Unknown", () => {
    expect(effortFactor("Snowshoeing")).toEqual(effortFactor("Unknown"));
    expect(effortFactor("Snowshoeing").factor).toBe(1);
  });
});

describe("equivalentMeters", () => {
  it("adds 8m of flat distance per metre climbed on foot", () => {
    expect(
      equivalentMeters({ activityType: "Hiking", distanceMeters: 1000, totalElevationGain: 100 }),
    ).toBe(1800);
  });

  it("counts a hike with no elevation data as its distance", () => {
    expect(
      equivalentMeters({ activityType: "Hiking", distanceMeters: 1000, totalElevationGain: null }),
    ).toBe(1000);
  });

  it("ignores a negative gain", () => {
    expect(
      equivalentMeters({ activityType: "Walking", distanceMeters: 1000, totalElevationGain: -50 }),
    ).toBe(1000);
  });

  it("scales bike distance and climb by the type factor", () => {
    expect(
      equivalentMeters({ activityType: "Cycling", distanceMeters: 10000, totalElevationGain: 100 }),
    ).toBeCloseTo(0.3 * 10800);
  });

  it("gives no climbing credit to gravity and water types", () => {
    for (const activityType of ["Alpine Skiing", "Swimming", "Kayaking"]) {
      const flat = equivalentMeters({ activityType, distanceMeters: 1000, totalElevationGain: 0 });
      const hilly = equivalentMeters({
        activityType,
        distanceMeters: 1000,
        totalElevationGain: 500,
      });
      expect(hilly).toBe(flat);
    }
  });

  it("counts paragliding as nothing", () => {
    expect(
      equivalentMeters({
        activityType: "Paragliding",
        distanceMeters: 30000,
        totalElevationGain: 2000,
      }),
    ).toBe(0);
  });

  it("matches the worked examples", () => {
    expect(equivalentMiles("Hiking", 5, 2000)).toBeCloseTo(8.0, 1);
    expect(equivalentMiles("Cycling", 20, 1000)).toBeCloseTo(6.45, 2);
    expect(equivalentMiles("Swimming", 1, null)).toBeCloseTo(4.0, 1);
    expect(equivalentMiles("Alpine Skiing", 15, 3000)).toBeCloseTo(2.25, 2);
  });
});
