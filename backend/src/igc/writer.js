import { readFile, writeFile } from "node:fs/promises";
import { B_RECORD_RE, H_DATE_RE } from "./parser.js";

// Drops specific B-record lines by point index. Indices match the order
// parser.js's points array is built in: it walks lines in order, tracking
// whether an HFDTE header has been seen yet, and counts a line as a point
// only once a date is known and the line matches B_RECORD_RE — mirrored
// here via the same two conditions so index N always refers to the same
// point removeIgcTrackPoints and parseIgcFile agree on.
export async function removeIgcTrackPoints(filePath, indicesToRemove) {
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
  await writeFile(filePath, updatedLines.join("\n"), "utf-8");
}
