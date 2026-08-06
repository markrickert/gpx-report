import { readFile, writeFile } from "node:fs/promises";

// Exported for reuse by skiz/writer.js, which needs the same XML-attribute
// escaping for Track.xml.
export function escapeXml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Replaces (or inserts) the <name> of the first <trk> element, matching what
// parser.js's resolveTitle() reads back. Raw string manipulation rather than
// an XML DOM library, since this is the only write path the backend needs.
const TRK_NAME_RE = /(<trk\b[^>]*>\s*)(<name>[\s\S]*?<\/name>\s*)?/;

export async function updateGpxTitle(filePath, title) {
  const xml = await readFile(filePath, "utf-8");
  if (!TRK_NAME_RE.test(xml)) {
    throw new Error(`No <trk> element found in ${filePath}`);
  }
  const updated = xml.replace(TRK_NAME_RE, `$1<name>${escapeXml(title)}</name>\n  `);
  await writeFile(filePath, updated, "utf-8");
}

// Same pattern as updateGpxTitle, but for <trk><type>, matching what
// parser.js's resolveActivityType() reads back (it prefers <type> over the
// filename guess whenever <type> is present).
const TRK_TYPE_RE = /(<trk\b[^>]*>\s*(?:<name>[\s\S]*?<\/name>\s*)?)(<type>[\s\S]*?<\/type>\s*)?/;

export async function updateGpxType(filePath, type) {
  const xml = await readFile(filePath, "utf-8");
  if (!TRK_TYPE_RE.test(xml)) {
    throw new Error(`No <trk> element found in ${filePath}`);
  }
  const updated = xml.replace(TRK_TYPE_RE, `$1<type>${escapeXml(type)}</type>\n  `);
  await writeFile(filePath, updated, "utf-8");
}

// Drops <trkpt> elements outside [startIndex, endIndex] (inclusive), keeping
// everything else in the file untouched. Indices match the order parser.js's
// points.flatMap() produces, which walks <trkpt> elements in file order, so
// the Nth <trkpt> in the file is point index N.
const TRKPT_RE = /<trkpt\b[^>]*>[\s\S]*?<\/trkpt>\s*/g;

export async function trimGpxTrack(filePath, startIndex, endIndex) {
  const xml = await readFile(filePath, "utf-8");
  const matches = [...xml.matchAll(TRKPT_RE)];
  if (matches.length === 0) {
    throw new Error(`No <trkpt> elements found in ${filePath}`);
  }
  if (startIndex < 0 || endIndex >= matches.length || startIndex > endIndex) {
    throw new Error("Invalid trim range");
  }
  if (endIndex - startIndex + 1 < 2) {
    throw new Error("Trim range must keep at least 2 track points");
  }

  let result = "";
  let cursor = 0;
  matches.forEach((match, i) => {
    result += xml.slice(cursor, match.index);
    if (i >= startIndex && i <= endIndex) {
      result += match[0];
    }
    cursor = match.index + match[0].length;
  });
  result += xml.slice(cursor);
  await writeFile(filePath, result, "utf-8");
}

// Drops <trkpt> elements at specific indices (not necessarily contiguous),
// e.g. GPS outlier points scattered through the track. Same index contract
// as trimGpxTrack above.
export async function removeGpxTrackPoints(filePath, indicesToRemove) {
  const xml = await readFile(filePath, "utf-8");
  const matches = [...xml.matchAll(TRKPT_RE)];
  if (matches.length === 0) {
    throw new Error(`No <trkpt> elements found in ${filePath}`);
  }

  const removeSet = new Set(indicesToRemove);
  if (matches.length - removeSet.size < 2) {
    throw new Error("Removing these points would leave fewer than 2 track points");
  }

  let result = "";
  let cursor = 0;
  matches.forEach((match, i) => {
    result += xml.slice(cursor, match.index);
    if (!removeSet.has(i)) {
      result += match[0];
    }
    cursor = match.index + match[0].length;
  });
  result += xml.slice(cursor);
  await writeFile(filePath, result, "utf-8");
}
