import { haversineMeters } from "./geo.js";

// A single bad GPS fix (device jumps hundreds of meters in one reading) can
// silently inflate distance/max-speed stats. 55 m/s (~200 km/h) is well above
// any activity type recorded here (fastest legit observed: e-mtb downhill,
// paragliding in strong wind) but far below what a GPS glitch teleport produces.
const DEFAULT_MAX_PLAUSIBLE_SPEED_MPS = 55;

// Drops points that imply an implausible speed from the last *kept* point,
// so a single bad fix doesn't also poison every point after it. Points with
// no timestamp (on either side of the comparison) are always kept, since
// speed can't be evaluated for them.
export function filterOutlierPoints(points, maxSpeedMps = DEFAULT_MAX_PLAUSIBLE_SPEED_MPS) {
  if (points.length < 2) return points;

  const filtered = [points[0]];
  let lastKept = points[0];
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (!lastKept.timestamp || !p.timestamp) {
      filtered.push(p);
      lastKept = p;
      continue;
    }
    const dtSeconds = (p.timestamp - lastKept.timestamp) / 1000;
    const distance = haversineMeters(lastKept, p);
    const speed = dtSeconds > 0 ? distance / dtSeconds : Infinity;
    if (speed > maxSpeedMps) continue;
    filtered.push(p);
    lastKept = p;
  }
  return filtered;
}
