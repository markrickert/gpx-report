import { readFile } from "node:fs/promises";
import path from "node:path";
import GpxParser from "gpxparser";
import { computeElevationGainLoss } from "../track/elevation.js";

// Points slower than this are considered "stopped" (traffic lights, breaks,
// photo stops) when computing moving_avg_speed_mps. Matches
// REST_SPEED_THRESHOLD_MPS in frontend/src/pages/ActivityDetail.jsx, which
// uses the same threshold to detect rest bands for the auto-crop feature.
const MOVING_SPEED_THRESHOLD_MPS = 0.3;

const KNOWN_ACTIVITY_TYPES = [
  "running",
  "hiking",
  "cycling",
  "skiing",
  "paragliding",
  "walking",
  "swimming",
];

// Raw values seen in <trk><type> across Strava exports (PascalCase sport
// names) and other GPX sources (lowercase/snake_case). Kept distinct rather
// than merged (e.g. e-bike vs. mountain bike vs. road cycling are different
// activities, not variants of one "Cycling" bucket).
const ACTIVITY_TYPE_LABELS = {
  emountainbikeride: "E-Mountain Bike Ride",
  mountain_biking: "Mountain Biking",
  cycling: "Cycling",
  hiking: "Hiking",
  walking: "Walking",
  alpineski: "Alpine Skiing",
  kayaking: "Kayaking",
  running: "Running",
  swimming: "Swimming",
  paragliding: "Paragliding",
};

// Reverse of ACTIVITY_TYPE_LABELS, so writer.js can turn a label chosen from
// the frontend's preselected list back into the raw <trk><type> value that
// resolveActivityType() above will read back as that same label.
const LABEL_TO_ACTIVITY_TYPE = Object.fromEntries(
  Object.entries(ACTIVITY_TYPE_LABELS).map(([raw, label]) => [label, raw]),
);

export function activityTypeToRawType(label) {
  return LABEL_TO_ACTIVITY_TYPE[label] ?? label;
}

// Fallback for raw type strings not in the table above: split camelCase and
// snake_case/kebab-case into words and title-case them.
function formatUnknownType(raw) {
  const words = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/);
  return words.map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

function guessActivityType(filename) {
  const base = path.basename(filename, path.extname(filename)).toLowerCase();
  const match = KNOWN_ACTIVITY_TYPES.find((type) => base.includes(type));
  return match ? match[0].toUpperCase() + match.slice(1) : "Unknown";
}

function resolveActivityType(rawType, filename) {
  if (rawType && rawType.trim()) {
    const key = rawType.trim().toLowerCase();
    return ACTIVITY_TYPE_LABELS[key] ?? formatUnknownType(rawType.trim());
  }
  return guessActivityType(filename);
}

function resolveTitle(track, metadata, filePath) {
  if (track?.name && track.name.trim()) return track.name.trim();
  if (metadata?.name && metadata.name.trim()) return metadata.name.trim();
  const stem = path.basename(filePath, path.extname(filePath)).trim();
  return stem || "Untitled";
}

/**
 * Parses a GPX file and returns the flattened point list plus computed
 * activity metrics. gpxparser handles per-track distance/elevation math;
 * speed stats are derived here since it doesn't expose those.
 */
export async function parseGpxFile(filePath) {
  const xml = await readFile(filePath, "utf-8");
  const gpx = new GpxParser();
  gpx.parse(xml);

  const points = gpx.tracks.flatMap((track) => track.points);
  if (points.length < 2) {
    throw new Error(`GPX file ${filePath} does not contain enough track points`);
  }

  const distanceMeters = gpx.tracks.reduce((sum, t) => sum + t.distance.total, 0);
  // gpxparser's own t.elevation.pos/neg sum every raw point-to-point delta,
  // which bakes in GPS/barometric jitter as sawtooth gain/loss. Smooth each
  // track's elevation series first so the totals reflect real climbing.
  const elevationTotals = gpx.tracks.map((t) =>
    computeElevationGainLoss(t.points.map((p) => p.ele ?? null)),
  );
  const elevationGain = elevationTotals.reduce((sum, e) => sum + e.gain, 0);
  const elevationLoss = elevationTotals.reduce((sum, e) => sum + e.loss, 0);

  const startTime = points[0].time ? new Date(points[0].time) : null;
  const endTime = points[points.length - 1].time ? new Date(points[points.length - 1].time) : null;
  const durationSeconds =
    startTime && endTime ? Math.max(0, Math.round((endTime - startTime) / 1000)) : 0;

  const avgSpeedMps = durationSeconds > 0 ? distanceMeters / durationSeconds : null;
  const maxSpeedMps = computeMaxSpeed(gpx.tracks);
  const movingAvgSpeedMps = computeMovingAvgSpeed(gpx.tracks);

  let cumulativeDistance = 0;
  const elevationProfile = [];
  gpx.tracks.forEach((track) => {
    track.points.forEach((p, i) => {
      const segmentDistance = i === 0 ? 0 : track.distance.cumul[i] - track.distance.cumul[i - 1];
      cumulativeDistance += segmentDistance;
      let speedMps = null;
      if (i > 0) {
        const prev = track.points[i - 1];
        if (prev.time && p.time) {
          const dtSeconds = (new Date(p.time) - new Date(prev.time)) / 1000;
          if (dtSeconds > 0) speedMps = segmentDistance / dtSeconds;
        }
      }
      elevationProfile.push({
        distanceMeters: cumulativeDistance,
        elevation: p.ele ?? null,
        speedMps,
      });
    });
  });

  const primaryTrack = gpx.tracks[0];

  return {
    title: resolveTitle(primaryTrack, gpx.metadata, filePath),
    activityType: resolveActivityType(primaryTrack?.type, filePath),
    startTime,
    endTime,
    durationSeconds,
    distanceMeters,
    avgSpeedMps,
    maxSpeedMps,
    movingAvgSpeedMps,
    totalElevationGain: elevationGain,
    totalElevationLoss: elevationLoss,
    points: points.map((p) => ({
      lat: p.lat,
      lon: p.lon,
      elevation: p.ele ?? null,
      timestamp: p.time ? new Date(p.time).getTime() : null,
    })),
    elevationProfile,
  };
}

function computeMaxSpeed(tracks) {
  let maxSpeed = 0;
  for (const track of tracks) {
    for (let i = 1; i < track.points.length; i++) {
      const prev = track.points[i - 1];
      const curr = track.points[i];
      if (!prev.time || !curr.time) continue;
      const dtSeconds = (new Date(curr.time) - new Date(prev.time)) / 1000;
      if (dtSeconds <= 0) continue;
      const dDistance = track.distance.cumul[i] - track.distance.cumul[i - 1];
      const speed = dDistance / dtSeconds;
      if (speed > maxSpeed) maxSpeed = speed;
    }
  }
  return maxSpeed || null;
}

// Average speed over only the "moving" segments (those at or above
// MOVING_SPEED_THRESHOLD_MPS), excluding stopped time such as traffic
// lights, breaks, and photo stops.
function computeMovingAvgSpeed(tracks) {
  let movingDistance = 0;
  let movingSeconds = 0;
  for (const track of tracks) {
    for (let i = 1; i < track.points.length; i++) {
      const prev = track.points[i - 1];
      const curr = track.points[i];
      if (!prev.time || !curr.time) continue;
      const dtSeconds = (new Date(curr.time) - new Date(prev.time)) / 1000;
      if (dtSeconds <= 0) continue;
      const dDistance = track.distance.cumul[i] - track.distance.cumul[i - 1];
      const speed = dDistance / dtSeconds;
      if (speed >= MOVING_SPEED_THRESHOLD_MPS) {
        movingDistance += dDistance;
        movingSeconds += dtSeconds;
      }
    }
  }
  return movingSeconds > 0 ? movingDistance / movingSeconds : null;
}
