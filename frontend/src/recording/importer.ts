import * as DocumentPicker from "expo-document-picker";
import { randomUUID } from "expo-crypto";
import { describeImportResult, importExtension, skipReason } from "@/utils/import-result";
import { copyIntoQueue, removeFile } from "./import-files";
import * as store from "./store";
import { drainUploadQueue, takeImportResult } from "./upload-queue";

/**
 * Picks files, queues the supported ones, and uploads them now if the server
 * is reachable. Returns one summary line per picked file, or null if the
 * picker was cancelled.
 */
export async function pickAndImport(person: string): Promise<string[] | null> {
  // Any type: Android often doesn't know .gpx/.igc/.skiz and would grey them
  // out, so unsupported files are skipped after picking instead.
  const picked = await DocumentPicker.getDocumentAsync({
    multiple: true,
    copyToCacheDirectory: true,
  });
  if (picked.canceled) return null;

  const lines: (string | { id: string; name: string })[] = [];
  for (const asset of picked.assets) {
    const skipped = skipReason(asset.name, asset.size);
    if (skipped) {
      lines.push(`${asset.name}: ${skipped}`);
      removeFile(asset.uri);
      continue;
    }
    const id = randomUUID();
    const localUri = await copyIntoQueue(asset.uri, id, importExtension(asset.name));
    store.createImport({ id, person, name: asset.name, localUri }, Date.now());
    lines.push({ id, name: asset.name });
  }

  const queued = lines.filter((l) => typeof l !== "string");
  if (queued.length > 0) {
    await drainUploadQueue();
    // A drain already under way when these were queued didn't include them.
    const waiting = new Set(store.listImports(["pending"]).map((i) => i.id));
    if (queued.some((q) => waiting.has(q.id))) await drainUploadQueue();
  }

  return lines.map((line) =>
    typeof line === "string" ? line : describeImportResult(line.name, takeImportResult(line.id)),
  );
}
