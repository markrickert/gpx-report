import { describe, it, expect } from "vitest";
import { defaultManualTitle, manualActivityInput } from "./manual-activity";

const form = {
  date: "2026-10-04",
  title: "",
  activityType: "Hiking",
  distance: "4",
  hours: "",
  minutes: "",
  elevationGain: "",
  notes: " Roads by the condo ",
};

describe("manualActivityInput", () => {
  it("converts miles to meters, lands at local noon, and leaves out what wasn't typed", () => {
    const input = manualActivityInput(form, "imperial");
    expect(input.distanceMeters).toBeCloseTo(6437.4, 0);
    expect(new Date(input.startTime).getHours()).toBe(12);
    expect(new Date(input.startTime).getDate()).toBe(4);
    expect(input).toMatchObject({
      title: "Hiking",
      durationSeconds: null,
      elevationGainMeters: null,
      notes: "Roads by the condo",
    });
  });

  it("builds a duration from hours and minutes and converts feet of gain", () => {
    const input = manualActivityInput(
      { ...form, title: "Road walk", hours: "1", minutes: "30", elevationGain: "328.084" },
      "imperial",
    );
    expect(input.title).toBe("Road walk");
    expect(input.durationSeconds).toBe(5400);
    expect(input.elevationGainMeters).toBeCloseTo(100, 3);
  });

  it("keeps metric values as typed", () => {
    const input = manualActivityInput({ ...form, distance: "5", elevationGain: "0" }, "metric");
    expect(input.distanceMeters).toBeCloseTo(5000);
    expect(input.elevationGainMeters).toBe(0);
  });
});

describe("defaultManualTitle", () => {
  it("names an untyped activity plainly", () => {
    expect(defaultManualTitle("Unknown")).toBe("Activity");
    expect(defaultManualTitle("Cycling")).toBe("Cycling");
  });
});
