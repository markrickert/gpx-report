import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { manualFileContent, writeManualFields } from "./writer.js";
import { parseManualFile } from "./parser.js";

const HIKE = {
  title: "Afternoon Hiking",
  activityType: "Hiking",
  startTime: "2026-10-04T18:00:00.000Z",
  distanceMeters: 6437.4,
  notes: "Roads by the condo",
};

describe("manual writer", () => {
  let dir;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "manual-writer-test-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("changes the given fields, keeps the rest, and backs up the original", async () => {
    const filePath = path.join(dir, "manual-1.manual.json");
    await writeFile(filePath, manualFileContent(HIKE));

    await writeManualFields(filePath, { title: "Road walk", durationSeconds: 5400 });

    const parsed = await parseManualFile(filePath);
    expect(parsed.title).toBe("Road walk");
    expect(parsed.durationSeconds).toBe(5400);
    expect(parsed.activityType).toBe("Hiking");
    expect(parsed.distanceMeters).toBe(6437.4);
    expect(parsed.description).toBe("Roads by the condo");
    expect(await readdir(path.join(dir, "_backups"))).toHaveLength(1);
  });

  it("refuses a change that leaves the file invalid", async () => {
    const filePath = path.join(dir, "manual-2.manual.json");
    await writeFile(filePath, manualFileContent(HIKE));
    await expect(writeManualFields(filePath, { distanceMeters: -5 })).rejects.toThrow(/distance/);
    expect((await parseManualFile(filePath)).distanceMeters).toBe(6437.4);
  });
});
