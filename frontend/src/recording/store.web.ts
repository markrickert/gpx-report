import type { Recording, RecordingStatus, TrackPoint } from "./types";

// Browser recording is foreground-only (the tab must stay open), so an
// in-memory store is enough; expo-sqlite on web would need COOP/COEP headers
// for its wasm build. Same exports as store.ts.
const recordings = new Map<string, Recording>();
const points: (TrackPoint & { id: number; recordingId: string })[] = [];
let nextPointId = 1;

export function createRecording(id: string, now: number, person: string) {
  recordings.set(id, {
    id,
    person,
    status: "recording",
    title: null,
    activityType: "Unknown",
    startedAt: now,
    elapsedMs: 0,
    segmentStartedAt: now,
    segment: 0,
    uploadAttempts: 0,
    nextAttemptAt: null,
    lastError: null,
    uploadedFilename: null,
  });
}

export function getRecording(id: string): Recording | null {
  const rec = recordings.get(id);
  return rec ? { ...rec } : null;
}

export function getActiveRecording(): Recording | null {
  const active = listRecordings(["recording", "paused", "stopped"]);
  return active[0] ?? null;
}

export function listRecordings(statuses: RecordingStatus[]): Recording[] {
  return [...recordings.values()]
    .filter((r) => statuses.includes(r.status))
    .sort((a, b) => b.startedAt - a.startedAt)
    .map((r) => ({ ...r }));
}

export function updateRecording(id: string, fields: Partial<Omit<Recording, "id">>) {
  const rec = recordings.get(id);
  if (rec) recordings.set(id, { ...rec, ...fields });
}

export function appendPoints(recordingId: string, newPoints: TrackPoint[]) {
  for (const p of newPoints) points.push({ ...p, id: nextPointId++, recordingId });
}

export function getPoints(recordingId: string, afterId = 0): (TrackPoint & { id: number })[] {
  return points
    .filter((p) => p.recordingId === recordingId && p.id > afterId)
    .map(({ recordingId: _, ...p }) => p);
}

export function deleteRecording(id: string) {
  recordings.delete(id);
  for (let i = points.length - 1; i >= 0; i--)
    if (points[i].recordingId === id) points.splice(i, 1);
}
