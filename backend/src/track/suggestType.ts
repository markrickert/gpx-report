// Ranks candidate activity types for a track whose type fell back to
// "Unknown" (see gpx/parser.js's filename-guess list), using only the
// aggregate stats already computed per activity (avg/max speed,
// elevation gain/loss, distance) rather than reparsing points_data — those
// stats are cheap (already on every Activity row) and, per the TODO this
// implements, a simple band-fit heuristic is an acceptable, bounded scope
// here (not a trained classifier).
//
// Each candidate type has a rough plausible range per metric (m/s for
// speed, meters-per-km for elevation change). A track scores 1.0 on a
// metric when it falls inside the range, decaying linearly to 0 as it
// moves one range-width past either edge. The overall score per type is
// the average across whichever metrics are available (nulls are skipped
// rather than penalized, so a track missing e.g. maxSpeedMps still gets
// scored on what it has).
//
// "E-Mountain Bike Ride" is intentionally excluded from the candidate
// list: its speed/elevation signature is indistinguishable from plain
// "Mountain Biking" by these metrics (motor assist doesn't show up in
// GPS speed/elevation shape), so ranking it would be false precision.
const TYPE_PROFILES = [
  { type: "Walking", avgSpeed: [0.6, 2.2], maxSpeed: [0.6, 4], elevGainPerKm: [0, 30] },
  { type: "Running", avgSpeed: [2.2, 5.5], maxSpeed: [2.2, 8], elevGainPerKm: [0, 40] },
  { type: "Hiking", avgSpeed: [0.4, 2.0], maxSpeed: [0.4, 4], elevGainPerKm: [25, 250] },
  { type: "Cycling", avgSpeed: [3.5, 14], maxSpeed: [3.5, 20], elevGainPerKm: [0, 20] },
  {
    type: "Mountain Biking",
    avgSpeed: [2.0, 9],
    maxSpeed: [2.0, 16],
    elevGainPerKm: [15, 120],
  },
  {
    type: "Alpine Skiing",
    avgSpeed: [2.5, 15],
    maxSpeed: [8, 30],
    elevLossPerKm: [30, 400],
  },
  { type: "Paragliding", avgSpeed: [3, 20], maxSpeed: [8, 40], elevLossPerKm: [20, 9999] },
  { type: "Swimming", avgSpeed: [0.2, 1.6], maxSpeed: [0.2, 2.5], elevGainPerKm: [0, 10] },
  { type: "Kayaking", avgSpeed: [0.8, 3.5], maxSpeed: [0.8, 5], elevGainPerKm: [0, 10] },
];

// 1.0 inside [lo, hi], decaying linearly to 0 one range-width beyond either
// edge. Returns null (skip, don't penalize) if value is null/undefined.
function bandScore(value, range) {
  if (value == null || !range) return null;
  const [lo, hi] = range;
  if (value >= lo && value <= hi) return 1;
  const width = hi - lo || 1;
  const excess = value < lo ? lo - value : value - hi;
  return Math.max(0, 1 - excess / width);
}

// stats: { avgSpeedMps, maxSpeedMps, totalElevationGain, totalElevationLoss,
// distanceMeters }, matching the fields already stored per Activity.
// Returns candidates sorted by descending score: [{ type, score }, ...].
export function suggestActivityTypes(stats) {
  const { avgSpeedMps, maxSpeedMps, totalElevationGain, totalElevationLoss, distanceMeters } =
    stats;
  const km = distanceMeters > 0 ? distanceMeters / 1000 : null;
  const elevGainPerKm = km && totalElevationGain != null ? totalElevationGain / km : null;
  const elevLossPerKm = km && totalElevationLoss != null ? totalElevationLoss / km : null;

  const scored = TYPE_PROFILES.map((profile) => {
    const scores = [
      bandScore(avgSpeedMps, profile.avgSpeed),
      bandScore(maxSpeedMps, profile.maxSpeed),
      bandScore(elevGainPerKm, profile.elevGainPerKm),
      bandScore(elevLossPerKm, profile.elevLossPerKm),
    ].filter((s) => s != null);
    const score = scores.length > 0 ? scores.reduce((sum, s) => sum + s, 0) / scores.length : 0;
    return { type: profile.type, score };
  });

  return scored.sort((a, b) => b.score - a.score);
}
