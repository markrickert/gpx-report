// Haversine distance in meters between two {lat, lon} points.
export function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Compass bearing in degrees (0-360) from point a to point b.
export function bearingDegrees(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Smallest angle (0-180) between two compass bearings.
export function bearingDiffDegrees(a, b) {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

// Total distance and max point-to-point speed for a point list, used by the
// outlier-cleanup resolvers to show before/after stats without touching the
// stored activity row.
export function computeTrackStats(points) {
  let distanceMeters = 0;
  let maxSpeedMps = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const segmentDistance = haversineMeters(prev, curr);
    distanceMeters += segmentDistance;
    if (prev.timestamp && curr.timestamp) {
      const dtSeconds = (curr.timestamp - prev.timestamp) / 1000;
      if (dtSeconds > 0) {
        const speed = segmentDistance / dtSeconds;
        if (speed > maxSpeedMps) maxSpeedMps = speed;
      }
    }
  }
  return { distanceMeters, maxSpeedMps: maxSpeedMps || null };
}
