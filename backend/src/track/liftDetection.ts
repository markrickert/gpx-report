import { haversineMeters, bearingDegrees, bearingDiffDegrees } from "./geo.js";

// Chairlifts/gondolas run in a straight line, at roughly constant speed, with
// occasional short stops, and climb steadily rather than the noisy up-down
// pace of a hiker or skinner. This is a track-shape heuristic, not gated by
// activityType, so it applies equally to hiking, skiing, or any other
// activity whose GPX happens to include a lift ride. Uphill only — a fast,
// straight downhill trail (e.g. a bike-park descent) can otherwise pass the
// same checks and get mistaken for a lift ride down.
const MIN_MOVE_METERS = 2; // below this, a point-to-point step is GPS jitter, not travel
const BEARING_TOLERANCE_DEGREES = 20; // max heading drift allowed within one straight-line segment
const MAX_STOP_SECONDS = 180; // longest single stall still consistent with a lift restart, not a rest break
const MIN_SEGMENT_DURATION_SECONDS = 60;
const MIN_ELEVATION_GAIN_METERS = 20; // filters out flat straight paths (roads, boardwalks)
const MAX_SPEED_COEFFICIENT_OF_VARIATION = 0.4; // stddev/mean of moving-interval speed, lower = steadier
const MIN_MOVING_FRACTION = 0.5; // fraction of segment duration actually moving; a mostly-stationary GPS
// track with a few 1-2s jitter blips can pass the other checks (no single stall exceeds MAX_STOP_SECONDS
// because sampling is dense) while never covering real ground — e.g. a hiker stopped for minutes with
// slow elevation sensor drift, which reads as a monotonic climb
const MIN_ELEVATION_MONOTONICITY = 0.7; // fraction of elevation steps matching the segment's net direction
const ELEVATION_NOISE_METERS = 1; // deltas within this band don't count against monotonicity

function mean(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stddev(values, avg) {
  return Math.sqrt(mean(values.map((v) => (v - avg) ** 2)));
}

// Detection only — does not mutate anything. Returns contiguous index ranges
// of `points` (same {lat, lon, elevation, timestamp} shape as points_data)
// that look like lift rides, for the frontend to render as a band on the
// elevation chart and to derive a "gain excluding lifts" stat from.
export function detectLiftSegments(points) {
  if (points.length < 2) return [];

  const intervals = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    if (!prev.timestamp || !curr.timestamp) {
      intervals.push(null);
      continue;
    }
    const dtSeconds = (curr.timestamp - prev.timestamp) / 1000;
    if (dtSeconds <= 0) {
      intervals.push(null);
      continue;
    }
    const distance = haversineMeters(prev, curr);
    const moving = distance >= MIN_MOVE_METERS;
    intervals.push({
      dtSeconds,
      speedMps: distance / dtSeconds,
      bearing: moving ? bearingDegrees(prev, curr) : null,
      moving,
    });
  }

  const rawSegments = [];
  let segStart = null;
  let refBearing = null;

  const closeSegment = (endExclusive) => {
    if (segStart !== null && endExclusive - 1 > segStart) {
      rawSegments.push([segStart, endExclusive - 1]);
    }
    segStart = null;
    refBearing = null;
  };

  for (let i = 1; i < points.length; i++) {
    const interval = intervals[i - 1];
    if (!interval) {
      closeSegment(i);
      continue;
    }
    if (segStart === null) {
      segStart = i - 1;
      refBearing = interval.bearing;
      continue;
    }
    if (interval.moving) {
      if (refBearing === null) {
        refBearing = interval.bearing;
      } else if (bearingDiffDegrees(interval.bearing, refBearing) > BEARING_TOLERANCE_DEGREES) {
        closeSegment(i);
        segStart = i - 1;
        refBearing = interval.bearing;
      }
    }
  }
  closeSegment(points.length);

  const segments = [];
  for (const [start, end] of rawSegments) {
    const segPoints = points.slice(start, end + 1);
    const segIntervals = intervals.slice(start, end).filter(Boolean);
    if (segIntervals.length === 0) continue;

    const durationSeconds = (points[end].timestamp - points[start].timestamp) / 1000;
    if (durationSeconds < MIN_SEGMENT_DURATION_SECONDS) continue;

    const longestStop = Math.max(
      0,
      ...segIntervals.filter((iv) => !iv.moving).map((iv) => iv.dtSeconds),
    );
    if (longestStop > MAX_STOP_SECONDS) continue;

    const movingDtSeconds = segIntervals
      .filter((iv) => iv.moving)
      .reduce((sum, iv) => sum + iv.dtSeconds, 0);
    if (movingDtSeconds / durationSeconds < MIN_MOVING_FRACTION) continue;

    const movingSpeeds = segIntervals.filter((iv) => iv.moving).map((iv) => iv.speedMps);
    if (movingSpeeds.length === 0) continue;
    const avgSpeedMps = mean(movingSpeeds);
    const speedCv = avgSpeedMps > 0 ? stddev(movingSpeeds, avgSpeedMps) / avgSpeedMps : Infinity;
    if (speedCv > MAX_SPEED_COEFFICIENT_OF_VARIATION) continue;

    // Uphill only: a straight, steady, fast-ish descent (e.g. a bike-park
    // singletrack trail) can otherwise pass every other check here and get
    // mistaken for a lift ride down. Every consumer of this data (the "Runs"
    // count, "Gain Excluding Lift" tile) only ever uses positive gain
    // anyway, so downhill "lift" detection wasn't buying anything.
    const elevationGainMeters =
      (segPoints[segPoints.length - 1].elevation ?? 0) - (segPoints[0].elevation ?? 0);
    if (elevationGainMeters < MIN_ELEVATION_GAIN_METERS) continue;

    let matchingSteps = 0;
    let countedSteps = 0;
    for (let i = 1; i < segPoints.length; i++) {
      const delta = (segPoints[i].elevation ?? 0) - (segPoints[i - 1].elevation ?? 0);
      if (Math.abs(delta) < ELEVATION_NOISE_METERS) continue;
      countedSteps++;
      if (delta > 0) matchingSteps++;
    }
    const monotonicity = countedSteps > 0 ? matchingSteps / countedSteps : 1;
    if (monotonicity < MIN_ELEVATION_MONOTONICITY) continue;

    segments.push({
      startIndex: start,
      endIndex: end,
      durationSeconds: Math.round(durationSeconds),
      elevationGainMeters,
      avgSpeedMps,
    });
  }

  return segments;
}
