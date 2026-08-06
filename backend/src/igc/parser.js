import { readFile } from "node:fs/promises";
import path from "node:path";
import { haversineMeters } from "../track/geo.js";
import { filterOutlierPoints } from "../track/outliers.js";

export { haversineMeters };

// IGC B-record: B HHMMSS DDMMmmm N/S DDDMMmmm E/W A PPPPP GGGGG ...
// Fixed-width fields per the IGC spec (http://www.fai.org/igc-documents).
const B_RECORD_RE =
  /^B(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{3})([NS])(\d{3})(\d{2})(\d{3})([EW])[AV](\d{5})(\d{5})/;

// HFDTE date-of-flight header. Seen as both "HFDTEDDMMYY" and
// "HFDTEDATE:DDMMYY" across loggers.
const H_DATE_RE = /^HFDTE(?:DATE:)?(\d{2})(\d{2})(\d{2})/;

function parseLatLon(degStr, minStr, minFracStr, hemisphere, negativeHemisphere) {
  const deg = Number(degStr);
  const min = Number(minStr) + Number(minFracStr) / 1000;
  const value = deg + min / 60;
  return hemisphere === negativeHemisphere ? -value : value;
}

function resolveTitle(filePath) {
  return path.basename(filePath, path.extname(filePath)).trim() || "Untitled";
}

/**
 * Parses an IGC flight-recorder log (paragliding/gliding) and returns the
 * same shape gpx/parser.js's parseGpxFile() does, so processor.js can treat
 * both formats identically. IGC has no track-name/type header equivalent to
 * GPX's <trk><name>/<type>, so title falls back to the filename stem and
 * activityType is fixed to "Paragliding" (the only IGC source in use here).
 */
export async function parseIgcFile(filePath) {
  const text = await readFile(filePath, "utf-8");
  const lines = text.split(/\r?\n/);

  let dateUtc = null;
  const points = [];

  for (const line of lines) {
    const dateMatch = line.match(H_DATE_RE);
    if (dateMatch) {
      const [, dd, mm, yy] = dateMatch;
      dateUtc = { day: Number(dd), month: Number(mm), year: 2000 + Number(yy) };
      continue;
    }

    const b = line.match(B_RECORD_RE);
    if (!b || !dateUtc) continue;

    const [, hh, min, ss, latDeg, latMin, latFrac, ns, lonDeg, lonMin, lonFrac, ew, , gnssAlt] = b;
    const timestamp = Date.UTC(
      dateUtc.year,
      dateUtc.month - 1,
      dateUtc.day,
      Number(hh),
      Number(min),
      Number(ss),
    );

    points.push({
      lat: parseLatLon(latDeg, latMin, latFrac, ns, "S"),
      lon: parseLatLon(lonDeg, lonMin, lonFrac, ew, "W"),
      elevation: Number(gnssAlt),
      timestamp,
    });
  }

  if (points.length < 2) {
    throw new Error(`IGC file ${filePath} does not contain enough B-records`);
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
    title: resolveTitle(filePath),
    activityType: "Paragliding",
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
