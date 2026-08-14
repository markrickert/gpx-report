import AdmZip from "adm-zip";
import { escapeXml } from "../gpx/writer.js";
import { backupFile } from "../backup.js";

// Matches the opening <track ...> tag in Track.xml, across its (multi-line)
// attribute list, up to the first '>'.
const TRACK_TAG_RE = /<track\b[\s\S]*?>/;

function setAttribute(tag, name, value) {
  const attrRe = new RegExp(`(\\s${name}=")[^"]*(")`);
  if (attrRe.test(tag)) {
    return tag.replace(attrRe, `$1${escapeXml(value)}$2`);
  }
  return tag.replace(/>$/, ` ${name}="${escapeXml(value)}">`);
}

async function updateTrackAttribute(filePath, name, value) {
  const zip = new AdmZip(filePath);
  const entry = zip.getEntry("Track.xml");
  if (!entry) {
    throw new Error(`No Track.xml found in ${filePath}`);
  }
  const xml = entry.getData().toString("utf-8");
  const match = xml.match(TRACK_TAG_RE);
  if (!match) {
    throw new Error(`No <track> element found in ${filePath}`);
  }
  const updatedTag = setAttribute(match[0], name, value);
  const updated = xml.slice(0, match.index) + updatedTag + xml.slice(match.index + match[0].length);
  zip.updateFile("Track.xml", Buffer.from(updated, "utf-8"));
  await backupFile(filePath);
  zip.writeZip(filePath);
}

export async function updateSkizTitle(filePath, title) {
  await updateTrackAttribute(filePath, "name", title);
}

export async function updateSkizType(filePath, type) {
  await updateTrackAttribute(filePath, "activity", type);
}

// Drops Nodes.csv lines outside [startIndex, endIndex] (inclusive). Indices
// match the order skiz/parser.js's points array is built in: it walks
// Nodes.csv lines in order, skipping blank/unparseable ones, so the Nth
// valid line is point index N — mirrored here via the same skip condition.
export async function trimSkizTrack(filePath, startIndex, endIndex) {
  const zip = new AdmZip(filePath);
  const entry = zip.getEntry("Nodes.csv");
  if (!entry) {
    throw new Error(`No Nodes.csv found in ${filePath}`);
  }

  const lines = entry.getData().toString("utf-8").split(/\r?\n/);
  const validLineIndices = [];
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    const [ts, lat, lon, ele] = line.split(",").map(Number);
    if ([ts, lat, lon, ele].some(Number.isNaN)) return;
    validLineIndices.push(i);
  });

  if (validLineIndices.length === 0) {
    throw new Error(`No GPS points found in ${filePath}`);
  }
  if (startIndex < 0 || endIndex >= validLineIndices.length || startIndex > endIndex) {
    throw new Error("Invalid trim range");
  }
  if (endIndex - startIndex + 1 < 2) {
    throw new Error("Trim range must keep at least 2 track points");
  }

  const keepLineIndices = new Set(validLineIndices.slice(startIndex, endIndex + 1));
  const updatedLines = lines.filter((_, i) => keepLineIndices.has(i));
  zip.updateFile("Nodes.csv", Buffer.from(updatedLines.join("\n") + "\n", "utf-8"));
  await backupFile(filePath);
  zip.writeZip(filePath);
}

// Drops Nodes.csv lines at specific point indices (not necessarily
// contiguous), e.g. GPS outlier points scattered through the track. Same
// index contract as trimSkizTrack above.
export async function removeSkizTrackPoints(filePath, indicesToRemove: number[]) {
  const zip = new AdmZip(filePath);
  const entry = zip.getEntry("Nodes.csv");
  if (!entry) {
    throw new Error(`No Nodes.csv found in ${filePath}`);
  }

  const lines = entry.getData().toString("utf-8").split(/\r?\n/);
  const validLineIndices = [];
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    const [ts, lat, lon, ele] = line.split(",").map(Number);
    if ([ts, lat, lon, ele].some(Number.isNaN)) return;
    validLineIndices.push(i);
  });

  if (validLineIndices.length === 0) {
    throw new Error(`No GPS points found in ${filePath}`);
  }

  const removeSet = new Set(indicesToRemove);
  if (validLineIndices.length - removeSet.size < 2) {
    throw new Error("Removing these points would leave fewer than 2 track points");
  }

  const removeLineIndices = new Set(
    [...removeSet].map((pointIndex) => validLineIndices[pointIndex]),
  );
  const updatedLines = lines.filter((_, i) => !removeLineIndices.has(i));
  zip.updateFile("Nodes.csv", Buffer.from(updatedLines.join("\n") + "\n", "utf-8"));
  await backupFile(filePath);
  zip.writeZip(filePath);
}

// Rewrites the `ele` (4th CSV field) of specific Nodes.csv lines in place,
// e.g. to normalize elevation-spike glitches without touching lat/lon/time
// or any other point. Same index contract as removeSkizTrackPoints above.
// `corrections` is a Map<index, elevationMeters>.
export async function fixSkizElevations(filePath, corrections) {
  const zip = new AdmZip(filePath);
  const entry = zip.getEntry("Nodes.csv");
  if (!entry) {
    throw new Error(`No Nodes.csv found in ${filePath}`);
  }

  const lines = entry.getData().toString("utf-8").split(/\r?\n/);
  const validLineIndices = [];
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    const [ts, lat, lon, ele] = line.split(",").map(Number);
    if ([ts, lat, lon, ele].some(Number.isNaN)) return;
    validLineIndices.push(i);
  });

  if (validLineIndices.length === 0) {
    throw new Error(`No GPS points found in ${filePath}`);
  }

  const correctionsByLineIndex = new Map(
    [...corrections].map(([pointIndex, elevation]) => [validLineIndices[pointIndex], elevation]),
  );

  const updatedLines = lines.map((line, i) => {
    if (!correctionsByLineIndex.has(i)) return line;
    const fields = line.split(",");
    fields[3] = String(correctionsByLineIndex.get(i));
    return fields.join(",");
  });

  zip.updateFile("Nodes.csv", Buffer.from(updatedLines.join("\n") + "\n", "utf-8"));
  await backupFile(filePath);
  zip.writeZip(filePath);
}
