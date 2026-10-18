import { describe, it, expect } from "vitest";
import type { LocationObject } from "expo-location";
import { dropUnsettledStart } from "./location-point";

const loc = (accuracy: number | null, timestamp: number) =>
  ({ coords: { latitude: 40, longitude: -105, accuracy }, timestamp }) as LocationObject;

describe("dropUnsettledStart", () => {
  it("drops coarse fixes until an accurate one arrives, keeping it and later ones", () => {
    const out = dropUnsettledStart([loc(80, 1000), loc(12, 2000), loc(60, 3000)], 1000, false);
    expect(out.map((l) => l.timestamp)).toEqual([2000, 3000]);
  });

  it("drops a stale cached fix from before the segment started", () => {
    expect(dropUnsettledStart([loc(5, 1000)], 100_000, false)).toEqual([]);
  });

  it("keeps everything once the segment has points", () => {
    const all = [loc(80, 1000), loc(90, 2000)];
    expect(dropUnsettledStart(all, 1000, true)).toEqual(all);
  });
});
