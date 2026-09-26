import { constants } from "node:fs";
import { mkdir, copyFile, readdir } from "node:fs/promises";
import path from "node:path";

// Backs up a file before any in-place edit, so a bad trim/fix can be
// recovered by hand. Lives alongside the file (not GPX_FILES_DIRECTORY
// directly, since writer.js doesn't know the ingest root) in a sibling
// _backups/ dir, which watcher.js excludes from ingestion. Shared by the
// gpx/igc/skiz writers, all of which edit source files in place.
export async function backupFile(filePath) {
  const backupsDir = path.join(path.dirname(filePath), "_backups");
  await mkdir(backupsDir, { recursive: true });
  // Never overwrite an earlier backup (the first one is the original upload):
  // two edits in the same millisecond wait for the next timestamp instead.
  for (;;) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    try {
      await copyFile(
        filePath,
        path.join(backupsDir, `${path.basename(filePath)}.${timestamp}.bak`),
        constants.COPYFILE_EXCL,
      );
      return;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }
}

const BACKUP_SUFFIX_RE = /^\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.bak$/;

// The earliest backup is the file as it was before its first edit — the
// original upload. The ISO-style timestamps sort lexically.
export async function findOriginalBackup(filePath) {
  const backupsDir = path.join(path.dirname(filePath), "_backups");
  const base = path.basename(filePath);
  let entries;
  try {
    entries = await readdir(backupsDir);
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  const backups = entries
    .filter((f) => f.startsWith(base) && BACKUP_SUFFIX_RE.test(f.slice(base.length)))
    .sort();
  return backups.length ? path.join(backupsDir, backups[0]) : null;
}
