import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { removeIgcTrackPoints, fixIgcElevations } from "./writer.js";
import { parseIgcFile } from "./parser.js";

// B HHMMSS DDMMmmm N/S DDDMMmmm E/W A PPPPP GGGGG
function bRecord({ time, latMin }) {
  return `B${time}52${latMin}N00500000WA0010000100`;
}

function igcDoc(times) {
  return [
    "HFDTE010124",
    ...times.map((time, i) => bRecord({ time, latMin: String(30000 + i * 1000).padStart(5, "0") })),
  ].join("\n");
}

describe("removeIgcTrackPoints", () => {
  let dir;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "igc-writer-test-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeIgc(filename, contents) {
    const filePath = path.join(dir, filename);
    await writeFile(filePath, contents, "utf-8");
    return filePath;
  }

  it("drops the B-record at the given point index, keeping the rest", async () => {
    const filePath = await writeIgc("remove.igc", igcDoc(["100000", "100010", "100020", "100030"]));
    await removeIgcTrackPoints(filePath, [1]);

    const result = await parseIgcFile(filePath);
    expect(result.points).toHaveLength(3);
  });

  it("ignores non-B-record lines when mapping indices, e.g. a leading HFDTE", async () => {
    const doc = igcDoc(["100000", "100010", "100020"]);
    const filePath = await writeIgc("keep-headers.igc", doc);
    await removeIgcTrackPoints(filePath, [0]);

    const text = await readFile(filePath, "utf-8");
    expect(text).toContain("HFDTE010124");
    const result = await parseIgcFile(filePath);
    expect(result.points).toHaveLength(2);
  });

  it("rejects removing points that would leave fewer than 2 behind", async () => {
    const filePath = await writeIgc("too-many.igc", igcDoc(["100000", "100010", "100020"]));
    await expect(removeIgcTrackPoints(filePath, [0, 1, 2])).rejects.toThrow(
      /fewer than 2 track points/,
    );
  });

  it("throws when there are no B-records", async () => {
    const filePath = await writeIgc("no-records.igc", "HFDTE010124");
    await expect(removeIgcTrackPoints(filePath, [0])).rejects.toThrow(/No B-records found/);
  });
});

describe("fixIgcElevations", () => {
  let dir;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "igc-writer-fix-test-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeIgc(filename, contents) {
    const filePath = path.join(dir, filename);
    await writeFile(filePath, contents, "utf-8");
    return filePath;
  }

  it("rewrites the GNSS-altitude field of the given point, leaving lat/lon and other points untouched", async () => {
    const filePath = await writeIgc("fix.igc", igcDoc(["100000", "100010", "100020", "100030"]));
    await fixIgcElevations(filePath, new Map([[1, 250]]));

    const result = await parseIgcFile(filePath);
    expect(result.points).toHaveLength(4);
    expect(result.points[1].elevation).toBe(250);
    expect(result.points[0].elevation).toBe(100);
    expect(result.points[2].elevation).toBe(100);
  });

  it("zero-pads and clamps to non-negative when writing the fixed-width field", async () => {
    const filePath = await writeIgc("fix-pad.igc", igcDoc(["100000", "100010"]));
    await fixIgcElevations(filePath, new Map([[0, 7]]));
    const result = await parseIgcFile(filePath);
    expect(result.points[0].elevation).toBe(7);
  });

  it("throws when there are no B-records", async () => {
    const filePath = await writeIgc("fix-no-records.igc", "HFDTE010124");
    await expect(fixIgcElevations(filePath, new Map([[0, 100]]))).rejects.toThrow(
      /No B-records found/,
    );
  });
});

describe("backups", () => {
  let dir;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "igc-writer-backup-test-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("copies the original into a sibling _backups dir before each edit", async () => {
    const original = igcDoc(["100000", "100010", "100020"]);
    const filePath = path.join(dir, "backup-me.igc");
    await writeFile(filePath, original, "utf-8");
    await removeIgcTrackPoints(filePath, [1]);

    const backupsDir = path.join(dir, "_backups");
    const backupsOf = async () =>
      (await readdir(backupsDir)).filter((f) => f.startsWith("backup-me.igc."));

    const backups = await backupsOf();
    expect(backups).toHaveLength(1);
    expect(await readFile(path.join(backupsDir, backups[0]), "utf-8")).toBe(original);

    await fixIgcElevations(filePath, new Map([[0, 200]]));
    expect(await backupsOf()).toHaveLength(2);
  });
});
