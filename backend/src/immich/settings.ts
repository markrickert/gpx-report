import { pool } from "../db.js";
import type { ImmichSettings } from "./client.js";

// Single-row settings table (see backend/db/init.sql). Returns null when
// unset/incomplete rather than throwing, so read-only callers (e.g. the
// Settings page checking whether Immich is configured) don't need a
// separate existence check.
export async function getImmichSettings(): Promise<ImmichSettings | null> {
  const { rows } = await pool.query(
    "SELECT immich_base_url, immich_api_key FROM immich_settings WHERE id = 1",
  );
  const row = rows[0];
  if (!row?.immich_base_url || !row?.immich_api_key) return null;
  return { immichBaseUrl: row.immich_base_url, immichApiKey: row.immich_api_key };
}

// Whether a base URL is configured, without exposing the API key at all —
// used by the GraphQL Query so the frontend can show "connected" state
// without the key ever being read back over the wire.
export async function getImmichBaseUrl(): Promise<string | null> {
  const { rows } = await pool.query("SELECT immich_base_url FROM immich_settings WHERE id = 1");
  return rows[0]?.immich_base_url ?? null;
}

// Upserts the single settings row. apiKey is optional so the frontend can
// update just the base URL without having to resend (and thus somehow
// having received back) the existing key.
export async function updateImmichSettings(
  immichBaseUrl: string,
  apiKey: string | null | undefined,
): Promise<void> {
  await pool.query(
    `INSERT INTO immich_settings (id, immich_base_url, immich_api_key)
     VALUES (1, $1, $2)
     ON CONFLICT (id) DO UPDATE SET
       immich_base_url = EXCLUDED.immich_base_url,
       immich_api_key = COALESCE(EXCLUDED.immich_api_key, immich_settings.immich_api_key)`,
    [immichBaseUrl, apiKey ?? null],
  );
}
