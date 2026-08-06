import path from "node:path";
import AdmZip from "adm-zip";
import { haversineMeters } from "../igc/parser.js";

// Slopes app export: a zip archive containing GPS.csv (one point per line,
// no header) plus a Metadata.xml this parser doesn't read. Column order per
// https://github.com/wfraser/slopes-gpx (the only known documentation of the
// format): unix timestamp (seconds, fractional), lat, lon, elevation (m),
// course (deg), speed (m/s), horizontal accuracy (m), vertical accuracy (m).
function resolveTitle(filePath) {
  return path.basename(filePath, path.extname(filePath)).trim() || "Untitled";
}

export async function parseSlpzFile(filePath) {
  const zip = new AdmZip(filePath);
  const entry = zip.getEntry("GPS.csv");
  if (!entry) {
    throw new Error(`Slopes file ${filePath} does not contain GPS.csv`);
  }

  const points = [];
  for (const line of entry.getData().toString("utf-8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [ts, lat, lon, ele] = line.split(",").map(Number);
    if ([ts, lat, lon, ele].some(Number.isNaN)) continue;
    points.push({ lat, lon, elevation: ele, timestamp: Math.round(ts * 1000) });
  }

  if (points.length < 2) {
    throw new Error(`Slopes file ${filePath} does not contain enough GPS points`);
  }

  let distanceMeters = 0;
  let elevationGain = 0;
  let elevationLoss = 0;
  let maxSpeedMps = 0;
  const elevationProfile = [];

  for (let i = 0; i < points.length; i++) {
    if (i > 0) {
      const segmentDistance = haversineMeters(points[i - 1], points[i]);
      distanceMeters += segmentDistance;

      const elevationDelta = points[i].elevation - points[i - 1].elevation;
      if (elevationDelta > 0) elevationGain += elevationDelta;
      else elevationLoss += -elevationDelta;

      const dtSeconds = (points[i].timestamp - points[i - 1].timestamp) / 1000;
      if (dtSeconds > 0) {
        const speed = segmentDistance / dtSeconds;
        if (speed > maxSpeedMps) maxSpeedMps = speed;
      }
    }
    elevationProfile.push({ distanceMeters, elevation: points[i].elevation });
  }

  const startTime = new Date(points[0].timestamp);
  const endTime = new Date(points[points.length - 1].timestamp);
  const durationSeconds = Math.max(0, Math.round((endTime - startTime) / 1000));
  const avgSpeedMps = durationSeconds > 0 ? distanceMeters / durationSeconds : null;

  return {
    title: resolveTitle(filePath),
    activityType: "Skiing",
    startTime,
    endTime,
    durationSeconds,
    distanceMeters,
    avgSpeedMps,
    maxSpeedMps: maxSpeedMps || null,
    totalElevationGain: elevationGain,
    totalElevationLoss: elevationLoss,
    points: points.map((p) => ({
      lat: p.lat,
      lon: p.lon,
      elevation: p.elevation,
      timestamp: p.timestamp,
    })),
    elevationProfile,
  };
}
