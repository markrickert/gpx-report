import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { backupFile, findOriginalBackup, sameTrackPoints } from "./backup.js";

describe("backupFile", () => {
  let dir;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "backup-test-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("copies the file's current contents into a sibling _backups dir", async () => {
    const filePath = path.join(dir, "track.gpx");
    await writeFile(filePath, "original contents", "utf-8");
    await backupFile(filePath);

    const backupsDir = path.join(dir, "_backups");
    const backups = await readdir(backupsDir);
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^track\.gpx\..+\.bak$/);
    expect(await readFile(path.join(backupsDir, backups[0]), "utf-8")).toBe("original contents");
  });

  it("accumulates one backup per call rather than overwriting the previous one", async () => {
    const filePath = path.join(dir, "multi.gpx");
    await writeFile(filePath, "v1", "utf-8");
    await backupFile(filePath);
    await writeFile(filePath, "v2", "utf-8");
    await backupFile(filePath);

    const backupsDir = path.join(dir, "_backups");
    const backups = (await readdir(backupsDir)).filter((f) => f.startsWith("multi.gpx."));
    expect(backups).toHaveLength(2);
  });
});

describe("findOriginalBackup", () => {
  let dir;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "original-test-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns null when the file has never been backed up", async () => {
    expect(await findOriginalBackup(path.join(dir, "untouched.gpx"))).toBeNull();
  });

  it("returns the earliest backup, ignoring other files' backups", async () => {
    const filePath = path.join(dir, "hike.gpx");
    await writeFile(filePath, "v1", "utf-8");
    await backupFile(filePath);
    await writeFile(filePath, "v2", "utf-8");
    await backupFile(filePath);
    // Shares the prefix but is a different file.
    await writeFile(path.join(dir, "hike.gpx.gpx"), "other", "utf-8");
    await backupFile(path.join(dir, "hike.gpx.gpx"));

    const original = await findOriginalBackup(filePath);
    expect(await readFile(original, "utf-8")).toBe("v1");
  });
});

describe("sameTrackPoints", () => {
  const point = (lat, elevation = 100, timestamp = 0) => ({ lat, lon: -105, elevation, timestamp });

  it("matches identical points", () => {
    expect(sameTrackPoints([point(39), point(39.1)], [point(39), point(39.1)])).toBe(true);
  });

  it("differs after a trim", () => {
    expect(sameTrackPoints([point(39), point(39.1)], [point(39.1)])).toBe(false);
  });

  it("differs after an elevation fix", () => {
    expect(sameTrackPoints([point(39), point(39.1)], [point(39), point(39.1, 90)])).toBe(false);
  });
});
