import { requireOptionalNativeModule } from "expo";
import { formatDuration } from "@/utils/geo";
import type { LiveStatus } from "./live-status-display";

// expo-widgets throws on import in a build made before it was added, and an
// over-the-air update can reach such a build.
let RecordingActivity: typeof import("./recording-activity").default | null = null;
if (requireOptionalNativeModule("ExpoWidgets")) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  RecordingActivity = require("./recording-activity").default;
}

export function show({ paused, elapsedMs, distance }: LiveStatus) {
  if (!RecordingActivity) return;
  const props = {
    paused,
    timerStart: Date.now() - elapsedMs,
    duration: formatDuration(elapsedMs),
    distance,
  };
  // iOS refuses to start an activity from the background, or when the person
  // turned Live Activities off. The recording continues without one.
  try {
    const [activity] = RecordingActivity.getInstances();
    if (activity) activity.update(props).catch(() => {});
    else RecordingActivity.start(props, "gpxreport://record");
  } catch {}
}

export function hide() {
  for (const activity of RecordingActivity?.getInstances() ?? []) activity.end("immediate");
}

export async function requestPermission() {}
