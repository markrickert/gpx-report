import { haversineMeters } from "@/utils/geo";
import type { TrackPoint } from "./types";

// Same band-fit profiles as backend/src/track/suggestType.ts, run on the
// phone so the save form can suggest a type offline. Keep the two in sync.
// Each metric scores 1 inside its range and decays to 0 one range-width past
// either edge; a type's score is the average over the metrics available.
const TYPE_PROFILES: {
  type: string;
  avgSpeed: [number, number];
  maxSpeed: [number, number];
  elevGainPerKm?: [number, number];
  elevLossPerKm?: [number, number];
}[] = [
  { type: "Walking", avgSpeed: [0.6, 2.2], maxSpeed: [0.6, 4], elevGainPerKm: [0, 30] },
  { type: "Running", avgSpeed: [2.2, 5.5], maxSpeed: [2.2, 8], elevGainPerKm: [0, 40] },
  { type: "Hiking", avgSpeed: [0.4, 2.0], maxSpeed: [0.4, 4], elevGainPerKm: [25, 250] },
  { type: "Cycling", avgSpeed: [3.5, 14], maxSpeed: [3.5, 20], elevGainPerKm: [0, 20] },
  { type: "Mountain Biking", avgSpeed: [2.0, 9], maxSpeed: [2.0, 16], elevGainPerKm: [15, 120] },
  { type: "Alpine Skiing", avgSpeed: [2.5, 15], maxSpeed: [8, 30], elevLossPerKm: [30, 400] },
  { type: "Paragliding", avgSpeed: [3, 20], maxSpeed: [8, 40], elevLossPerKm: [20, 9999] },
  { type: "Swimming", avgSpeed: [0.2, 1.6], maxSpeed: [0.2, 2.5], elevGainPerKm: [0, 10] },
  { type: "Kayaking", avgSpeed: [0.8, 3.5], maxSpeed: [0.8, 5], elevGainPerKm: [0, 10] },
];

// Below this a track is GPS jitter around one spot, not an activity.
const MIN_DISTANCE_M = 100;
// Phone elevation wobbles a few meters between fixes; smaller swings are noise.
const ELEVATION_HYSTERESIS_M = 3;
const MIN_SCORE = 0.5;

function bandScore(value: number | null, range?: [number, number]) {
  if (value == null || !range) return null;
  const [lo, hi] = range;
  if (value >= lo && value <= hi) return 1;
  const excess = value < lo ? lo - value : value - hi;
  return Math.max(0, 1 - excess / (hi - lo || 1));
}

/**
 * Per-segment stats, so a pause's gap adds neither distance nor time. Max
 * speed is the 95th percentile of point-to-point speeds because a single
 * GPS jump would otherwise look like a paraglider.
 */
export function trackStats(points: TrackPoint[]) {
  let distance = 0;
  let movingMs = 0;
  let gain = 0;
  let loss = 0;
  const speeds: number[] = [];
  let anchor: number | null = null;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const prev = points[i - 1];
    if (!prev || prev.segment !== p.segment) {
      anchor = p.elevation;
      continue;
    }
    const d = haversineMeters(prev, p);
    const dt = p.timestamp - prev.timestamp;
    distance += d;
    if (dt > 0) {
      movingMs += dt;
      speeds.push(d / (dt / 1000));
    }
    if (p.elevation == null) continue;
    if (anchor == null) anchor = p.elevation;
    else if (Math.abs(p.elevation - anchor) >= ELEVATION_HYSTERESIS_M) {
      if (p.elevation > anchor) gain += p.elevation - anchor;
      else loss += anchor - p.elevation;
      anchor = p.elevation;
    }
  }
  speeds.sort((a, b) => a - b);
  return {
    distanceMeters: distance,
    avgSpeedMps: movingMs > 0 ? distance / (movingMs / 1000) : null,
    maxSpeedMps: speeds.length ? speeds[Math.floor((speeds.length - 1) * 0.95)] : null,
    elevationGain: gain,
    elevationLoss: loss,
  };
}

/** Likely activity types, best first; empty when the track is too short to tell. */
export function suggestActivityTypes(points: TrackPoint[]): string[] {
  const stats = trackStats(points);
  if (stats.distanceMeters < MIN_DISTANCE_M) return [];
  const km = stats.distanceMeters / 1000;
  const gainPerKm = stats.elevationGain / km;
  const lossPerKm = stats.elevationLoss / km;
  return TYPE_PROFILES.map((profile) => {
    const scores = [
      bandScore(stats.avgSpeedMps, profile.avgSpeed),
      bandScore(stats.maxSpeedMps, profile.maxSpeed),
      bandScore(gainPerKm, profile.elevGainPerKm),
      bandScore(lossPerKm, profile.elevLossPerKm),
    ].filter((s) => s != null);
    return { type: profile.type, score: scores.reduce((a, b) => a + b, 0) / scores.length };
  })
    .filter((s) => s.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.type);
}
