import { clientFor } from "@/lib/apollo";
import { SAVE_RECORDED_ACTIVITY } from "@/graphql/queries";
import { buildGpxXml } from "./gpx";
import * as store from "./store";

const MAX_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;

export function retryDelayMs(attempts: number) {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), MAX_RETRY_DELAY_MS);
}

let draining: Promise<void> | null = null;

/**
 * Uploads every pending/failed recording whose backoff has elapsed. Safe to
 * call from anywhere (app start, network regained, app foregrounded, after a
 * save): concurrent calls share one run, and the recording id is sent as
 * clientId so a retry after a lost response never duplicates on the server.
 */
export function drainUploadQueue(now = Date.now()) {
  draining ??= drain(now).finally(() => {
    draining = null;
  });
  return draining;
}

async function drain(now: number) {
  const due = store
    .listRecordings(["pending", "failed"])
    .filter((r) => r.nextAttemptAt == null || r.nextAttemptAt <= now);
  for (const rec of due) {
    try {
      const gpxContent = buildGpxXml(
        store.getPoints(rec.id),
        rec.title ?? "Recorded activity",
        rec.activityType,
        rec.note,
      );
      const { data } = await clientFor(rec.person).mutate({
        mutation: SAVE_RECORDED_ACTIVITY,
        variables: { gpxContent, clientId: rec.id },
      });
      store.updateRecording(rec.id, {
        status: "uploaded",
        uploadedFilename: data.saveRecordedActivity.filename,
        lastError: null,
        nextAttemptAt: null,
      });
    } catch (err) {
      const attempts = rec.uploadAttempts + 1;
      store.updateRecording(rec.id, {
        status: "failed",
        uploadAttempts: attempts,
        nextAttemptAt: now + retryDelayMs(attempts),
        lastError: (err as Error).message,
      });
    }
  }
  for (const person of new Set(due.map((r) => r.person)))
    clientFor(person)
      .refetchQueries({ include: "active" })
      .catch(() => {});
}

export function retryNow(id: string) {
  store.updateRecording(id, { nextAttemptAt: null });
  return drainUploadQueue();
}
