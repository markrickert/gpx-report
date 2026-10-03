import { bearingDegrees, bearingDiffDegrees, haversineMeters } from "@/utils/geo";

// The same detector as backend/src/track/liftDetection.ts, run on the phone
// so the record screen can leave lift rides out of the live distance. Keep
// the two in sync.

type Point = { lat: number; lon: number; elevation: number | null; timestamp: number };

export type LiftSegment = {
  startIndex: number;
  endIndex: number;
  durationSeconds: number;
  /** Negative for a ride down. */
  elevationGainMeters: number;
  avgSpeedMps: number;
  distanceMeters: number;
};

type Ride = Omit<LiftSegment, "distanceMeters"> & { lengthMeters: number };

// Chairlifts/gondolas run along one straight cable, at roughly constant speed,
// with stops that can last minutes, and climb (or descend) steadily rather
// than the noisy up-down pace of a hiker or skinner. This is a track-shape
// heuristic, not gated by activityType, so it applies equally to hiking,
// skiing, or any other activity whose GPX happens to include a lift ride.
//
// Straightness is judged against a fitted line, not point-to-point heading:
// phone GPS on a chair wobbles a few meters side to side, which swings the
// heading between consecutive fixes well past any useful tolerance while the
// track as a whole never leaves the cable line.
const VELOCITY_HALF_WINDOW_SECONDS = 10; // speed is measured across this much track either side of a point, so fix-to-fix jitter doesn't read as travel
const MIN_MOVING_SPEED_MPS = 0.5; // below this smoothed speed the rider is stopped
const MAX_LINE_DEVIATION_METERS = 25; // furthest a point may sit from the straight line through a ride's ends
const MAX_STOP_SECONDS = 300; // longest single stall still consistent with a stopped lift, not a rest break
const ELEVATION_REVERSAL_METERS = 10; // climbing then dropping by this much (or the reverse) ends a ride at the turning point
const MIN_PIECE_DURATION_SECONDS = 60; // shortest straight stretch worth judging on its own
const MIN_RIDE_DURATION_SECONDS = 120; // shortest ride reported; an e-bike holds a lift-like line for a minute, rarely two
const MAX_PIECE_GAP_SECONDS = 300; // pieces of one ride split by a tower-line kink or GPS wander rejoin across this gap
const MAX_PIECE_BEARING_DIFF_DEGREES = 20;
const MIN_JOINED_STRAIGHTNESS = 0.9; // joined length over the pieces' summed lengths; lower means two laps, not one ride
const MIN_ELEVATION_CHANGE_METERS = 20; // filters out flat straight paths (roads, boardwalks)
const MIN_GRADE = 0.1; // elevation change over horizontal length; fire roads and gentle straight climbs fall under this
const MIN_AVG_SPEED_MPS = 1.5; // slower than this is indistinguishable from someone walking straight up the hill
const MAX_AVG_SPEED_MPS = 6.5; // faster than any chairlift or gondola; a bike or skier holding a straight line
const MAX_SPEED_COEFFICIENT_OF_VARIATION = 0.4; // stddev/mean of moving speed, lower = steadier
const MIN_MOVING_FRACTION = 0.5; // fraction of a piece's duration actually moving; a mostly-stationary GPS
// track with slow elevation sensor drift reads as a monotonic climb but never covers real ground
const MIN_ELEVATION_MONOTONICITY = 0.7; // fraction of elevation steps matching the piece's net direction
const ELEVATION_NOISE_METERS = 1; // deltas within this band don't count against monotonicity
// A ride down only counts when it retraces a detected ride up: a straight,
// steady, fast descent (e.g. a bike-park trail or a ski run) otherwise passes
// every check above.
const MAX_DOWNLOAD_BEARING_DIFF_DEGREES = 10;
const MAX_DOWNLOAD_LINE_OFFSET_METERS = 60;
const DOWNLOAD_LENGTH_RATIO = [0.7, 1.4];
const DOWNLOAD_SPEED_RATIO = [0.7, 1.4];

const METERS_PER_DEGREE = 111320;

function mean(values: number[]) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stddev(values: number[], avg: number) {
  return Math.sqrt(mean(values.map((v) => (v - avg) ** 2)));
}

// Returns a function giving the perpendicular distance in meters from a point
// to the straight line through a and b.
function lineDeviationFrom(a: Point, b: Point) {
  const lonScale = Math.cos((a.lat * Math.PI) / 180) * METERS_PER_DEGREE;
  const bx = (b.lon - a.lon) * lonScale;
  const by = (b.lat - a.lat) * METERS_PER_DEGREE;
  const length = Math.hypot(bx, by);
  return (p: Point) => {
    const px = (p.lon - a.lon) * lonScale;
    const py = (p.lat - a.lat) * METERS_PER_DEGREE;
    return length === 0 ? Math.hypot(px, py) : Math.abs(bx * py - by * px) / length;
  };
}

// Smoothed speed at each point, or null where it can't be measured.
function smoothedSpeeds(points: Point[]) {
  const speeds = new Array<number | null>(points.length).fill(null);
  const windowMs = VELOCITY_HALF_WINDOW_SECONDS * 1000;
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < points.length; i++) {
    const t = points[i].timestamp;
    if (!t) continue;
    while (lo < i && (!points[lo].timestamp || t - points[lo].timestamp > windowMs)) lo++;
    if (hi < i) hi = i;
    while (
      hi + 1 < points.length &&
      points[hi + 1].timestamp &&
      points[hi + 1].timestamp - t <= windowMs
    ) {
      hi++;
    }
    let from = lo;
    let to = hi;
    // Sparse sampling leaves the window empty; fall back to the neighboring fix.
    if (from === i && to === i) {
      if (i > 0 && points[i - 1].timestamp) from = i - 1;
      else if (i + 1 < points.length && points[i + 1].timestamp) to = i + 1;
    }
    const dtSeconds = (points[to].timestamp - points[from].timestamp) / 1000;
    if (dtSeconds > 0) speeds[i] = haversineMeters(points[from], points[to]) / dtSeconds;
  }
  return speeds;
}

// Splits the track into maximal straight, single-direction stretches,
// returned as [startIndex, endIndex] pairs. Stops don't split a stretch
// unless they outlast MAX_STOP_SECONDS.
function straightStretches(points: Point[], speeds: (number | null)[]) {
  const stretches: [number, number][] = [];
  const elevation = (i: number) => points[i].elevation ?? 0;
  let start: number | null = null;
  let lastMoving = 0;
  let lowest = 0;
  let highest = 0;

  const open = (i: number) => {
    start = i;
    lastMoving = i;
    lowest = i;
    highest = i;
  };
  const close = (end = lastMoving) => {
    if (start !== null && end > start) stretches.push([start, end]);
    start = null;
  };
  const fitsLine = (from: number, to: number) => {
    const deviation = lineDeviationFrom(points[from], points[to]);
    for (let k = from + 1; k < to; k++) {
      if (deviation(points[k]) > MAX_LINE_DEVIATION_METERS) return false;
    }
    return true;
  };

  for (let i = 0; i < points.length; i++) {
    const outOfOrder =
      i > 0 && (!points[i - 1].timestamp || points[i].timestamp <= points[i - 1].timestamp);
    const speed = speeds[i];
    if (speed === null || outOfOrder) {
      close();
      continue;
    }
    if (speed < MIN_MOVING_SPEED_MPS) {
      if (
        start !== null &&
        (points[i].timestamp - points[lastMoving].timestamp) / 1000 > MAX_STOP_SECONDS
      ) {
        close();
      }
      continue;
    }
    // A long gap between fixes that covers no ground is a stop the smoothed
    // speeds never saw; one that covers ground is a GPS dropout mid-ride.
    if (start !== null) {
      const gapSeconds = (points[i].timestamp - points[i - 1].timestamp) / 1000;
      if (
        gapSeconds > MAX_STOP_SECONDS &&
        haversineMeters(points[i - 1], points[i]) / gapSeconds < MIN_MOVING_SPEED_MPS
      ) {
        close();
      }
    }
    if (start === null) {
      open(i);
      continue;
    }
    if (!fitsLine(start, i)) {
      const turn = lastMoving;
      close();
      open(turn);
    } else {
      const climbed = elevation(highest) - elevation(start) > ELEVATION_REVERSAL_METERS;
      const dropped = elevation(start) - elevation(lowest) > ELEVATION_REVERSAL_METERS;
      let turn: number | null = null;
      if (climbed && elevation(highest) - elevation(i) > ELEVATION_REVERSAL_METERS) {
        turn = highest;
      } else if (dropped && elevation(i) - elevation(lowest) > ELEVATION_REVERSAL_METERS) {
        turn = lowest;
      } else if (
        !climbed &&
        !dropped &&
        elevation(highest) - elevation(lowest) > ELEVATION_REVERSAL_METERS
      ) {
        turn = Math.min(lowest, highest);
      }
      if (turn !== null) {
        close(turn);
        open(turn);
      }
    }
    lastMoving = i;
    if (elevation(i) < elevation(lowest)) lowest = i;
    if (elevation(i) > elevation(highest)) highest = i;
  }
  close();
  return stretches;
}

/** Contiguous index ranges of `points` that look like lift rides. */
export function detectLiftSegments(points: Point[]): LiftSegment[] {
  if (points.length < 2) return [];

  const speeds = smoothedSpeeds(points);
  const elevationChange = (start: number, end: number) =>
    (points[end].elevation ?? 0) - (points[start].elevation ?? 0);
  const seconds = (start: number, end: number) =>
    (points[end].timestamp - points[start].timestamp) / 1000;
  const length = (start: number, end: number) => haversineMeters(points[start], points[end]);
  const bearing = (seg: Ride) => bearingDegrees(points[seg.startIndex], points[seg.endIndex]);

  const pieces: Ride[] = [];
  for (const [start, end] of straightStretches(points, speeds)) {
    const durationSeconds = seconds(start, end);
    if (durationSeconds < MIN_PIECE_DURATION_SECONDS) continue;

    const movingSpeeds: number[] = [];
    let movingSeconds = 0;
    for (let i = start + 1; i <= end; i++) {
      const speed = speeds[i];
      if (speed === null || speed < MIN_MOVING_SPEED_MPS) continue;
      movingSeconds += seconds(i - 1, i);
      movingSpeeds.push(speed);
    }
    if (movingSpeeds.length === 0) continue;
    if (movingSeconds / durationSeconds < MIN_MOVING_FRACTION) continue;

    const avgSpeedMps = mean(movingSpeeds);
    if (avgSpeedMps < MIN_AVG_SPEED_MPS || avgSpeedMps > MAX_AVG_SPEED_MPS) continue;
    if (stddev(movingSpeeds, avgSpeedMps) / avgSpeedMps > MAX_SPEED_COEFFICIENT_OF_VARIATION) {
      continue;
    }

    const elevationGainMeters = elevationChange(start, end);
    if (Math.abs(elevationGainMeters) < MIN_ELEVATION_CHANGE_METERS) continue;
    const lengthMeters = length(start, end);
    if (Math.abs(elevationGainMeters) / lengthMeters < MIN_GRADE) continue;

    let matchingSteps = 0;
    let countedSteps = 0;
    for (let i = start + 1; i <= end; i++) {
      const delta = elevationChange(i - 1, i);
      if (Math.abs(delta) < ELEVATION_NOISE_METERS) continue;
      countedSteps++;
      if (Math.sign(delta) === Math.sign(elevationGainMeters)) matchingSteps++;
    }
    if (countedSteps > 0 && matchingSteps / countedSteps < MIN_ELEVATION_MONOTONICITY) continue;

    pieces.push({
      startIndex: start,
      endIndex: end,
      durationSeconds,
      elevationGainMeters,
      avgSpeedMps,
      lengthMeters,
    });
  }

  // One ride often arrives as several pieces; rejoin the ones that continue
  // the same line in the same direction.
  const rides: Ride[] = [];
  for (const piece of pieces) {
    const prev = rides[rides.length - 1];
    const joinedLength = prev ? length(prev.startIndex, piece.endIndex) : 0;
    const joinedGain = prev ? elevationChange(prev.startIndex, piece.endIndex) : 0;
    if (
      prev &&
      seconds(prev.endIndex, piece.startIndex) <= MAX_PIECE_GAP_SECONDS &&
      Math.sign(prev.elevationGainMeters) === Math.sign(piece.elevationGainMeters) &&
      bearingDiffDegrees(bearing(prev), bearing(piece)) <= MAX_PIECE_BEARING_DIFF_DEGREES &&
      joinedLength >= MIN_JOINED_STRAIGHTNESS * (prev.lengthMeters + piece.lengthMeters) &&
      Math.abs(joinedGain) / joinedLength >= MIN_GRADE
    ) {
      rides[rides.length - 1] = {
        startIndex: prev.startIndex,
        endIndex: piece.endIndex,
        durationSeconds: seconds(prev.startIndex, piece.endIndex),
        elevationGainMeters: joinedGain,
        avgSpeedMps:
          (prev.avgSpeedMps * prev.durationSeconds + piece.avgSpeedMps * piece.durationSeconds) /
          (prev.durationSeconds + piece.durationSeconds),
        lengthMeters: joinedLength,
      };
    } else {
      rides.push(piece);
    }
  }

  const longRides = rides.filter((r) => r.durationSeconds >= MIN_RIDE_DURATION_SECONDS);
  const uploads = longRides.filter((r) => r.elevationGainMeters > 0);
  const within = (value: number, [min, max]: number[]) => value >= min && value <= max;
  const retracesAnUpload = (ride: Ride) =>
    uploads.some((up) => {
      const bottom = points[up.startIndex];
      const top = points[up.endIndex];
      const offLine = lineDeviationFrom(bottom, top);
      return (
        bearingDiffDegrees(bearing(ride), bearingDegrees(top, bottom)) <=
          MAX_DOWNLOAD_BEARING_DIFF_DEGREES &&
        offLine(points[ride.startIndex]) <= MAX_DOWNLOAD_LINE_OFFSET_METERS &&
        offLine(points[ride.endIndex]) <= MAX_DOWNLOAD_LINE_OFFSET_METERS &&
        within(ride.lengthMeters / up.lengthMeters, DOWNLOAD_LENGTH_RATIO) &&
        within(ride.avgSpeedMps / up.avgSpeedMps, DOWNLOAD_SPEED_RATIO)
      );
    });

  return longRides
    .filter((ride) => ride.elevationGainMeters > 0 || retracesAnUpload(ride))
    .map(({ startIndex, endIndex, durationSeconds, elevationGainMeters, avgSpeedMps }) => {
      let distanceMeters = 0;
      for (let i = startIndex + 1; i <= endIndex; i++) {
        distanceMeters += haversineMeters(points[i - 1], points[i]);
      }
      return {
        startIndex,
        endIndex,
        durationSeconds: Math.round(durationSeconds),
        elevationGainMeters,
        avgSpeedMps,
        distanceMeters,
      };
    });
}
