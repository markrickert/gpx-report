import { clientFor } from "@/lib/apollo";
import { IMPORT_ACTIVITY_FILE, SAVE_RECORDED_ACTIVITY } from "@/graphql/queries";
import { buildGpxXml } from "./gpx";
import { readBase64, removeFile } from "./import-files";
import * as store from "./store";
import type { ImportResult } from "./types";

const MAX_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;

export function retryDelayMs(attempts: number) {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), MAX_RETRY_DELAY_MS);
}

let draining: Promise<void> | null = null;

// Finished imports leave the queue right away; their outcome waits here until
// History shows it in the import summary.
const importResults = new Map<string, ImportResult>();

export function takeImportResult(id: string) {
  const result = importResults.get(id);
  importResults.delete(id);
  return result;
}

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
  const dueImports = store
    .listImports(["pending", "failed"])
    .filter((i) => i.nextAttemptAt == null || i.nextAttemptAt <= now);
  for (const imp of dueImports) {
    try {
      const { data } = await clientFor(imp.person).mutate({
        mutation: IMPORT_ACTIVITY_FILE,
        variables: { filename: imp.name, contentBase64: await readBase64(imp.localUri) },
      });
      const result: ImportResult = data.importActivityFile;
      importResults.set(imp.id, result);
      // A refusal (not a track, no timestamps, too big) won't change on retry.
      if (result.status === "REJECTED") {
        store.updateImport(imp.id, {
          status: "rejected",
          lastError: result.reason,
          nextAttemptAt: null,
        });
      } else {
        store.deleteImport(imp.id);
      }
      removeFile(imp.localUri);
    } catch (err) {
      const attempts = imp.uploadAttempts + 1;
      store.updateImport(imp.id, {
        status: "failed",
        uploadAttempts: attempts,
        nextAttemptAt: now + retryDelayMs(attempts),
        lastError: (err as Error).message,
      });
    }
  }

  for (const person of new Set([...due, ...dueImports].map((r) => r.person)))
    clientFor(person)
      .refetchQueries({ include: "active" })
      .catch(() => {});
}

export function retryNow(id: string) {
  store.updateRecording(id, { nextAttemptAt: null });
  store.updateImport(id, { nextAttemptAt: null });
  return drainUploadQueue();
}
