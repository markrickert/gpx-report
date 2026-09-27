import { describe, it, expect } from "vitest";
import { buildGpxXml } from "./gpx";
import type { TrackPoint } from "./types";

const pt = (lat: number, segment: number, elevation: number | null = 10): TrackPoint => ({
  lat,
  lon: -105,
  elevation,
  timestamp: Date.UTC(2026, 8, 25, 12, 0, lat * 10),
  segment,
});

describe("buildGpxXml", () => {
  it("writes one <trkseg> per recording segment", () => {
    const xml = buildGpxXml([pt(40, 0), pt(40.1, 0), pt(40.2, 1)], "Walk", "Walking");
    expect(xml.match(/<trkseg>/g)).toHaveLength(2);
    expect(xml.match(/<trkpt /g)).toHaveLength(3);
  });

  it("includes <type> for a chosen activity type and omits it for Unknown", () => {
    expect(buildGpxXml([pt(40, 0)], "A", "Hiking")).toContain("<type>Hiking</type>");
    expect(buildGpxXml([pt(40, 0)], "A", "Unknown")).not.toContain("<type>");
  });

  it("writes the note as an escaped <desc> and omits it when empty", () => {
    expect(buildGpxXml([pt(40, 0)], "A", "Hiking", "Rain & <wind>")).toContain(
      "<desc>Rain &amp; &lt;wind&gt;</desc>",
    );
    expect(buildGpxXml([pt(40, 0)], "A", "Hiking", null)).not.toContain("<desc>");
  });

  it("escapes the title and skips <ele> for points without elevation", () => {
    const xml = buildGpxXml([pt(40, 0, null)], `Tom & Jerry's <ride>`, "Unknown");
    expect(xml).toContain("<name>Tom &amp; Jerry&apos;s &lt;ride&gt;</name>");
    expect(xml).not.toContain("<ele>");
    expect(xml).toContain("<time>2026-09-25T12:06:40.000Z</time>");
  });
});
