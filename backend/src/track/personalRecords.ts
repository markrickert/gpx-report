// Fastest-segment ("best effort") calc: given an activity's ordered points
// (cumulative distance + timestamp), find the minimum time it took to cover
// each target distance anywhere within the activity.
//
// Algorithm: two-pointer sliding window, the same technique as "minimum size
// subarray sum >= target" (distanceMeters is cumulative and non-decreasing,
// same shape as a prefix-summed array). For each `right`, shrink the window
// from `left` while it still covers >= targetMeters, recording the tightest
// (smallest-time) window found at each step. Since `left` only ever advances
// forward and never resets, the total work across the whole scan is O(n) per
// target distance, not O(n^2) — no naive "every start x every end" scan.
//
// A pause/stop inside a candidate window inflates that window's time, so the
// algorithm naturally prefers windows without pauses — no special-case
// handling of timestamp gaps is needed for correctness, it falls out of the
// window minimization itself.
export const DEFAULT_TARGET_DISTANCES_METERS = [1000, 5000, 10000];

// points: array of { distanceMeters, timestamp }, ordered chronologically,
// distanceMeters cumulative from the start of the activity (both
// non-decreasing). Returns the fastest time in seconds to cover
// targetMeters anywhere in the track, or null if the activity never covers
// that much distance.
export function bestEffortSeconds(points, targetMeters) {
  let left = 0;
  let minSeconds = null;
  for (let right = 0; right < points.length; right++) {
    while (
      left <= right &&
      points[right].distanceMeters - points[left].distanceMeters >= targetMeters
    ) {
      const seconds = (points[right].timestamp - points[left].timestamp) / 1000;
      if (minSeconds === null || seconds < minSeconds) minSeconds = seconds;
      left++;
    }
  }
  return minSeconds;
}

// Runs bestEffortSeconds() for each target distance, keyed by the target
// (in meters) as a string. Points missing a distance/timestamp are dropped
// first (e.g. a leading point with no fix yet) since the window calc needs
// both values for every point it considers.
export function computeBestEfforts(points, targets = DEFAULT_TARGET_DISTANCES_METERS) {
  const valid = points.filter((p) => p.distanceMeters != null && p.timestamp != null);
  const result = {};
  for (const target of targets) {
    result[target] = valid.length >= 2 ? bestEffortSeconds(valid, target) : null;
  }
  return result;
}
