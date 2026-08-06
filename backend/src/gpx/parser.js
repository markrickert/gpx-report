import { readFile } from "node:fs/promises";
import path from "node:path";
import GpxParser from "gpxparser";
import { haversineMeters } from "../track/geo.js";
import { filterOutlierPoints } from "../track/outliers.js";

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

  const totalRawPoints = gpx.tracks.reduce((sum, t) => sum + t.points.length, 0);
  if (totalRawPoints < 2) {
    throw new Error(`GPX file ${filePath} does not contain enough track points`);
  }

  let distanceMeters = 0;
  let elevationGain = 0;
  let elevationLoss = 0;
  let maxSpeedMps = 0;
  let cumulativeDistance = 0;
  const elevationProfile = [];
  const allPoints = [];

  for (const track of gpx.tracks) {
    const normalized = track.points.map((p) => ({
      lat: p.lat,
      lon: p.lon,
      elevation: p.ele ?? null,
      timestamp: p.time ? new Date(p.time).getTime() : null,
    }));
    const points = filterOutlierPoints(normalized);

    points.forEach((p, i) => {
      let speedMps = null;
      if (i > 0) {
        const prev = points[i - 1];
        const segmentDistance = haversineMeters(prev, p);
        distanceMeters += segmentDistance;
        cumulativeDistance += segmentDistance;

        if (p.elevation != null && prev.elevation != null) {
          const elevationDelta = p.elevation - prev.elevation;
          if (elevationDelta > 0) elevationGain += elevationDelta;
          else elevationLoss += -elevationDelta;
        }

        if (prev.timestamp && p.timestamp) {
          const dtSeconds = (p.timestamp - prev.timestamp) / 1000;
          if (dtSeconds > 0) {
            speedMps = segmentDistance / dtSeconds;
            if (speedMps > maxSpeedMps) maxSpeedMps = speedMps;
          }
        }
      }
      elevationProfile.push({
        distanceMeters: cumulativeDistance,
        elevation: p.elevation,
        speedMps,
      });
      allPoints.push(p);
    });
  }

  const startTime = allPoints[0].timestamp ? new Date(allPoints[0].timestamp) : null;
  const endTime = allPoints[allPoints.length - 1].timestamp
    ? new Date(allPoints[allPoints.length - 1].timestamp)
    : null;
  const durationSeconds =
    startTime && endTime ? Math.max(0, Math.round((endTime - startTime) / 1000)) : 0;
  const avgSpeedMps = durationSeconds > 0 ? distanceMeters / durationSeconds : null;

  const primaryTrack = gpx.tracks[0];

  return {
    title: resolveTitle(primaryTrack, gpx.metadata, filePath),
    activityType: resolveActivityType(primaryTrack?.type, filePath),
    startTime,
    endTime,
    durationSeconds,
    distanceMeters,
    avgSpeedMps,
    maxSpeedMps: maxSpeedMps || null,
    totalElevationGain: elevationGain,
    totalElevationLoss: elevationLoss,
    points: allPoints.map((p) => ({
      lat: p.lat,
      lon: p.lon,
      elevation: p.elevation,
      timestamp: p.timestamp,
    })),
    elevationProfile,
  };
}
