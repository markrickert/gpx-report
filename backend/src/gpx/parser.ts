import { readFile } from "node:fs/promises";
import path from "node:path";
import GpxParser from "gpxparser";
import { computeElevationGainLoss } from "../track/elevation.js";
import { suggestActivityTypes } from "../track/suggestType.js";

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

// When neither the GPX's own <trk><type> nor the filename word-list match
// yields a type, fall back to the same band-fit heuristic used post-hoc for
// already-"Unknown" activities (track/suggestType.js), scored against the
// stats this parse just computed. Only accepted when the top candidate has
// a positive score — an all-null/no-signal stats object scores every
// candidate 0 (see suggestActivityTypes), and picking the first of an
// arbitrary tie would be false precision, so "Unknown" is left as-is.
function resolveActivityType(rawType, filename, stats) {
  if (rawType && rawType.trim()) {
    const key = rawType.trim().toLowerCase();
    return ACTIVITY_TYPE_LABELS[key] ?? formatUnknownType(rawType.trim());
  }
  const guessed = guessActivityType(filename);
  if (guessed !== "Unknown") return guessed;
  const [topSuggestion] = suggestActivityTypes(stats);
  return topSuggestion && topSuggestion.score > 0 ? topSuggestion.type : "Unknown";
}

function resolveTitle(track, metadata, filePath) {
  if (track?.name && track.name.trim()) return track.name.trim();
  if (metadata?.name && metadata.name.trim()) return metadata.name.trim();
  const stem = path.basename(filePath, path.extname(filePath)).trim();
  return stem || "Untitled";
}

// gpxparser (via jsdom-global) parses the file into a full DOM but drops
// Garmin's <gpxtpx:TrackPointExtension> (hr/cad/atemp) when building
// track.points — it only reads lat/lon/ele/time. Pull those back out
// ourselves from gpx.xmlSource, the underlying parsed document it retains.
// querySelectorAll("trkpt") over the whole document visits every <trk>'s
// points in the same depth-first order gpxparser used to build
// track.points (each <trk>'s own trkpt.querySelectorAll("trkpt") call, one
// track after another), so the flat list here lines up index-for-index
// with points/elevationProfile below without needing to group by track.
function extractPointExtensions(gpx) {
  return [...gpx.xmlSource.querySelectorAll("trkpt")].map((trkpt) => ({
    hr: getExtensionValue(trkpt, "gpxtpx:hr"),
    cad: getExtensionValue(trkpt, "gpxtpx:cad"),
    atemp: getExtensionValue(trkpt, "gpxtpx:atemp"),
  }));
}

// jsdom parses "text/xml" without namespace resolution, so the prefixed
// extension tags keep their literal "gpxtpx:hr" tag name rather than being
// resolved to a namespace URI + local name — getElementsByTagName with the
// prefixed name matches them directly.
function getExtensionValue(trkpt, tagName) {
  const el = trkpt.getElementsByTagName(tagName)[0];
  if (!el || !el.textContent) return null;
  const value = parseFloat(el.textContent);
  return Number.isNaN(value) ? null : value;
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

  const extensions = extractPointExtensions(gpx);
  const hrValues = extensions.map((e) => e.hr).filter((v) => v != null);
  const avgHr = hrValues.length > 0 ? hrValues.reduce((a, b) => a + b, 0) / hrValues.length : null;
  const maxHr = hrValues.length > 0 ? Math.max(...hrValues) : null;

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
    startTime && endTime
      ? Math.max(0, Math.round((endTime.getTime() - startTime.getTime()) / 1000))
      : 0;

  const avgSpeedMps = durationSeconds > 0 ? distanceMeters / durationSeconds : null;
  const maxSpeedMps = computeMaxSpeed(gpx.tracks);
  const movingAvgSpeedMps = computeMovingAvgSpeed(gpx.tracks);

  let cumulativeDistance = 0;
  let pointIndex = 0;
  const elevationProfile = [];
  gpx.tracks.forEach((track) => {
    track.points.forEach((p, i) => {
      const segmentDistance = i === 0 ? 0 : track.distance.cumul[i] - track.distance.cumul[i - 1];
      cumulativeDistance += segmentDistance;
      let speedMps = null;
      if (i > 0) {
        const prev = track.points[i - 1];
        if (prev.time && p.time) {
          const dtSeconds = (new Date(p.time).getTime() - new Date(prev.time).getTime()) / 1000;
          if (dtSeconds > 0) speedMps = segmentDistance / dtSeconds;
        }
      }
      const ext = extensions[pointIndex] ?? { hr: null, cad: null, atemp: null };
      elevationProfile.push({
        distanceMeters: cumulativeDistance,
        elevation: p.ele ?? null,
        speedMps,
        hr: ext.hr,
        cad: ext.cad,
        atemp: ext.atemp,
      });
      pointIndex++;
    });
  });

  const primaryTrack = gpx.tracks[0];

  return {
    title: resolveTitle(primaryTrack, gpx.metadata, filePath),
    activityType: resolveActivityType(primaryTrack?.type, filePath, {
      avgSpeedMps,
      maxSpeedMps,
      totalElevationGain: elevationGain,
      totalElevationLoss: elevationLoss,
      distanceMeters,
    }),
    startTime,
    endTime,
    durationSeconds,
    distanceMeters,
    avgSpeedMps,
    maxSpeedMps,
    movingAvgSpeedMps,
    totalElevationGain: elevationGain,
    totalElevationLoss: elevationLoss,
    avgHr,
    maxHr,
    points: points.map((p, i) => {
      const ext = extensions[i] ?? { hr: null, cad: null, atemp: null };
      return {
        lat: p.lat,
        lon: p.lon,
        elevation: p.ele ?? null,
        timestamp: p.time ? new Date(p.time).getTime() : null,
        hr: ext.hr,
        cad: ext.cad,
        atemp: ext.atemp,
      };
    }),
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
      const dtSeconds = (new Date(curr.time).getTime() - new Date(prev.time).getTime()) / 1000;
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
      const dtSeconds = (new Date(curr.time).getTime() - new Date(prev.time).getTime()) / 1000;
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
