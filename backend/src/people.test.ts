import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  DEFAULT_PERSON,
  slugifyPerson,
  personFromHeader,
  fileIdentity,
  listPeople,
} from "./people.js";

describe("slugifyPerson", () => {
  it("lowercases and dashes non-alphanumerics", () => {
    expect(slugifyPerson("  Mary Jo! ")).toBe("mary-jo");
    expect(slugifyPerson("Kristin")).toBe("kristin");
  });

  it("returns null for empty or reserved names", () => {
    expect(slugifyPerson("")).toBeNull();
    expect(slugifyPerson("  !! ")).toBeNull();
    expect(slugifyPerson(null)).toBeNull();
    expect(slugifyPerson("Stats")).toBeNull();
    expect(slugifyPerson("_backups")).toBeNull();
  });
});

describe("personFromHeader", () => {
  it("falls back to the default person when missing or invalid", () => {
    expect(personFromHeader(undefined)).toBe(DEFAULT_PERSON);
    expect(personFromHeader("settings")).toBe(DEFAULT_PERSON);
    expect(personFromHeader("Kristin")).toBe("kristin");
  });
});

describe("fileIdentity", () => {
  const base = "/data/gpx";

  it("assigns top-level files to the default person, keyed by basename", () => {
    expect(fileIdentity(base, "/data/gpx/ride.gpx")).toEqual({
      gpxFilename: "ride.gpx",
      owner: DEFAULT_PERSON,
    });
  });

  it("assigns files in a person folder to that person, keyed by relative path", () => {
    expect(fileIdentity(base, "/data/gpx/kristin/hike.gpx")).toEqual({
      gpxFilename: "kristin/hike.gpx",
      owner: "kristin",
    });
  });

  it("falls back to basename + default person for files outside the base dir", () => {
    expect(fileIdentity(base, "/tmp/other/x.gpx")).toEqual({
      gpxFilename: "x.gpx",
      owner: DEFAULT_PERSON,
    });
    expect(fileIdentity(undefined, "/tmp/other/x.gpx")).toEqual({
      gpxFilename: "x.gpx",
      owner: DEFAULT_PERSON,
    });
  });
});

describe("listPeople", () => {
  let dir;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "people-test-"));
    await mkdir(path.join(dir, "kristin"));
    await mkdir(path.join(dir, "_backups"));
    await mkdir(path.join(dir, "alex"));
    await writeFile(path.join(dir, "ride.gpx"), "", "utf-8");
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns the default person plus every person folder, sorted, skipping _backups", async () => {
    expect(await listPeople(dir)).toEqual(["alex", "kristin", DEFAULT_PERSON].sort());
  });
});
