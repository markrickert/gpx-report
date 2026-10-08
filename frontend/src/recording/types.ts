export type TrackPoint = {
  lat: number;
  lon: number;
  elevation: number | null;
  /** Radius of uncertainty of the position and of the elevation, in meters, as the phone reports them. */
  accuracy?: number | null;
  altitudeAccuracy?: number | null;
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
  uploadedAt: number | null;
};

export type ImportStatus = "pending" | "failed" | "rejected";

/** A file picked for import, copied into the app so the queue survives restarts. */
export type QueuedImport = {
  id: string;
  person: string;
  name: string;
  localUri: string;
  status: ImportStatus;
  createdAt: number;
  uploadAttempts: number;
  nextAttemptAt: number | null;
  /** The network error for "failed", or the server's reason for "rejected". */
  lastError: string | null;
};

export type ImportResult = {
  status: "IMPORTED" | "ALREADY_IMPORTED" | "DUPLICATE" | "REJECTED";
  activityId: string | null;
  title: string | null;
  reason: string | null;
};
