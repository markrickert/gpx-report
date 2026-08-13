import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  escapeXml,
  updateGpxTitle,
  updateGpxType,
  trimGpxTrack,
  removeGpxTrackPoints,
  fixGpxElevations,
} from "./writer.js";
import { parseGpxFile } from "./parser.js";

function trkpt(lat, lon, ele, time) {
  return `<trkpt lat="${lat}" lon="${lon}"><ele>${ele}</ele><time>${time}</time></trkpt>`;
}

const POINTS = [
  trkpt(45.0, 7.0, 1000, "2024-01-01T00:00:00Z"),
  trkpt(45.001, 7.0, 1010, "2024-01-01T00:00:10Z"),
  trkpt(45.002, 7.0, 1020, "2024-01-01T00:00:20Z"),
  trkpt(45.003, 7.0, 1030, "2024-01-01T00:00:30Z"),
];

function gpxDoc({
  name,
  type,
  points = POINTS,
}: { name?: string; type?: string; points?: string[] } = {}) {
  return `<?xml version="1.0"?>
<gpx><trk>${name ? `<name>${name}</name>` : ""}${type ? `<type>${type}</type>` : ""}<trkseg>
${points.join("\n")}
</trkseg></trk></gpx>`;
}

describe("escapeXml", () => {
  it("escapes the five XML special characters", () => {
    expect(escapeXml(`<a & "b" 'c'>`)).toBe("&lt;a &amp; &quot;b&quot; &apos;c&apos;&gt;");
  });
});

describe("gpx writer", () => {
  let dir;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "gpx-writer-test-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeGpx(filename, contents) {
    const filePath = path.join(dir, filename);
    await writeFile(filePath, contents, "utf-8");
    return filePath;
  }

  describe("updateGpxTitle", () => {
    it("inserts a <name> when none exists", async () => {
      const filePath = await writeGpx("no-name.gpx", gpxDoc());
      await updateGpxTitle(filePath, "Morning Run");
      const result = await parseGpxFile(filePath);
      expect(result.title).toBe("Morning Run");
    });

    it("replaces an existing <name>", async () => {
      const filePath = await writeGpx("has-name.gpx", gpxDoc({ name: "Old Title" }));
      await updateGpxTitle(filePath, "New Title");
      const result = await parseGpxFile(filePath);
      expect(result.title).toBe("New Title");
    });

    it("escapes special characters in the new title", async () => {
      const filePath = await writeGpx("special.gpx", gpxDoc({ name: "Old" }));
      await updateGpxTitle(filePath, "Tom & Jerry's Run");
      const xml = await readFile(filePath, "utf-8");
      expect(xml).toContain("Tom &amp; Jerry&apos;s Run");
    });

    it("throws when there is no <trk> element", async () => {
      const filePath = await writeGpx("no-trk.gpx", `<gpx></gpx>`);
      await expect(updateGpxTitle(filePath, "X")).rejects.toThrow(/No <trk> element/);
    });
  });

  describe("updateGpxType", () => {
    it("inserts a <type> when none exists", async () => {
      const filePath = await writeGpx("no-type.gpx", gpxDoc({ name: "Run" }));
      await updateGpxType(filePath, "Trail Running");
      const result = await parseGpxFile(filePath);
      expect(result.activityType).toBe("Trail Running");
    });

    it("replaces an existing <type>", async () => {
      const filePath = await writeGpx("has-type.gpx", gpxDoc({ name: "Run", type: "Walking" }));
      await updateGpxType(filePath, "Running");
      const result = await parseGpxFile(filePath);
      expect(result.activityType).toBe("Running");
    });
  });

  describe("trimGpxTrack", () => {
    it("keeps only trkpts within the inclusive range", async () => {
      const filePath = await writeGpx("trim.gpx", gpxDoc());
      await trimGpxTrack(filePath, 1, 2);
      const result = await parseGpxFile(filePath);
      expect(result.points).toHaveLength(2);
      expect(result.points[0].lat).toBeCloseTo(45.001);
      expect(result.points[1].lat).toBeCloseTo(45.002);
    });

    it("rejects a range that would leave fewer than 2 points", async () => {
      const filePath = await writeGpx("trim-too-short.gpx", gpxDoc());
      await expect(trimGpxTrack(filePath, 0, 0)).rejects.toThrow(/at least 2 track points/);
    });

    it("rejects an out-of-bounds or inverted range", async () => {
      const filePath = await writeGpx("trim-invalid.gpx", gpxDoc());
      await expect(trimGpxTrack(filePath, 2, 1)).rejects.toThrow(/Invalid trim range/);
      await expect(trimGpxTrack(filePath, 0, 99)).rejects.toThrow(/Invalid trim range/);
    });

    it("throws when there are no trkpts", async () => {
      const filePath = await writeGpx("no-points.gpx", gpxDoc({ points: [] }));
      await expect(trimGpxTrack(filePath, 0, 0)).rejects.toThrow(/No <trkpt> elements/);
    });
  });

  describe("removeGpxTrackPoints", () => {
    it("drops points at the given indices, keeping the rest in order", async () => {
      const filePath = await writeGpx("remove.gpx", gpxDoc());
      await removeGpxTrackPoints(filePath, [1]);
      const result = await parseGpxFile(filePath);
      expect(result.points).toHaveLength(3);
      expect(result.points.map((p) => Math.round(p.lat * 1000))).toEqual([45000, 45002, 45003]);
    });

    it("rejects removing points that would leave fewer than 2 behind", async () => {
      const filePath = await writeGpx("remove-too-many.gpx", gpxDoc());
      await expect(removeGpxTrackPoints(filePath, [0, 1, 2])).rejects.toThrow(
        /fewer than 2 track points/,
      );
    });
  });

  describe("fixGpxElevations", () => {
    it("replaces the <ele> of specific points, leaving lat/lon/time and other points untouched", async () => {
      const filePath = await writeGpx("fix.gpx", gpxDoc());
      await fixGpxElevations(filePath, new Map([[1, 1234.5]]));
      const result = await parseGpxFile(filePath);
      expect(result.points).toHaveLength(4);
      expect(result.points[1].elevation).toBeCloseTo(1234.5);
      expect(result.points[1].lat).toBeCloseTo(45.001);
      expect(result.points[0].elevation).toBeCloseTo(1000);
      expect(result.points[2].elevation).toBeCloseTo(1020);
    });

    it("inserts an <ele> when a trkpt has none", async () => {
      const filePath = await writeGpx(
        "fix-no-ele.gpx",
        gpxDoc({
          points: [
            `<trkpt lat="45.0" lon="7.0"><time>2024-01-01T00:00:00Z</time></trkpt>`,
            trkpt(45.001, 7.0, 1010, "2024-01-01T00:00:10Z"),
          ],
        }),
      );
      await fixGpxElevations(filePath, new Map([[0, 999]]));
      const result = await parseGpxFile(filePath);
      expect(result.points[0].elevation).toBeCloseTo(999);
    });

    it("throws when there are no trkpts", async () => {
      const filePath = await writeGpx("fix-no-points.gpx", gpxDoc({ points: [] }));
      await expect(fixGpxElevations(filePath, new Map([[0, 100]]))).rejects.toThrow(
        /No <trkpt> elements/,
      );
    });
  });

  describe("backups", () => {
    it("copies the original into a sibling _backups dir before each edit", async () => {
      const original = gpxDoc({ name: "Before" });
      const filePath = await writeGpx("backup-me.gpx", original);
      await updateGpxTitle(filePath, "After");

      const backupsDir = path.join(dir, "_backups");
      const backupsOf = async () =>
        (await readdir(backupsDir)).filter((f) => f.startsWith("backup-me.gpx."));

      const backups = await backupsOf();
      expect(backups).toHaveLength(1);
      expect(backups[0]).toMatch(/^backup-me\.gpx\..+\.bak$/);
      expect(await readFile(path.join(backupsDir, backups[0]), "utf-8")).toBe(original);

      await updateGpxType(filePath, "running");
      expect(await backupsOf()).toHaveLength(2);
    });
  });
});
