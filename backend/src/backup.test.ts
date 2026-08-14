import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { backupFile } from "./backup.js";

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
