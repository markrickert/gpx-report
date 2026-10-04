import { describe, it, expect } from "vitest";
import { localDate, tripPace } from "./trip-pace";

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
