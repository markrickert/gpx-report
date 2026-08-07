// Reverse-geocodes a lat/lon to a place name via Nominatim (OSM, free, no key).
//
// Nominatim's usage policy caps requests at 1/sec and requires a descriptive
// User-Agent. Callers are responsible for throttling across multiple calls
// (the GPX watcher already serializes ingestion one file at a time, so a
// single call per processFile() is safe; anything that loops over many
// activities must add its own delay between calls — see
// backend/scripts/backfillLocationNames.js).
const USER_AGENT = "gpx-report/1.0";
const MIN_INTERVAL_MS = 1100;

// Module-level throttle: guarantees at most ~1 request/sec to Nominatim no
// matter how many callers invoke this concurrently or back-to-back (e.g. the
// watcher replaying a burst of pre-existing files on startup), rather than
// relying on every caller to space out its own calls correctly.
let nextAvailableAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttle() {
  const wait = nextAvailableAt - Date.now();
  nextAvailableAt = Math.max(Date.now(), nextAvailableAt) + MIN_INTERVAL_MS;
  if (wait > 0) await sleep(wait);
}

export async function reverseGeocode(lat, lon) {
  await throttle();
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) {
      console.warn(`Reverse geocode failed for ${lat},${lon}: HTTP ${res.status}`);
      return null;
    }
    const body = await res.json();
    const address = body.address || {};
    const name =
      address.city ||
      address.town ||
      address.village ||
      address.suburb ||
      address.hamlet ||
      body.display_name?.split(",")[0]?.trim() ||
      null;
    return name;
  } catch (err) {
    console.warn(`Reverse geocode failed for ${lat},${lon}:`, err.message);
    return null;
  }
}
