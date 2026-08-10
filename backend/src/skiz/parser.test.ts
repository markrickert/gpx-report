import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";
import { parseSkizFile } from "./parser.js";

function writeSkiz(dir, filename, { trackXml, nodesCsv }: { trackXml?: string; nodesCsv?: string }) {
  const zip = new AdmZip();
  if (trackXml != null) zip.addFile("Track.xml", Buffer.from(trackXml, "utf-8"));
  if (nodesCsv != null) zip.addFile("Nodes.csv", Buffer.from(nodesCsv, "utf-8"));
  const filePath = path.join(dir, filename);
  zip.writeZip(filePath);
  return filePath;
}

const NODES_CSV = ["1704067200,45.0,7.0,1000,0,0,5,5", "1704067260,45.001,7.0,1050,0,0,5,5"].join(
  "\n",
);

describe("parseSkizFile", () => {
  let dir;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "skiz-parser-test-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("parses Nodes.csv points and Track.xml name/activity", async () => {
    const filePath = writeSkiz(dir, "run.skiz", {
      trackXml: `<track name="Powder Day" activity="downhill skiing"></track>`,
      nodesCsv: NODES_CSV,
    });

    const result = await parseSkizFile(filePath);

    expect(result.title).toBe("Powder Day");
    expect(result.activityType).toBe("Downhill Skiing");
    expect(result.points).toHaveLength(2);
    expect(result.durationSeconds).toBe(60);
    expect(result.totalElevationGain).toBeCloseTo(50);
    expect(result.distanceMeters).toBeGreaterThan(0);
  });

  it("falls back to filename stem when Track.xml has no name", async () => {
    const filePath = writeSkiz(dir, "unnamed-descent.skiz", {
      trackXml: `<track activity="skiing"></track>`,
      nodesCsv: NODES_CSV,
    });

    const result = await parseSkizFile(filePath);
    expect(result.title).toBe("unnamed-descent");
  });

  it("falls back to Skiing when Track.xml has no activity", async () => {
    const filePath = writeSkiz(dir, "no-activity.skiz", {
      trackXml: `<track name="Run"></track>`,
      nodesCsv: NODES_CSV,
    });

    const result = await parseSkizFile(filePath);
    expect(result.activityType).toBe("Skiing");
  });

  it("unescapes XML entities in name and activity", async () => {
    const filePath = writeSkiz(dir, "entities.skiz", {
      trackXml: `<track name="Mom &amp; Dad&apos;s Run" activity="skiing"></track>`,
      nodesCsv: NODES_CSV,
    });

    const result = await parseSkizFile(filePath);
    expect(result.title).toBe("Mom & Dad's Run");
  });

  it("skips malformed CSV lines", async () => {
    const filePath = writeSkiz(dir, "malformed.skiz", {
      trackXml: `<track name="Run" activity="skiing"></track>`,
      nodesCsv: [NODES_CSV, "not,a,valid,row"].join("\n"),
    });

    const result = await parseSkizFile(filePath);
    expect(result.points).toHaveLength(2);
  });

  it("throws when Nodes.csv is missing", async () => {
    const filePath = writeSkiz(dir, "no-nodes.skiz", {
      trackXml: `<track name="Run" activity="skiing"></track>`,
    });

    await expect(parseSkizFile(filePath)).rejects.toThrow(/does not contain Nodes.csv/);
  });

  it("throws when fewer than two valid points are present", async () => {
    const filePath = writeSkiz(dir, "too-short.skiz", {
      trackXml: `<track name="Run" activity="skiing"></track>`,
      nodesCsv: "1704067200,45.0,7.0,1000,0,0,5,5",
    });

    await expect(parseSkizFile(filePath)).rejects.toThrow(/does not contain enough GPS points/);
  });
});
