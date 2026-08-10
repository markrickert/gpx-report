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
//
// Two real-world GPS/logging quirks, found by inspecting live flagged
// activities, are deliberately *not* flagged:
//
// 1. Duplicate/out-of-order timestamps (dt <= 0) with near-zero movement.
//    Some devices write more than one sample for the same instant while
//    stationary; naively dividing by a zero (or negative) dt produces an
//    infinite/undefined "speed" that always exceeds any threshold, even
//    though the point hasn't actually moved. Treated the same as a missing
//    timestamp: can't evaluate speed, so skip rather than flag.
// 2. A single sample whose recorded time delta undercounts what actually
//    elapsed (e.g. a device that freezes its position for several stale
//    samples during a stop, then needs one sample to "catch up" once it
//    reacquires and movement resumes) looks identical, from *this* point
//    alone, to a genuine bad GPS fix: the implied speed is implausible
//    either way. The two cases are told apart by what happens *next*: a
//    real teleport is a blip that self-corrects — the following point lands
//    back near the pre-jump trajectory. A mistimed-but-real position
//    persists — the following point continues on plausibly from *it*, not
//    from where the track was before. Checking the point right after a
//    flagged jump for that corroboration (rather than only ever comparing
//    against the stale last-kept point) tells real jumps from bad fixes.
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
    if (dtSeconds <= 0) {
      lastKeptIndex = i;
      continue;
    }
    const distance = haversineMeters(lastKept, p);
    const speed = distance / dtSeconds;
    if (speed > maxSpeedMps) {
      const next = points[i + 1];
      if (next && next.timestamp) {
        const dtNext = (next.timestamp - p.timestamp) / 1000;
        if (dtNext > 0 && haversineMeters(p, next) / dtNext <= maxSpeedMps) {
          // The point after the jump continues on plausibly from p, not
          // from lastKept — a real (if mistimed) position, not a bad fix.
          lastKeptIndex = i;
          continue;
        }
      }
      removedIndices.push(i);
      continue;
    }
    lastKeptIndex = i;
  }
  return removedIndices;
}
