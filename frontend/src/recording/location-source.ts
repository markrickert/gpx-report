import * as Location from "expo-location";
import { LOCATION_TASK } from "./task";

export type PermissionResult = { granted: boolean; background: boolean };

export async function requestLocationPermissions(): Promise<PermissionResult> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) return { granted: false, background: false };
  const bg = await Location.requestBackgroundPermissionsAsync();
  return { granted: true, background: bg.granted };
}

const LOW_POWER_KEY = "gpx-report-low-power";

/** Read at each Start and Resume, so a change applies from the next one. */
export function getLowPower() {
  return localStorage.getItem(LOW_POWER_KEY) === "true";
}

export function setLowPower(enabled: boolean) {
  localStorage.setItem(LOW_POWER_KEY, String(enabled));
}

// Low power keeps High accuracy, because Android's lower tiers use Wi-Fi and
// cell towers and get no fix on a remote trail. It saves battery with fewer
// points and with one-minute batches, so the app wakes and writes less often.
export async function startLocation(lowPower: boolean) {
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    distanceInterval: lowPower ? 20 : 10,
    timeInterval: lowPower ? 15_000 : 5000,
    deferredUpdatesInterval: lowPower ? 60_000 : 0,
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
