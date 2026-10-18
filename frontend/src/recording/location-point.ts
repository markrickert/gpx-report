import type { LocationObject } from "expo-location";
import type { TrackPoint } from "./types";

export function locationToPoint(loc: LocationObject, segment: number): TrackPoint {
  return {
    lat: loc.coords.latitude,
    lon: loc.coords.longitude,
    elevation: loc.coords.altitude ?? null,
    accuracy: loc.coords.accuracy ?? null,
    altitudeAccuracy: loc.coords.altitudeAccuracy ?? null,
    timestamp: loc.timestamp,
    segment,
  };
}

// A segment's first point must be a fresh, accurate fix. Otherwise the phone's
// cached location or a coarse first guess becomes the start of the track, and
// the jump to the real position counts as distance.
const START_MAX_ACCURACY_METERS = 20;
const START_MAX_STALE_MS = 5_000;

export function dropUnsettledStart(
  locations: LocationObject[],
  segmentStartedAt: number | null,
  segmentHasPoints: boolean,
): LocationObject[] {
  if (segmentHasPoints) return locations;
  const settled = locations.findIndex(
    (loc) =>
      (loc.coords.accuracy ?? 0) <= START_MAX_ACCURACY_METERS &&
      loc.timestamp >= (segmentStartedAt ?? 0) - START_MAX_STALE_MS,
  );
  return settled === -1 ? [] : locations.slice(settled);
}
