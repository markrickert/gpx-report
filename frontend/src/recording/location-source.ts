import * as Location from "expo-location";
import { LOCATION_TASK } from "./task";

export type PermissionResult = { granted: boolean; background: boolean };

export async function requestLocationPermissions(): Promise<PermissionResult> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return { granted: false, background: false };
  const bg = await Location.requestBackgroundPermissionsAsync();
  return { granted: true, background: bg.granted };
}

export async function startLocation() {
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    distanceInterval: 5,
    timeInterval: 2000,
    activityType: Location.ActivityType.Fitness,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: "Recording activity",
      notificationBody: "GPX Report is recording your route.",
      killServiceOnDestroy: false,
    },
  });
}

export async function stopLocation() {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
}
