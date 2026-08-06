import { haversineMeters } from "./geo.js";

// A single bad GPS fix (device jumps hundreds of meters in one reading) can
// silently inflate distance/max-speed stats. 55 m/s (~200 km/h) is well above
// any activity type recorded here (fastest legit observed: e-mtb downhill,
// paragliding in strong wind) but far below what a GPS glitch teleport produces.
const DEFAULT_MAX_PLAUSIBLE_SPEED_MPS = 55;

// Detection only — does not mutate/filter anything. Returns the indices of
// points that imply an implausible speed jump from the last *kept* point, so
// one bad fix doesn't also flag every point after it. Points with no
// timestamp (on either side of the comparison) are never flagged, since
// speed can't be evaluated for them. Used by the outlier-cleanup GraphQL
// resolvers to surface candidates for the user to review and optionally
// remove — nothing calls this automatically at ingest time.
export function detectOutliers(points, maxSpeedMps = DEFAULT_MAX_PLAUSIBLE_SPEED_MPS) {
  if (points.length < 2) return [];

  const removedIndices = [];
  let lastKeptIndex = 0;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const lastKept = points[lastKeptIndex];
    if (!lastKept.timestamp || !p.timestamp) {
      lastKeptIndex = i;
      continue;
    }
    const dtSeconds = (p.timestamp - lastKept.timestamp) / 1000;
    const distance = haversineMeters(lastKept, p);
    const speed = dtSeconds > 0 ? distance / dtSeconds : Infinity;
    if (speed > maxSpeedMps) {
      removedIndices.push(i);
      continue;
    }
    lastKeptIndex = i;
  }
  return removedIndices;
}
