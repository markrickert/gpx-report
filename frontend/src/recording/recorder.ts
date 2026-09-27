import { randomUUID } from "expo-crypto";
import * as store from "./store";
import { requestLocationPermissions, startLocation, stopLocation } from "./location-source";
import { drainUploadQueue } from "./upload-queue";
import type { Recording } from "./types";

// State machine: recording ⇄ paused → stopped → pending (upload queue).
// All state lives in the store so the background task and a relaunched app
// see the same recording; these functions are the only writers of `status`
// before upload.

export async function startRecording(person: string) {
  const perms = await requestLocationPermissions();
  if (!perms.granted) {
    return { error: "Location permission was denied. Enable it in Settings to record." };
  }
  store.createRecording(randomUUID(), Date.now(), person);
  try {
    await startLocation();
  } catch (err) {
    const rec = store.getActiveRecording();
    if (rec) store.deleteRecording(rec.id);
    return { error: `Couldn't start GPS: ${(err as Error).message}` };
  }
  return perms.background
    ? {}
    : {
        warning:
          'Background location is off — set location to "Always" so recording continues with the screen locked.',
      };
}

export async function pauseRecording(rec: Recording, now = Date.now()) {
  await stopLocation();
  store.updateRecording(rec.id, {
    status: "paused",
    elapsedMs: rec.elapsedMs + (now - (rec.segmentStartedAt ?? now)),
    segmentStartedAt: null,
  });
}

export async function resumeRecording(rec: Recording, now = Date.now()) {
  store.updateRecording(rec.id, {
    status: "recording",
    segment: rec.segment + 1,
    segmentStartedAt: now,
  });
  await startLocation();
}

export async function stopRecording(rec: Recording, now = Date.now()) {
  await stopLocation();
  const running = rec.status === "recording" ? now - (rec.segmentStartedAt ?? now) : 0;
  store.updateRecording(rec.id, {
    status: "stopped",
    elapsedMs: rec.elapsedMs + running,
    segmentStartedAt: null,
  });
}

export function discardRecording(rec: Recording) {
  store.deleteRecording(rec.id);
}

export function elapsedMs(rec: Recording, now = Date.now()) {
  return (
    rec.elapsedMs +
    (rec.status === "recording" && rec.segmentStartedAt ? now - rec.segmentStartedAt : 0)
  );
}

/**
 * Hands the recording to the upload queue and resolves after the first
 * upload attempt. The GPX is built at upload time from the stored points, so
 * an offline save costs nothing extra; a failed attempt just stays queued.
 */
export async function finishRecording(
  rec: Recording,
  title: string,
  activityType: string,
  note: string,
) {
  store.updateRecording(rec.id, {
    status: "pending",
    title: title.trim() || `Recorded ${new Date(rec.startedAt).toLocaleString()}`,
    activityType,
    note: note.trim() || null,
    nextAttemptAt: null,
  });
  await drainUploadQueue();
  return store.getRecording(rec.id);
}
