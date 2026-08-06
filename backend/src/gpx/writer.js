import { readFile, writeFile } from "node:fs/promises";

function escapeXml(value) {
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
