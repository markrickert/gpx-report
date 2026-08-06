import { readFile } from "node:fs/promises";
import path from "node:path";
import GpxParser from "gpxparser";

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
  const elevationGain = gpx.tracks.reduce((sum, t) => sum + (t.elevation.pos || 0), 0);
  const elevationLoss = gpx.tracks.reduce((sum, t) => sum + (t.elevation.neg || 0), 0);

  const startTime = points[0].time ? new Date(points[0].time) : null;
  const endTime = points[points.length - 1].time ? new Date(points[points.length - 1].time) : null;
  const durationSeconds =
    startTime && endTime ? Math.max(0, Math.round((endTime - startTime) / 1000)) : 0;

  const avgSpeedMps = durationSeconds > 0 ? distanceMeters / durationSeconds : null;
  const maxSpeedMps = computeMaxSpeed(gpx.tracks);

  let cumulativeDistance = 0;
  const elevationProfile = [];
  gpx.tracks.forEach((track) => {
    track.points.forEach((p, i) => {
      const segmentDistance = i === 0 ? 0 : track.distance.cumul[i] - track.distance.cumul[i - 1];
      cumulativeDistance += segmentDistance;
      elevationProfile.push({ distanceMeters: cumulativeDistance, elevation: p.ele ?? null });
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
