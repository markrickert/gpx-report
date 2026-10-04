// Converts any activity into "equivalent hiking distance" so cross-training
// counts toward a trip's hiking/walking goal:
//
//   equivalent = factor x (distance + CLIMB_EQUIVALENCE x elevation gain)
//
// The climb term only applies where countsElevation is true. For the rest,
// recorded gain is GPS noise (water) or gravity/lift-assisted (skiing,
// paragliding), so only distance counts.

// Scarf's refinement of Naismith's rule: 1m climbed costs about the same as
// 8m walked on the flat.
export const CLIMB_EQUIVALENCE = 8;

export const EFFORT_FACTORS = [
  { activityType: "Hiking", factor: 1, countsElevation: true },
  { activityType: "Walking", factor: 1, countsElevation: true },
  { activityType: "Running", factor: 1, countsElevation: true },
  { activityType: "Unknown", factor: 1, countsElevation: true },
  { activityType: "Swimming", factor: 4, countsElevation: false },
  { activityType: "Kayaking", factor: 0.5, countsElevation: false },
  { activityType: "Mountain Biking", factor: 0.4, countsElevation: true },
  { activityType: "Cycling", factor: 0.3, countsElevation: true },
  { activityType: "E-Mountain Bike Ride", factor: 0.2, countsElevation: true },
  { activityType: "Alpine Skiing", factor: 0.15, countsElevation: false },
  { activityType: "Paragliding", factor: 0, countsElevation: false },
];

const UNKNOWN = EFFORT_FACTORS.find((f) => f.activityType === "Unknown");

// Types outside the table (custom raw types from a source file) count like
// Unknown: most untyped tracks are walks.
export function effortFactor(activityType) {
  return EFFORT_FACTORS.find((f) => f.activityType === activityType) ?? UNKNOWN;
}

export function equivalentMeters({ activityType, distanceMeters, totalElevationGain }) {
  const { factor, countsElevation } = effortFactor(activityType);
  const climb = countsElevation ? CLIMB_EQUIVALENCE * Math.max(0, totalElevationGain ?? 0) : 0;
  return factor * (distanceMeters + climb);
}
