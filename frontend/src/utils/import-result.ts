import type { ImportResult } from "@/recording/types";

// Same formats and size cap as the server's importActivityFile.
export const IMPORT_EXTENSIONS = [".gpx", ".igc", ".skiz"];
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

export function importExtension(name: string) {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLowerCase();
}

/** Why a picked or dropped file won't be sent, or null if it can be. */
export function skipReason(name: string, size: number | undefined) {
  if (!IMPORT_EXTENSIONS.includes(importExtension(name)))
    return "skipped, not a GPX, IGC, or SKIZ file";
  if ((size ?? 0) > MAX_IMPORT_BYTES) return "skipped, larger than 20 MB";
  return null;
}

export function describeImportResult(name: string, result: ImportResult | undefined) {
  switch (result?.status) {
    case "IMPORTED":
      return `${name}: imported as "${result.title}"`;
    case "ALREADY_IMPORTED":
      return `${name}: already imported`;
    case "DUPLICATE":
      return `${name}: you already have this activity ("${result.title}")`;
    case "REJECTED":
      return `${name}: couldn't import. ${result.reason}`;
    default:
      return `${name}: waiting to upload. It'll go once the server is reachable.`;
  }
}
