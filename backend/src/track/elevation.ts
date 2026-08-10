// Raw GPS/barometric elevation is noisy — small jitter between consecutive
// points shows up as a sawtooth pattern that inflates total gain/loss well
// beyond the "real" climbing/descending done. A simple centered moving
// average smooths that jitter out before gain/loss is computed. Window of 5
// points is a reasonable default for typical GPX/IGC point density (roughly
// 1 point/sec) without needing to size the window by distance/time.
const DEFAULT_WINDOW = 5;

// Centered moving average over `elevations`, clamping the window at the
// start/end of the array. Only used to derive total gain/loss — callers
// should keep using the raw elevation values for anything shown to the user
// (chart, map, per-point data).
export function smoothElevations(elevations, windowSize = DEFAULT_WINDOW) {
  const half = Math.floor(windowSize / 2);
  return elevations.map((_, i) => {
    const start = Math.max(0, i - half);
    const end = Math.min(elevations.length, i + half + 1);
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      const e = elevations[j];
      if (e == null) continue;
      sum += e;
      count++;
    }
    return count > 0 ? sum / count : null;
  });
}

// Sums positive/negative deltas between consecutive smoothed elevation
// values, for use as total_elevation_gain/loss.
export function computeElevationGainLoss(elevations, windowSize = DEFAULT_WINDOW) {
  // Too few points for the window to mean anything (a centered average over
  // a handful of points just flattens every delta to ~0) — fall back to raw
  // deltas rather than losing real elevation change on short tracks.
  const smoothed =
    elevations.length > windowSize ? smoothElevations(elevations, windowSize) : elevations;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < smoothed.length; i++) {
    if (smoothed[i] == null || smoothed[i - 1] == null) continue;
    const delta = smoothed[i] - smoothed[i - 1];
    if (delta > 0) gain += delta;
    else loss += -delta;
  }
  return { gain, loss };
}
