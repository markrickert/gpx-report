import path from "node:path";
import { readdir } from "node:fs/promises";

// Identity is a name only (no passwords) — the Tailscale network boundary is
// the real access control. Each person's files live in their own
// GPX_FILES_DIRECTORY/<person>/ folder; top-level files (everything that
// predates multiple accounts) belong to DEFAULT_PERSON.
export const DEFAULT_PERSON = process.env.DEFAULT_PERSON || "mark";

// Names that would collide with web routes (/<person>/... sits beside
// /stats, /heatmap, etc.) or with writer.ts's _backups/ folders.
const RESERVED = new Set(["activities", "record", "settings", "stats", "heatmap", "backups"]);

export function slugifyPerson(name) {
  if (typeof name !== "string") return null;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (!slug || RESERVED.has(slug)) return null;
  return slug;
}

export function personFromHeader(value) {
  return slugifyPerson(Array.isArray(value) ? value[0] : value) ?? DEFAULT_PERSON;
}

export function fileIdentity(baseDir, absPath) {
  const rel = baseDir ? path.relative(baseDir, absPath) : "";
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    return { gpxFilename: path.basename(absPath), owner: DEFAULT_PERSON };
  }
  const segments = rel.split(path.sep);
  if (segments.length === 1) return { gpxFilename: rel, owner: DEFAULT_PERSON };
  return { gpxFilename: segments.join("/"), owner: segments[0] };
}

export async function listPeople(baseDir) {
  const entries = await readdir(baseDir, { withFileTypes: true });
  const people = new Set([DEFAULT_PERSON]);
  for (const e of entries) {
    if (e.isDirectory() && e.name !== "_backups") people.add(e.name);
  }
  return [...people].sort();
}
