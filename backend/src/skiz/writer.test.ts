import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import {
  updateSkizTitle,
  updateSkizType,
  trimSkizTrack,
  removeSkizTrackPoints,
  fixSkizElevations,
} from "./writer.js";
import { parseSkizFile } from "./parser.js";

function writeSkiz(dir, filename, { trackXml, nodesCsv }: { trackXml?: string; nodesCsv?: string }) {
  const zip = new AdmZip();
  if (trackXml != null) zip.addFile("Track.xml", Buffer.from(trackXml, "utf-8"));
  if (nodesCsv != null) zip.addFile("Nodes.csv", Buffer.from(nodesCsv, "utf-8"));
  const filePath = path.join(dir, filename);
  zip.writeZip(filePath);
  return filePath;
}

const NODES_CSV = [
  "1704067200,45.0,7.0,1000,0,0,5,5",
  "1704067260,45.001,7.0,1010,0,0,5,5",
  "1704067320,45.002,7.0,1020,0,0,5,5",
  "1704067380,45.003,7.0,1030,0,0,5,5",
].join("\n");

describe("skiz writer", () => {
  let dir;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "skiz-writer-test-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe("updateSkizTitle", () => {
    it("replaces the track's name attribute", async () => {
      const filePath = writeSkiz(dir, "title.skiz", {
        trackXml: `<track name="Old" activity="skiing"></track>`,
        nodesCsv: NODES_CSV,
      });
      await updateSkizTitle(filePath, "New Title");
      const result = await parseSkizFile(filePath);
      expect(result.title).toBe("New Title");
    });

    it("adds a name attribute when none exists", async () => {
      const filePath = writeSkiz(dir, "no-name.skiz", {
        trackXml: `<track activity="skiing"></track>`,
        nodesCsv: NODES_CSV,
      });
      await updateSkizTitle(filePath, "Fresh Name");
      const result = await parseSkizFile(filePath);
      expect(result.title).toBe("Fresh Name");
    });

    it("escapes special characters in the new title", async () => {
      const filePath = writeSkiz(dir, "special.skiz", {
        trackXml: `<track name="Old" activity="skiing"></track>`,
        nodesCsv: NODES_CSV,
      });
      await updateSkizTitle(filePath, `Tom & Jerry's Run`);
      const result = await parseSkizFile(filePath);
      expect(result.title).toBe(`Tom & Jerry's Run`);
    });

    it("throws when Track.xml is missing", async () => {
      const filePath = writeSkiz(dir, "no-track-xml.skiz", { nodesCsv: NODES_CSV });
      await expect(updateSkizTitle(filePath, "X")).rejects.toThrow(/No Track.xml found/);
    });
  });

  describe("updateSkizType", () => {
    it("replaces the track's activity attribute", async () => {
      const filePath = writeSkiz(dir, "type.skiz", {
        trackXml: `<track name="Run" activity="skiing"></track>`,
        nodesCsv: NODES_CSV,
      });
      await updateSkizType(filePath, "downhill skiing");
      const result = await parseSkizFile(filePath);
      expect(result.activityType).toBe("Downhill Skiing");
    });
  });

  describe("trimSkizTrack", () => {
    it("keeps only rows within the inclusive range", async () => {
      const filePath = writeSkiz(dir, "trim.skiz", {
        trackXml: `<track name="Run" activity="skiing"></track>`,
        nodesCsv: NODES_CSV,
      });
      await trimSkizTrack(filePath, 1, 2);
      const result = await parseSkizFile(filePath);
      expect(result.points).toHaveLength(2);
    });

    it("rejects a range that would leave fewer than 2 points", async () => {
      const filePath = writeSkiz(dir, "trim-too-short.skiz", {
        trackXml: `<track name="Run" activity="skiing"></track>`,
        nodesCsv: NODES_CSV,
      });
      await expect(trimSkizTrack(filePath, 0, 0)).rejects.toThrow(/at least 2 track points/);
    });

    it("skips blank/malformed lines when mapping indices", async () => {
      const filePath = writeSkiz(dir, "trim-malformed.skiz", {
        trackXml: `<track name="Run" activity="skiing"></track>`,
        nodesCsv: [
          NODES_CSV.split("\n")[0],
          "not,a,valid,row",
          ...NODES_CSV.split("\n").slice(1),
        ].join("\n"),
      });
      await trimSkizTrack(filePath, 0, 1);
      const result = await parseSkizFile(filePath);
      expect(result.points).toHaveLength(2);
    });
  });

  describe("removeSkizTrackPoints", () => {
    it("drops rows at the given point indices", async () => {
      const filePath = writeSkiz(dir, "remove.skiz", {
        trackXml: `<track name="Run" activity="skiing"></track>`,
        nodesCsv: NODES_CSV,
      });
      await removeSkizTrackPoints(filePath, [1]);
      const result = await parseSkizFile(filePath);
      expect(result.points).toHaveLength(3);
    });

    it("rejects removing points that would leave fewer than 2 behind", async () => {
      const filePath = writeSkiz(dir, "remove-too-many.skiz", {
        trackXml: `<track name="Run" activity="skiing"></track>`,
        nodesCsv: NODES_CSV,
      });
      await expect(removeSkizTrackPoints(filePath, [0, 1, 2, 3])).rejects.toThrow(
        /fewer than 2 track points/,
      );
    });

    it("throws when Nodes.csv is missing", async () => {
      const filePath = writeSkiz(dir, "no-nodes.skiz", {
        trackXml: `<track name="Run" activity="skiing"></track>`,
      });
      await expect(removeSkizTrackPoints(filePath, [0])).rejects.toThrow(/No Nodes.csv found/);
    });
  });

  describe("fixSkizElevations", () => {
    it("rewrites the ele field of specific rows, leaving lat/lon and other rows untouched", async () => {
      const filePath = writeSkiz(dir, "fix.skiz", {
        trackXml: `<track name="Run" activity="skiing"></track>`,
        nodesCsv: NODES_CSV,
      });
      await fixSkizElevations(filePath, new Map([[1, 1234.5]]));
      const result = await parseSkizFile(filePath);
      expect(result.points).toHaveLength(4);
      expect(result.points[1].elevation).toBeCloseTo(1234.5);
      expect(result.points[1].lat).toBeCloseTo(45.001);
      expect(result.points[0].elevation).toBeCloseTo(1000);
      expect(result.points[2].elevation).toBeCloseTo(1020);
    });

    it("throws when Nodes.csv is missing", async () => {
      const filePath = writeSkiz(dir, "fix-no-nodes.skiz", {
        trackXml: `<track name="Run" activity="skiing"></track>`,
      });
      await expect(fixSkizElevations(filePath, new Map([[0, 100]]))).rejects.toThrow(
        /No Nodes.csv found/,
      );
    });
  });
});
