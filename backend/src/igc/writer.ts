import { readFile, writeFile } from "node:fs/promises";
import { B_RECORD_RE, H_DATE_RE } from "./parser.js";
import { backupFile } from "../backup.js";

// Drops specific B-record lines by point index. Indices match the order
// parser.js's points array is built in: it walks lines in order, tracking
// whether an HFDTE header has been seen yet, and counts a line as a point
// only once a date is known and the line matches B_RECORD_RE — mirrored
// here via the same two conditions so index N always refers to the same
// point removeIgcTrackPoints and parseIgcFile agree on.
export async function removeIgcTrackPoints(filePath, indicesToRemove: number[]) {
  const text = await readFile(filePath, "utf-8");
  const lines = text.split(/\r?\n/);

  let dateSeen = false;
  const pointLineIndices = [];
  lines.forEach((line, i) => {
    if (H_DATE_RE.test(line)) {
      dateSeen = true;
      return;
    }
    if (dateSeen && B_RECORD_RE.test(line)) pointLineIndices.push(i);
  });

  if (pointLineIndices.length === 0) {
    throw new Error(`No B-records found in ${filePath}`);
  }

  const removeSet = new Set(indicesToRemove);
  if (pointLineIndices.length - removeSet.size < 2) {
    throw new Error("Removing these points would leave fewer than 2 track points");
  }

  const removeLineIndices = new Set(
    [...removeSet].map((pointIndex) => pointLineIndices[pointIndex]),
  );
  const updatedLines = lines.filter((_, i) => !removeLineIndices.has(i));
  await backupFile(filePath);
  await writeFile(filePath, updatedLines.join("\n"), "utf-8");
}

// Fixed-width offset of the GNSS-altitude field (GGGGG, the last group in
// B_RECORD_RE) within a B-record line — the field parser.js reads as
// `elevation` (not the pressure-altitude PPPPP field just before it).
// 'B' + HHMMSS(6) + DDMMmmm(7) + [NS](1) + DDDMMmmm(8) + [EW](1) + [AV](1) +
// PPPPP(5) = 30 characters in.
const GNSS_ALT_START = 30;
const GNSS_ALT_LENGTH = 5;

// Rewrites the GNSS-altitude field of specific B-records in place, e.g. to
// normalize elevation-spike glitches without touching lat/lon/time or any
// other point. Same index contract as removeIgcTrackPoints above.
// `corrections` is a Map<index, elevationMeters>.
export async function fixIgcElevations(filePath, corrections) {
  const text = await readFile(filePath, "utf-8");
  const lines = text.split(/\r?\n/);

  let dateSeen = false;
  const pointLineIndices = [];
  lines.forEach((line, i) => {
    if (H_DATE_RE.test(line)) {
      dateSeen = true;
      return;
    }
    if (dateSeen && B_RECORD_RE.test(line)) pointLineIndices.push(i);
  });

  if (pointLineIndices.length === 0) {
    throw new Error(`No B-records found in ${filePath}`);
  }

  const correctionsByLineIndex = new Map(
    [...corrections].map(([pointIndex, elevation]) => [pointLineIndices[pointIndex], elevation]),
  );

  const updatedLines = lines.map((line, i) => {
    if (!correctionsByLineIndex.has(i)) return line;
    const elevation = Math.max(0, Math.round(correctionsByLineIndex.get(i)));
    const padded = String(elevation).padStart(GNSS_ALT_LENGTH, "0").slice(-GNSS_ALT_LENGTH);
    return line.slice(0, GNSS_ALT_START) + padded + line.slice(GNSS_ALT_START + GNSS_ALT_LENGTH);
  });

  await backupFile(filePath);
  await writeFile(filePath, updatedLines.join("\n"), "utf-8");
}
