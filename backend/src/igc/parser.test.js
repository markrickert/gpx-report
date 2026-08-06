import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseIgcFile, haversineMeters } from "./parser.js";

// B HHMMSS DDMMmmm N/S DDDMMmmm E/W A PPPPP GGGGG
function bRecord({ time, latDeg, latMin, ns, lonDeg, lonMin, ew, gnssAlt }) {
  return `B${time}${latDeg}${latMin}${ns}${lonDeg}${lonMin}${ew}A00000${gnssAlt}`;
}

describe("haversineMeters", () => {
  it("computes the great-circle distance between two points", () => {
    const dist = haversineMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
    expect(dist).toBeGreaterThan(111000);
    expect(dist).toBeLessThan(111400);
  });

  it("returns 0 for identical points", () => {
    expect(haversineMeters({ lat: 45, lon: 10 }, { lat: 45, lon: 10 })).toBe(0);
  });
});

describe("parseIgcFile", () => {
  let dir;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "igc-parser-test-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeIgc(filename, lines) {
    const filePath = path.join(dir, filename);
    await writeFile(filePath, lines.join("\n"), "utf-8");
    return filePath;
  }

  it("parses B-records into points and derives distance/duration/elevation stats", async () => {
    const filePath = await writeIgc("flight.igc", [
      "HFDTE010124",
      bRecord({
        time: "100000",
        latDeg: "52",
        latMin: "30000",
        ns: "N",
        lonDeg: "005",
        lonMin: "00000",
        ew: "W",
        gnssAlt: "00100",
      }),
      bRecord({
        time: "100100",
        latDeg: "52",
        latMin: "31000",
        ns: "N",
        lonDeg: "005",
        lonMin: "00000",
        ew: "W",
        gnssAlt: "00150",
      }),
    ]);

    const result = await parseIgcFile(filePath);

    expect(result.title).toBe("flight");
    expect(result.activityType).toBe("Paragliding");
    expect(result.durationSeconds).toBe(60);
    expect(result.points).toHaveLength(2);
    expect(result.distanceMeters).toBeGreaterThan(0);
    expect(result.totalElevationGain).toBeCloseTo(50);
    expect(result.totalElevationLoss).toBeCloseTo(0);
    expect(result.avgSpeedMps).toBeCloseTo(result.distanceMeters / 60);
  });

  it("applies southern/western hemisphere sign flips", async () => {
    const filePath = await writeIgc("southern.igc", [
      "HFDTE010124",
      bRecord({
        time: "100000",
        latDeg: "10",
        latMin: "00000",
        ns: "S",
        lonDeg: "020",
        lonMin: "00000",
        ew: "E",
        gnssAlt: "00100",
      }),
      bRecord({
        time: "100100",
        latDeg: "10",
        latMin: "01000",
        ns: "S",
        lonDeg: "020",
        lonMin: "00000",
        ew: "E",
        gnssAlt: "00100",
      }),
    ]);

    const result = await parseIgcFile(filePath);
    expect(result.points[0].lat).toBeLessThan(0);
    expect(result.points[0].lon).toBeGreaterThan(0);
  });

  it("ignores B-records before any HFDTE date header", async () => {
    const filePath = await writeIgc("no-date-yet.igc", [
      bRecord({
        time: "090000",
        latDeg: "52",
        latMin: "00000",
        ns: "N",
        lonDeg: "005",
        lonMin: "00000",
        ew: "W",
        gnssAlt: "00100",
      }),
      "HFDTE010124",
      bRecord({
        time: "100000",
        latDeg: "52",
        latMin: "30000",
        ns: "N",
        lonDeg: "005",
        lonMin: "00000",
        ew: "W",
        gnssAlt: "00100",
      }),
      bRecord({
        time: "100100",
        latDeg: "52",
        latMin: "31000",
        ns: "N",
        lonDeg: "005",
        lonMin: "00000",
        ew: "W",
        gnssAlt: "00100",
      }),
    ]);

    const result = await parseIgcFile(filePath);
    expect(result.points).toHaveLength(2);
  });

  it("throws when fewer than two B-records are present", async () => {
    const filePath = await writeIgc("too-short.igc", [
      "HFDTE010124",
      bRecord({
        time: "100000",
        latDeg: "52",
        latMin: "30000",
        ns: "N",
        lonDeg: "005",
        lonMin: "00000",
        ew: "W",
        gnssAlt: "00100",
      }),
    ]);

    await expect(parseIgcFile(filePath)).rejects.toThrow(/does not contain enough B-records/);
  });
});
