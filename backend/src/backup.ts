import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";

// Backs up a file before any in-place edit, so a bad trim/fix can be
// recovered by hand. Lives alongside the file (not GPX_FILES_DIRECTORY
// directly, since writer.js doesn't know the ingest root) in a sibling
// _backups/ dir, which watcher.js excludes from ingestion. Shared by the
// gpx/igc/skiz writers, all of which edit source files in place.
export async function backupFile(filePath) {
  const backupsDir = path.join(path.dirname(filePath), "_backups");
  await mkdir(backupsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  await copyFile(filePath, path.join(backupsDir, `${path.basename(filePath)}.${timestamp}.bak`));
}
