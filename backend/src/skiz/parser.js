import path from "node:path";
import AdmZip from "adm-zip";
import { haversineMeters } from "../igc/parser.js";

// Ski Tracks app export (.skiz): a zip archive containing Track.xml (a
// single <track> element with name/activity attributes and precomputed
// metrics this parser doesn't use, computing its own from Nodes.csv the
// same way igc/parser.js does) and Nodes.csv, one point per line, no
// header: timestamp (unix seconds, fractional), lat, lon, elevation (m),
// course (deg), speed (m/s), horizontal accuracy (m), vertical accuracy (m).
function resolveTitle(trackXml, filePath) {
  const name = trackXml.match(/\sname="([^"]*)"/)?.[1]?.trim();
  return name || path.basename(filePath, path.extname(filePath)).trim() || "Untitled";
}

function resolveActivityType(trackXml) {
  const activity = trackXml.match(/\sactivity="([^"]*)"/)?.[1]?.trim();
  return activity ? activity[0].toUpperCase() + activity.slice(1).toLowerCase() : "Skiing";
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
    points: points.map((p) => ({
      lat: p.lat,
      lon: p.lon,
      elevation: p.elevation,
      timestamp: p.timestamp,
    })),
    elevationProfile,
  };
}
