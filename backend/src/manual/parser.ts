import { readFile } from "node:fs/promises";

// An activity entered by hand: no track, only the numbers the person typed.
// The file is JSON (see manualActivityFields below) and its name ends in
// MANUAL_EXTENSION, so no other .json in the data folder is ingested.
export const MANUAL_EXTENSION = ".manual.json";

export function isManualFilename(filename) {
  return filename.toLowerCase().endsWith(MANUAL_EXTENSION);
}

// Checks what a person typed and returns exactly the fields the file holds.
// startTime is the instant the client chose for the day (local noon), so the
// server never guesses a time zone.
export function manualActivityFields(input) {
  const title = String(input.title ?? "").trim();
  if (!title) throw new Error("The title must not be empty");
  const startTime = new Date(input.startTime);
  if (Number.isNaN(startTime.getTime())) throw new Error("The date is not valid");
  if (!(input.distanceMeters > 0)) throw new Error("The distance must be more than zero");
  const durationSeconds = input.durationSeconds ?? null;
  if (durationSeconds != null && !(durationSeconds > 0)) {
    throw new Error("The duration must be more than zero");
  }
  const elevationGainMeters = input.elevationGainMeters ?? null;
  if (elevationGainMeters != null && !(elevationGainMeters >= 0)) {
    throw new Error("The elevation gain must not be negative");
  }
  return {
    title,
    activityType: String(input.activityType ?? "").trim() || "Unknown",
    startTime: startTime.toISOString(),
    durationSeconds: durationSeconds == null ? null : Math.round(durationSeconds),
    distanceMeters: Number(input.distanceMeters),
    elevationGainMeters: elevationGainMeters == null ? null : Number(elevationGainMeters),
    notes: String(input.notes ?? "").trim() || null,
  };
}

// Same return shape as the GPX, IGC, and Ski Tracks parsers, with no points.
// A missing duration is stored as zero, with no speeds.
export async function parseManualFile(filePath) {
  const fields = manualActivityFields(JSON.parse(await readFile(filePath, "utf-8")));
  const startTime = new Date(fields.startTime);
  const durationSeconds = fields.durationSeconds ?? 0;
  const speed = durationSeconds > 0 ? fields.distanceMeters / durationSeconds : null;
  return {
    title: fields.title,
    activityType: fields.activityType,
    description: fields.notes,
    startTime,
    endTime: new Date(startTime.getTime() + durationSeconds * 1000),
    durationSeconds,
    distanceMeters: fields.distanceMeters,
    avgSpeedMps: speed,
    movingAvgSpeedMps: speed,
    maxSpeedMps: null,
    totalElevationGain: fields.elevationGainMeters,
    totalElevationLoss: null,
    points: [],
    elevationProfile: [],
  };
}
