export type TrackPoint = {
  lat: number;
  lon: number;
  elevation: number | null;
  timestamp: number;
  /**
   * Incremented on every resume, so each pause/resume stretch becomes its
   * own <trkseg> and the pause gap isn't counted as distance while recording.
   */
  segment: number;
};

export type RecordingStatus =
  "recording" | "paused" | "stopped" | "pending" | "uploaded" | "failed";

export type Recording = {
  id: string;
  /**
   * Who recorded it, captured at Start so a later name change in Settings
   * doesn't reassign an in-flight recording; sent as X-GPX-Person on upload.
   */
  person: string;
  status: RecordingStatus;
  title: string | null;
  activityType: string;
  /** Sent as the GPX <trk><desc>, which the server reads into the activity's notes. */
  note: string | null;
  startedAt: number;
  elapsedMs: number;
  segmentStartedAt: number | null;
  segment: number;
  uploadAttempts: number;
  nextAttemptAt: number | null;
  lastError: string | null;
  uploadedFilename: string | null;
};
