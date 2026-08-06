import path from "node:path";
import AdmZip from "adm-zip";
import { haversineMeters } from "../track/geo.js";
import { filterOutlierPoints } from "../track/outliers.js";

// Ski Tracks app export (.skiz): a zip archive containing Track.xml (a
// single <track> element with name/activity attributes and precomputed
// metrics this parser doesn't use, computing its own from Nodes.csv the
// same way igc/parser.js does) and Nodes.csv, one point per line, no
// header: timestamp (unix seconds, fractional), lat, lon, elevation (m),
// course (deg), speed (m/s), horizontal accuracy (m), vertical accuracy (m).
function unescapeXml(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function resolveTitle(trackXml, filePath) {
  const name = trackXml.match(/\sname="([^"]*)"/)?.[1]?.trim();
  return name
    ? unescapeXml(name)
    : path.basename(filePath, path.extname(filePath)).trim() || "Untitled";
}

function resolveActivityType(trackXml) {
  const activity = unescapeXml(trackXml.match(/\sactivity="([^"]*)"/)?.[1]?.trim() ?? "");
  if (!activity) return "Skiing";
  return activity
    .split(/\s+/)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export async function parseSkizFile(filePath) {
  const zip = new AdmZip(filePath);
  const nodesEntry = zip.getEntry("Nodes.csv");
  if (!nodesEntry) {
    throw new Error(`Skiz file ${filePath} does not contain Nodes.csv`);
  }
  const trackXml = zip.getEntry("Track.xml")?.getData().toString("utf-8") ?? "";

  const points = [];
  for (const line of nodesEntry.getData().toString("utf-8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [ts, lat, lon, ele] = line.split(",").map(Number);
    if ([ts, lat, lon, ele].some(Number.isNaN)) continue;
    points.push({ lat, lon, elevation: ele, timestamp: Math.round(ts * 1000) });
  }

  if (points.length < 2) {
    throw new Error(`Skiz file ${filePath} does not contain enough GPS points`);
  }

  const filteredPoints = filterOutlierPoints(points);

  let distanceMeters = 0;
  let elevationGain = 0;
  let elevationLoss = 0;
  let maxSpeedMps = 0;
  const elevationProfile = [];

  for (let i = 0; i < filteredPoints.length; i++) {
    if (i > 0) {
      const segmentDistance = haversineMeters(filteredPoints[i - 1], filteredPoints[i]);
      distanceMeters += segmentDistance;

      const elevationDelta = filteredPoints[i].elevation - filteredPoints[i - 1].elevation;
      if (elevationDelta > 0) elevationGain += elevationDelta;
      else elevationLoss += -elevationDelta;

      const dtSeconds = (filteredPoints[i].timestamp - filteredPoints[i - 1].timestamp) / 1000;
      if (dtSeconds > 0) {
        const speed = segmentDistance / dtSeconds;
        if (speed > maxSpeedMps) maxSpeedMps = speed;
      }
    }
    elevationProfile.push({ distanceMeters, elevation: filteredPoints[i].elevation });
  }

  const startTime = new Date(filteredPoints[0].timestamp);
  const endTime = new Date(filteredPoints[filteredPoints.length - 1].timestamp);
  const durationSeconds = Math.max(0, Math.round((endTime - startTime) / 1000));
  const avgSpeedMps = durationSeconds > 0 ? distanceMeters / durationSeconds : null;

  return {
    title: resolveTitle(trackXml, filePath),
    activityType: resolveActivityType(trackXml),
    startTime,
    endTime,
    durationSeconds,
    distanceMeters,
    avgSpeedMps,
    maxSpeedMps: maxSpeedMps || null,
    totalElevationGain: elevationGain,
    totalElevationLoss: elevationLoss,
    points: filteredPoints.map((p) => ({
      lat: p.lat,
      lon: p.lon,
      elevation: p.elevation,
      timestamp: p.timestamp,
    })),
    elevationProfile,
  };
}
