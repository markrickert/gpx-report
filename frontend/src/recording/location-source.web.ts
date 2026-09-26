import * as Location from "expo-location";
import { appendPoints, getActiveRecording } from "./store";
import { locationToPoint } from "./location-point";
import type { PermissionResult } from "./location-source";

// Foreground-only: the browser stops delivering positions once the tab is
// backgrounded or the screen locks. Same exports as location-source.ts.
let subscription: Location.LocationSubscription | null = null;

export async function requestLocationPermissions(): Promise<PermissionResult> {
  const fg = await Location.requestForegroundPermissionsAsync();
  return { granted: fg.granted, background: false };
}

export async function startLocation() {
  subscription?.remove();
  subscription = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.BestForNavigation },
    (loc) => {
      const rec = getActiveRecording();
      if (rec?.status === "recording") appendPoints(rec.id, [locationToPoint(loc, rec.segment)]);
    },
  );
}

export async function stopLocation() {
  subscription?.remove();
  subscription = null;
}
