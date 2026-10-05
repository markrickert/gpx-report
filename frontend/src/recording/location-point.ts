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
