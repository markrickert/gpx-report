import * as SQLite from "expo-sqlite";
import type { ImportStatus, QueuedImport, Recording, RecordingStatus, TrackPoint } from "./types";

// Opened synchronously at import so the background location task (which can
// run headless on Android, before any screen mounts) can write points without
// waiting on app startup.
const db = SQLite.openDatabaseSync("recordings.db");
db.execSync(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS recordings (
    id TEXT PRIMARY KEY NOT NULL,
    person TEXT NOT NULL,
    status TEXT NOT NULL,
    title TEXT,
    activity_type TEXT NOT NULL DEFAULT 'Unknown',
    started_at INTEGER NOT NULL,
    elapsed_ms INTEGER NOT NULL DEFAULT 0,
    segment_started_at INTEGER,
    segment INTEGER NOT NULL DEFAULT 0,
    upload_attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER,
    last_error TEXT,
    uploaded_filename TEXT
  );
  CREATE TABLE IF NOT EXISTS points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recording_id TEXT NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
    segment INTEGER NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    elevation REAL,
    timestamp INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS points_recording ON points (recording_id, id);
  CREATE TABLE IF NOT EXISTS imports (
    id TEXT PRIMARY KEY NOT NULL,
    person TEXT NOT NULL,
    name TEXT NOT NULL,
    local_uri TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    upload_attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER,
    last_error TEXT
  );
`);
// Added after the first release; CREATE TABLE IF NOT EXISTS won't add it to
// an existing install, and the ALTER throws once the column exists.
try {
  db.execSync("ALTER TABLE recordings ADD COLUMN note TEXT");
} catch {}
try {
  db.execSync("ALTER TABLE points ADD COLUMN accuracy REAL");
  db.execSync("ALTER TABLE points ADD COLUMN altitude_accuracy REAL");
} catch {}

const COLUMNS: Record<keyof Omit<Recording, "id">, string> = {
  person: "person",
  status: "status",
  title: "title",
  activityType: "activity_type",
  note: "note",
  startedAt: "started_at",
  elapsedMs: "elapsed_ms",
  segmentStartedAt: "segment_started_at",
  segment: "segment",
  uploadAttempts: "upload_attempts",
  nextAttemptAt: "next_attempt_at",
  lastError: "last_error",
  uploadedFilename: "uploaded_filename",
};

function toRecording(row: any): Recording {
  return {
    id: row.id,
    person: row.person,
    status: row.status,
    title: row.title,
    activityType: row.activity_type,
    note: row.note,
    startedAt: row.started_at,
    elapsedMs: row.elapsed_ms,
    segmentStartedAt: row.segment_started_at,
    segment: row.segment,
    uploadAttempts: row.upload_attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
    uploadedFilename: row.uploaded_filename,
  };
}

export function createRecording(id: string, now: number, person: string) {
  db.runSync(
    "INSERT INTO recordings (id, person, status, started_at, segment_started_at) VALUES (?, ?, 'recording', ?, ?)",
    id,
    person,
    now,
    now,
  );
}

export function getRecording(id: string): Recording | null {
  const row = db.getFirstSync("SELECT * FROM recordings WHERE id = ?", id);
  return row ? toRecording(row) : null;
}

/** The one recording not yet handed to the upload queue, if any. */
export function getActiveRecording(): Recording | null {
  const row = db.getFirstSync(
    "SELECT * FROM recordings WHERE status IN ('recording', 'paused', 'stopped') ORDER BY started_at DESC LIMIT 1",
  );
  return row ? toRecording(row) : null;
}

export function listRecordings(statuses: RecordingStatus[]): Recording[] {
  const placeholders = statuses.map(() => "?").join(", ");
  return db
    .getAllSync(
      `SELECT * FROM recordings WHERE status IN (${placeholders}) ORDER BY started_at DESC`,
      ...statuses,
    )
    .map(toRecording);
}

export function updateRecording(id: string, fields: Partial<Omit<Recording, "id">>) {
  const keys = Object.keys(fields) as (keyof typeof COLUMNS)[];
  if (keys.length === 0) return;
  db.runSync(
    `UPDATE recordings SET ${keys.map((k) => `${COLUMNS[k]} = ?`).join(", ")} WHERE id = ?`,
    ...keys.map((k) => fields[k] ?? null),
    id,
  );
}

export function appendPoints(recordingId: string, points: TrackPoint[]) {
  db.withTransactionSync(() => {
    for (const p of points) {
      db.runSync(
        "INSERT INTO points (recording_id, segment, lat, lon, elevation, accuracy, altitude_accuracy, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        recordingId,
        p.segment,
        p.lat,
        p.lon,
        p.elevation,
        p.accuracy ?? null,
        p.altitudeAccuracy ?? null,
        p.timestamp,
      );
    }
  });
}

/**
 * `afterId` lets the live Record screen fetch only points added since its
 * last poll instead of re-reading the whole track every second.
 */
export function getPoints(recordingId: string, afterId = 0): (TrackPoint & { id: number })[] {
  return db.getAllSync(
    "SELECT id, segment, lat, lon, elevation, accuracy, altitude_accuracy AS altitudeAccuracy, timestamp FROM points WHERE recording_id = ? AND id > ? ORDER BY id",
    recordingId,
    afterId,
  );
}

export function deleteRecording(id: string) {
  db.withTransactionSync(() => {
    db.runSync("DELETE FROM points WHERE recording_id = ?", id);
    db.runSync("DELETE FROM recordings WHERE id = ?", id);
  });
}

const IMPORT_COLUMNS: Record<keyof Omit<QueuedImport, "id">, string> = {
  person: "person",
  name: "name",
  localUri: "local_uri",
  status: "status",
  createdAt: "created_at",
  uploadAttempts: "upload_attempts",
  nextAttemptAt: "next_attempt_at",
  lastError: "last_error",
};

function toImport(row: any): QueuedImport {
  return {
    id: row.id,
    person: row.person,
    name: row.name,
    localUri: row.local_uri,
    status: row.status,
    createdAt: row.created_at,
    uploadAttempts: row.upload_attempts,
    nextAttemptAt: row.next_attempt_at,
    lastError: row.last_error,
  };
}

export function createImport(
  imp: Pick<QueuedImport, "id" | "person" | "name" | "localUri">,
  now: number,
) {
  db.runSync(
    "INSERT INTO imports (id, person, name, local_uri, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
    imp.id,
    imp.person,
    imp.name,
    imp.localUri,
    now,
  );
}

export function listImports(statuses: ImportStatus[]): QueuedImport[] {
  const placeholders = statuses.map(() => "?").join(", ");
  return db
    .getAllSync(
      `SELECT * FROM imports WHERE status IN (${placeholders}) ORDER BY created_at`,
      ...statuses,
    )
    .map(toImport);
}

export function updateImport(id: string, fields: Partial<Omit<QueuedImport, "id">>) {
  const keys = Object.keys(fields) as (keyof typeof IMPORT_COLUMNS)[];
  if (keys.length === 0) return;
  db.runSync(
    `UPDATE imports SET ${keys.map((k) => `${IMPORT_COLUMNS[k]} = ?`).join(", ")} WHERE id = ?`,
    ...keys.map((k) => fields[k] ?? null),
    id,
  );
}

export function deleteImport(id: string) {
  db.runSync("DELETE FROM imports WHERE id = ?", id);
}
