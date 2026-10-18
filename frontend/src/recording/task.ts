import * as TaskManager from "expo-task-manager";
import type { LocationObject } from "expo-location";
import { appendPoints, getActiveRecording, hasSegmentPoints } from "./store";
import { dropUnsettledStart, locationToPoint } from "./location-point";
import { syncLiveStatus } from "./live-status";

export const LOCATION_TASK = "gpx-report-location";

const LIVE_STATUS_INTERVAL_MS = 10_000;
let lastLiveStatusAt = 0;

// Must run at module scope on every JS startup (imported from the root
// layout): when the OS wakes the app in the background to deliver locations,
// no screen mounts, and the task has to already be registered. Points go
// straight to SQLite so nothing depends on React state being alive.
TaskManager.defineTask<{ locations: LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return;
  const rec = getActiveRecording();
  if (!rec || rec.status !== "recording") return;
  const locations = dropUnsettledStart(
    data.locations,
    rec.segmentStartedAt,
    hasSegmentPoints(rec.id, rec.segment),
  );
  appendPoints(
    rec.id,
    locations.map((loc) => locationToPoint(loc, rec.segment)),
  );
  if (Date.now() - lastLiveStatusAt >= LIVE_STATUS_INTERVAL_MS) {
    lastLiveStatusAt = Date.now();
    syncLiveStatus();
  }
});

// Removes a Live Activity or notification that outlived its recording, for
// example after the app was killed.
syncLiveStatus();
