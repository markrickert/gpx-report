import { describe, it, expect } from "vitest";
import { localDate, tripPace, tripTargetLine, tripWeekCount } from "./trip-pace";

// A 100-day window with a 100km goal: 1km expected per day.
const trip = { goalMeters: 100000, startDate: "2026-01-01", endDate: "2026-04-10" };

describe("tripPace", () => {
  it("expects a straight line through the window", () => {
    const pace = tripPace({ ...trip, totalMeters: 12000, today: "2026-01-10" });
    expect(pace.expectedMeters).toBeCloseTo(10000);
    expect(pace.aheadMeters).toBeCloseTo(2000);
    expect(pace.daysRemaining).toBe(91);
    expect(pace.neededPerWeekMeters).toBeCloseTo((88000 / 91) * 7);
    expect(pace.isPast).toBe(false);
  });

  it("expects nothing before the start date", () => {
    const pace = tripPace({ ...trip, totalMeters: 0, today: "2025-12-01" });
    expect(pace.expectedMeters).toBe(0);
    expect(pace.daysRemaining).toBe(100);
    expect(pace.isPast).toBe(false);
  });

  it("counts the end date itself as still active", () => {
    const pace = tripPace({ ...trip, totalMeters: 97000, today: "2026-04-10" });
    expect(pace.expectedMeters).toBeCloseTo(100000);
    expect(pace.daysRemaining).toBe(1);
    expect(pace.neededPerWeekMeters).toBeCloseTo(3000);
    expect(pace.isPast).toBe(false);
  });

  it("is past the day after the end date", () => {
    const pace = tripPace({ ...trip, totalMeters: 80000, today: "2026-04-11" });
    expect(pace.isPast).toBe(true);
    expect(pace.aheadMeters).toBeCloseTo(-20000);
    expect(pace.daysRemaining).toBe(0);
    expect(pace.neededPerWeekMeters).toBe(0);
  });

  it("needs nothing more once the goal is met", () => {
    const pace = tripPace({ ...trip, totalMeters: 120000, today: "2026-02-01" });
    expect(pace.neededPerWeekMeters).toBe(0);
  });
});

describe("localDate", () => {
  it("formats in local time, zero-padded", () => {
    expect(localDate(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });
});

describe("a weekly plan", () => {
  // 3 weeks: 10km, a rest week, then 30km.
  const planned = {
    goalMeters: 40000,
    startDate: "2026-10-05",
    endDate: "2026-10-25",
    weeklyTargetsMeters: [10000, 0, 30000],
  };

  it("counts weeks, folding leftover days into the last one", () => {
    expect(tripWeekCount("2026-10-05", "2026-10-25")).toBe(3);
    expect(tripWeekCount("2026-09-21", "2026-11-09")).toBe(7);
    expect(tripWeekCount("2026-10-05", "2026-10-07")).toBe(1);
  });

  it("draws the target through each week's total", () => {
    expect(tripTargetLine(planned)).toEqual([
      { day: 0, meters: 0 },
      { day: 7, meters: 10000 },
      { day: 14, meters: 10000 },
      { day: 21, meters: 40000 },
    ]);
    expect(tripTargetLine({ ...trip, weeklyTargetsMeters: null })).toEqual([
      { day: 0, meters: 0 },
      { day: 100, meters: 100000 },
    ]);
  });

  it("expects nothing more during a rest week", () => {
    const midRest = tripPace({ ...planned, totalMeters: 10000, today: "2026-10-15" });
    expect(midRest.expectedMeters).toBeCloseTo(10000);
    expect(midRest.aheadMeters).toBeCloseTo(0);
    expect(midRest.neededThisWeekMeters).toBe(0);
  });

  it("asks for what's left of the current week's cumulative target", () => {
    const firstWeek = tripPace({ ...planned, totalMeters: 4000, today: "2026-10-07" });
    expect(firstWeek.expectedMeters).toBeCloseTo((10000 * 3) / 7);
    expect(firstWeek.neededThisWeekMeters).toBeCloseTo(6000);
    const lastWeek = tripPace({ ...planned, totalMeters: 12000, today: "2026-10-19" });
    expect(lastWeek.neededThisWeekMeters).toBeCloseTo(28000);
  });

  it("has no weekly figure without a plan", () => {
    expect(
      tripPace({ ...trip, totalMeters: 0, today: "2026-01-10" }).neededThisWeekMeters,
    ).toBeNull();
  });

  it("stretches the last week over the leftover days", () => {
    // 50 days, 7 weeks: the last week is 8 days long.
    const portugal = {
      goalMeters: 70000,
      startDate: "2026-09-21",
      endDate: "2026-11-09",
      weeklyTargetsMeters: [10000, 10000, 10000, 10000, 10000, 10000, 10000],
    };
    const pace = tripPace({ ...portugal, totalMeters: 0, today: "2026-11-05" });
    expect(pace.expectedMeters).toBeCloseTo(60000 + (10000 * 4) / 8);
  });
});
