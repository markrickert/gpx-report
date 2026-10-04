import { describe, it, expect } from "vitest";
import { tripWeekCount } from "./weeks.js";

describe("tripWeekCount", () => {
  it("counts whole weeks", () => {
    expect(tripWeekCount("2026-09-21", "2026-10-04")).toBe(2);
  });

  it("folds leftover days into the last week", () => {
    expect(tripWeekCount("2026-09-21", "2026-11-09")).toBe(7);
    expect(tripWeekCount("2026-09-21", "2026-10-03")).toBe(1);
  });

  it("is one week for a window shorter than a week", () => {
    expect(tripWeekCount("2026-09-21", "2026-09-23")).toBe(1);
  });
});
