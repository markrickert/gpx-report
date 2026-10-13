import { requireOptionalNativeModule } from "expo";
import { PermissionsAndroid } from "react-native";
import { formatDuration } from "@/utils/geo";
import type { LiveStatus } from "./live-status-display";
import { LOCATION_TASK } from "./task";

// Null in a build made before the module was added. An over-the-air update
// can reach such a build.
const RecordingNotification = requireOptionalNativeModule("RecordingNotification");

export function show({ paused, elapsedMs, distance }: LiveStatus) {
  RecordingNotification?.show(
    LOCATION_TASK,
    paused ? "Recording paused" : "Recording activity",
    paused ? `${formatDuration(elapsedMs)} · ${distance}` : distance,
    paused ? null : Date.now() - elapsedMs,
    "gpxreport://record",
  );
}

export function hide() {
  RecordingNotification?.hide(LOCATION_TASK);
}

// Android 13 and later keep the notification out of the shade without this.
export async function requestPermission() {
  await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
}
