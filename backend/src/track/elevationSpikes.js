// Two failure modes seen in real GPS/barometric altitude data that neither
// detectOutliers() (horizontal speed only) nor the ingest-time elevation
// smoothing (a 5-point moving average, only ever used for gain/loss totals,
// never the raw per-point values) catches: a single point whose elevation
// jumps off-trend and self-corrects on the very next point, or a short run
// of points that all hold an anomalous elevation for a few seconds before
// returning to trend. In both cases lat/lon move smoothly and continuously
// throughout — this is a bad altitude reading, not a GPS teleport.
//
// Detection works off the single-step elevation delta rather than a local
// window/median: find a sudden "entry" jump, then the nearest later "exit"
// jump of roughly opposite size that lands back close to the pre-entry
// elevation, and flag everything between them. This scales correctly
// regardless of how long the glitch plateau lasts (a window/median approach
// loses the middle of a long plateau once the window fills with other
// spiked points), and naturally never flags a real sustained climb/descent,
// since that never has a large single-step reversal back toward where it
// started.
const DEFAULT_THRESHOLD_METERS = 15;
const DEFAULT_MAX_SPIKE_DURATION_SECONDS = 60; // longer than this, it's a real climb/descent, not a glitch

// Detection only — does not mutate/filter anything. Returns contiguous index
// ranges [{startIndex, endIndex}], sorted by startIndex, of points that sit
// on the wrong side of a matched entry/exit jump pair.
export function detectElevationSpikes(points, options = {}) {
  const thresholdMeters = options.thresholdMeters ?? DEFAULT_THRESHOLD_METERS;
  const maxSpikeDurationSeconds =
    options.maxSpikeDurationSeconds ?? DEFAULT_MAX_SPIKE_DURATION_SECONDS;

  if (points.length < 3) return [];

  const elevations = points.map((p) => p.elevation);

  const jumps = [];
  for (let i = 1; i < elevations.length; i++) {
    const a = elevations[i - 1];
    const b = elevations[i];
    if (a == null || b == null) continue;
    const delta = b - a;
    if (Math.abs(delta) > thresholdMeters) jumps.push({ index: i, delta });
  }

  // Only entries are marked "used" once matched — an exit jump is allowed to
  // double as the *next* run's entry, since one big step can simultaneously
  // end one glitch plateau and begin an adjacent one in the opposite
  // direction (seen in real data: a jump up, a few points later a jump back
  // past baseline into a dip, then a jump back up to the real trend).
  const runs = [];
  const usedAsEntry = new Set();
  for (let a = 0; a < jumps.length; a++) {
    if (usedAsEntry.has(a)) continue;
    const entry = jumps[a];
    const preEntryElevation = elevations[entry.index - 1];
    if (preEntryElevation == null) continue;

    for (let b = a + 1; b < jumps.length; b++) {
      const exit = jumps[b];
      if (Math.sign(entry.delta) === Math.sign(exit.delta)) continue;

      // A real glitch's entry and exit jump are roughly the same size (both
      // represent snapping to/from the same bad altitude offset). Without
      // this, an exit jump that coincidentally lands within thresholdMeters
      // of the pre-entry elevation can falsely pair with an unrelated later
      // jump and flag perfectly good data in between as a spike.
      if (Math.abs(Math.abs(entry.delta) - Math.abs(exit.delta)) > thresholdMeters / 2) continue;

      const postExitElevation = elevations[exit.index];
      if (postExitElevation == null) continue;
      if (Math.abs(postExitElevation - preEntryElevation) > thresholdMeters) continue;

      const t0 = points[entry.index].timestamp;
      const t1 = points[exit.index - 1].timestamp;
      if (t0 != null && t1 != null && (t1 - t0) / 1000 > maxSpikeDurationSeconds) continue;

      runs.push({ startIndex: entry.index, endIndex: exit.index - 1 });
      usedAsEntry.add(a);
      break;
    }
  }

  return runs.sort((x, y) => x.startIndex - y.startIndex);
}

// Returns a new points array (input untouched) where each flagged run's
// elevation is replaced by linear interpolation, by index position, between
// the last good point immediately before the run and the first good point
// immediately after it. Everything outside a flagged run is unchanged.
export function correctElevationSpikes(points, spikeRuns) {
  if (spikeRuns.length === 0) return points;

  const corrected = points.map((p) => ({ ...p }));
  for (const { startIndex, endIndex } of spikeRuns) {
    const before = points[startIndex - 1];
    const after = points[endIndex + 1];
    if (!before || !after || before.elevation == null || after.elevation == null) continue;
    const span = endIndex + 1 - (startIndex - 1);
    for (let i = startIndex; i <= endIndex; i++) {
      const t = (i - (startIndex - 1)) / span;
      corrected[i].elevation = before.elevation + (after.elevation - before.elevation) * t;
    }
  }
  return corrected;
}
