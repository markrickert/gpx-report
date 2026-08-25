// Thin wrapper around the subset of Immich's REST API this integration
// needs: metadata search (for scanning) and streaming an asset/thumbnail
// (for the backend media proxy in index.ts). Never called with a
// client-supplied base URL/key — those come only from the immich_settings
// DB row (see settings.ts), keeping the credentials server-side only.
import type { ImmichCandidateAsset } from "./match.js";

export interface ImmichSettings {
  immichBaseUrl: string;
  immichApiKey: string;
}

function headers(settings: ImmichSettings) {
  return {
    "x-api-key": settings.immichApiKey,
    "content-type": "application/json",
  };
}

// Immich's duration field is usually a "H:MM:SS.ffffff" string, but not
// every asset carries one in the expected shape (e.g. photos, or older
// library entries) — tolerate a bare number or anything unparseable rather
// than letting one malformed asset fail the whole scan.
function parseDurationSeconds(duration: unknown): number | null {
  if (duration == null) return null;
  if (typeof duration === "number") return Number.isFinite(duration) ? duration : null;
  if (typeof duration !== "string") return null;
  const parts = duration.split(":").map(Number);
  if (parts.length === 0 || parts.some((n) => Number.isNaN(n))) return null;
  const [h, m, s] = parts.length === 3 ? parts : [0, ...parts];
  return h * 3600 + m * 60 + s;
}

// Searches for assets taken within [takenAfter, takenBefore] (ISO strings).
// Immich's /api/search/metadata paginates; this follows nextPage until
// exhausted, which is fine at the per-activity time-window scale this is
// called at (a handful of hours, not a whole library).
export async function searchMetadataByTimeWindow(
  settings: ImmichSettings,
  takenAfter: string,
  takenBefore: string,
): Promise<ImmichCandidateAsset[]> {
  const base = settings.immichBaseUrl.replace(/\/+$/, "");
  const results: ImmichCandidateAsset[] = [];
  let page: number | null = 1;

  while (page !== null) {
    const res = await fetch(`${base}/api/search/metadata`, {
      method: "POST",
      headers: headers(settings),
      body: JSON.stringify({ takenAfter, takenBefore, page, size: 250 }),
    });
    if (!res.ok) {
      throw new Error(`Immich search/metadata failed: ${res.status} ${await res.text()}`);
    }
    const body: any = await res.json();
    const items = body?.assets?.items ?? [];
    for (const item of items) {
      results.push({
        immichAssetId: item.id,
        assetType: item.type === "VIDEO" ? "VIDEO" : "IMAGE",
        takenAt: item.fileCreatedAt ?? item.localDateTime,
        lat: item.exifInfo?.latitude ?? null,
        lon: item.exifInfo?.longitude ?? null,
        durationSeconds: parseDurationSeconds(item.duration),
      });
    }
    page = body?.assets?.nextPage ?? null;
  }

  return results;
}

// Streams an asset (or its thumbnail) from Immich straight through to an
// Express response, so the API key never has to reach the browser. Caller
// (index.ts) owns setting response status/headers on failure.
export async function fetchImmichAssetStream(
  settings: ImmichSettings,
  assetId: string,
  variant: "original" | "thumbnail",
): Promise<Response> {
  const base = settings.immichBaseUrl.replace(/\/+$/, "");
  const path =
    variant === "thumbnail"
      ? `/api/assets/${assetId}/thumbnail?size=preview`
      : `/api/assets/${assetId}/original`;
  return fetch(`${base}${path}`, { headers: headers(settings) });
}
