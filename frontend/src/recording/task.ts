import * as TaskManager from "expo-task-manager";
import type { LocationObject } from "expo-location";
import { appendPoints, getActiveRecording } from "./store";
import { locationToPoint } from "./location-point";

export const LOCATION_TASK = "gpx-report-location";

// Must run at module scope on every JS startup (imported from the root
// layout): when the OS wakes the app in the background to deliver locations,
// no screen mounts, and the task has to already be registered. Points go
// straight to SQLite so nothing depends on React state being alive.
TaskManager.defineTask<{ locations: LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const rec = getActiveRecording();
  if (!rec || rec.status !== "recording") return;
  appendPoints(
    rec.id,
    data.locations.map((loc) => locationToPoint(loc, rec.segment)),
  );
});
