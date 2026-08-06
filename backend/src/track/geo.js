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
