import { trackDistanceMeters } from "@/utils/geo";
import { formatDistance, storedUnit } from "@/utils/units";
import { detectLiftSegments } from "./lift-detection";
import * as display from "./live-status-display";
import * as store from "./store";
import type { TrackPoint } from "./types";

// Like the Record screen's cursor, so each sync reads only the new points.
let track: { id: string | null; lastPointId: number; points: TrackPoint[] } = {
  id: null,
  lastPointId: 0,
  points: [],
};

/**
 * Makes the Live Activity (iOS) or the ongoing notification (Android) match
 * the active recording, and removes it when nothing is recording or paused.
 * It reads everything from the store, so the app and the background location
 * task can both call it at any time.
 */
export function syncLiveStatus() {
  const rec = store.getActiveRecording();
  if (rec?.status !== "recording" && rec?.status !== "paused") {
    display.hide();
    return;
  }
  if (track.id !== rec.id) track = { id: rec.id, lastPointId: 0, points: [] };
  const fresh = store.getPoints(rec.id, track.lastPointId);
  if (fresh.length) {
    track.lastPointId = fresh[fresh.length - 1].id;
    track.points = track.points.concat(fresh);
  }
  // The same distance as the Record screen, which leaves lift rides out.
  const liftMeters = detectLiftSegments(track.points).reduce(
    (sum, lift) => sum + lift.distanceMeters,
    0,
  );
  display.show({
    paused: rec.status === "paused",
    elapsedMs: rec.elapsedMs + (rec.segmentStartedAt ? Date.now() - rec.segmentStartedAt : 0),
    distance: formatDistance(trackDistanceMeters(track.points) - liftMeters, storedUnit()),
  });
}
