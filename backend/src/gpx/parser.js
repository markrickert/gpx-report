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

function guessActivityType(filename) {
  const base = path.basename(filename, path.extname(filename)).toLowerCase();
  const match = KNOWN_ACTIVITY_TYPES.find((type) => base.includes(type));
  return match ? match[0].toUpperCase() + match.slice(1) : "Unknown";
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

  return {
    activityType: guessActivityType(filePath),
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
