import { describe, it, expect } from "vitest";
import {
  formatDistance,
  distanceValue,
  distanceUnitLabel,
  elevationValue,
  formatElevation,
  elevationUnitLabel,
  formatSpeed,
} from "./units.jsx";

describe("distance", () => {
  it("converts meters to miles for imperial", () => {
    expect(distanceValue(1609.34, "imperial")).toBeCloseTo(1, 3);
  });

  it("converts meters to km for metric", () => {
    expect(distanceValue(1000, "metric")).toBeCloseTo(1, 5);
  });

  it("formats distance with a unit label and two decimal places", () => {
    expect(formatDistance(1609.34, "imperial")).toBe("1.00 mi");
    expect(formatDistance(1000, "metric")).toBe("1.00 km");
  });

  it("labels distance units correctly", () => {
    expect(distanceUnitLabel("imperial")).toBe("mi");
    expect(distanceUnitLabel("metric")).toBe("km");
  });
});

describe("elevation", () => {
  it("converts meters to feet for imperial", () => {
    expect(elevationValue(1, "imperial")).toBeCloseTo(3.28084, 4);
  });

  it("leaves meters unchanged for metric", () => {
    expect(elevationValue(100, "metric")).toBe(100);
  });

  it("formats elevation with a rounded value and unit label", () => {
    expect(formatElevation(100, "metric")).toBe("100 m");
    expect(formatElevation(100, "imperial")).toBe("328 ft");
  });

  it("renders a placeholder for null/undefined elevation", () => {
    expect(formatElevation(null, "metric")).toBe("-");
    expect(formatElevation(undefined, "imperial")).toBe("-");
  });

  it("labels elevation units correctly", () => {
    expect(elevationUnitLabel("imperial")).toBe("ft");
    expect(elevationUnitLabel("metric")).toBe("m");
  });
});

describe("formatSpeed", () => {
  it("converts m/s to km/h for metric", () => {
    expect(formatSpeed(10, "metric")).toBe("36.0 km/h");
  });

  it("converts m/s to mph for imperial", () => {
    expect(formatSpeed(10, "imperial")).toBe("22.4 mph");
  });

  it("renders a placeholder for null speed", () => {
    expect(formatSpeed(null, "metric")).toBe("-");
  });
});
