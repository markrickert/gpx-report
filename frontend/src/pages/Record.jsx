import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@apollo/client";
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from "react-leaflet";
import {
  SAVE_RECORDED_ACTIVITY,
  GET_RECENT_ACTIVITIES_FOR_POLL,
  UPDATE_ACTIVITY_TYPE,
} from "../graphql/queries.js";
import { apolloClient } from "../apolloClient.js";
import { useTheme } from "../theme.jsx";
import { useUnits, formatDistance, formatElevation } from "../units.jsx";
import { ACTIVITY_TYPES } from "../activityTypes.js";

const EARTH_RADIUS_M = 6371000;

function haversineMeters(a, b) {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Builds a minimal GPX 1.1 <gpx><trk><trkseg> document, matching the shape
// backend/src/gpx/writer.js already writes/reads (plain <trk><name>/<type>
// + <trkpt><ele>/<time>), so the recorded file round-trips through the same
// parser/watcher pipeline as any synced GPX file.
function buildGpxXml(points, title) {
  const trkpts = points
    .map((p) => {
      const ele = p.elevation != null ? `<ele>${p.elevation.toFixed(1)}</ele>` : "";
      const time = `<time>${new Date(p.timestamp).toISOString()}</time>`;
      return `   <trkpt lat="${p.lat}" lon="${p.lon}">${ele}${time}</trkpt>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="gpx-report" version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
 <trk>
  <name>${escapeXml(title)}</name>
  <trkseg>
${trkpts}
  </trkseg>
 </trk>
</gpx>
`;
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function geolocationErrorMessage(err) {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return "Location permission was denied. Allow location access for this site in your browser settings to record a track.";
    case err.POSITION_UNAVAILABLE:
      return "Your location is currently unavailable. Make sure GPS/location services are enabled.";
    case err.TIMEOUT:
      return "Timed out waiting for a GPS fix. Try again outdoors with a clear view of the sky.";
    default:
      return `Location error: ${err.message}`;
  }
}

// Recenters the map on the latest point while a recording is in progress.
// Wired in imperatively via useMap() since MapContainer only fits `bounds`
// on mount, matching the pattern Heatmap.jsx's HeatLayer already uses for
// non-declarative Leaflet updates.
function FollowMarker({ point, follow }) {
  const map = useMap();
  useEffect(() => {
    if (point && follow) map.panTo([point.lat, point.lon]);
  }, [map, point, follow]);
  return null;
}

export default function Record() {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const { unit } = useUnits();
  const [status, setStatus] = useState("idle"); // idle | recording | paused | stopped | saving | error
  const [points, setPoints] = useState([]);
  const [error, setError] = useState(null);
  const [title, setTitle] = useState("");
  const [activityType, setActivityType] = useState("Unknown");
  const [now, setNow] = useState(Date.now());
  const [saveNote, setSaveNote] = useState(null);

  const watchIdRef = useRef(null);
  const segmentStartRef = useRef(null);
  const accumulatedMsRef = useRef(0);

  const [saveRecordedActivity] = useMutation(SAVE_RECORDED_ACTIVITY);
  const [updateActivityType] = useMutation(UPDATE_ACTIVITY_TYPE);

  useEffect(() => {
    if (status !== "recording") return undefined;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [status]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, []);

  const elapsedMs =
    accumulatedMsRef.current + (status === "recording" ? now - segmentStartRef.current : 0);

  const distanceMeters = useMemo(() => {
    let total = 0;
    for (let i = 1; i < points.length; i++) total += haversineMeters(points[i - 1], points[i]);
    return total;
  }, [points]);

  const lastPoint = points[points.length - 1] ?? null;
  const positions = useMemo(() => points.map((p) => [p.lat, p.lon]), [points]);

  function handlePosition(pos) {
    const { latitude, longitude, altitude } = pos.coords;
    setPoints((prev) => [
      ...prev,
      { lat: latitude, lon: longitude, elevation: altitude ?? null, timestamp: Date.now() },
    ]);
    setError(null);
  }

  function handleError(err) {
    setError(geolocationErrorMessage(err));
    if (err.code === err.PERMISSION_DENIED) setStatus("idle");
  }

  function beginWatch() {
    watchIdRef.current = navigator.geolocation.watchPosition(handlePosition, handleError, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15000,
    });
  }

  function handleStart() {
    if (!("geolocation" in navigator)) {
      setError("Geolocation is not supported by this browser.");
      return;
    }
    setError(null);
    setSaveNote(null);
    setPoints([]);
    accumulatedMsRef.current = 0;
    segmentStartRef.current = Date.now();
    setNow(Date.now());
    setStatus("recording");
    beginWatch();
  }

  function handlePause() {
    if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    accumulatedMsRef.current += Date.now() - segmentStartRef.current;
    setStatus("paused");
  }

  function handleResume() {
    segmentStartRef.current = Date.now();
    setNow(Date.now());
    setStatus("recording");
    beginWatch();
  }

  function handleStop() {
    if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
    if (status === "recording") accumulatedMsRef.current += Date.now() - segmentStartRef.current;
    setStatus("stopped");
  }

  function handleDiscard() {
    setPoints([]);
    accumulatedMsRef.current = 0;
    setStatus("idle");
    setSaveNote(null);
  }

  // Polls for the recorded activity to show up after the watcher picks up
  // and processes the file (async, not awaited by the save mutation itself)
  // rather than blocking the UI on that. Gives up after a short window and
  // just points the user at the dashboard.
  async function pollForActivity(filename, attempt = 0) {
    const { data } = await apolloClient.query({
      query: GET_RECENT_ACTIVITIES_FOR_POLL,
      fetchPolicy: "network-only",
    });
    const found = data?.activities?.find((a) => a.gpxFilename === filename);
    if (found) return found;
    if (attempt >= 8) return null;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return pollForActivity(filename, attempt + 1);
  }

  async function handleSave() {
    if (points.length < 2) {
      setError("Not enough GPS points recorded to save an activity.");
      return;
    }
    setStatus("saving");
    setError(null);
    try {
      const defaultTitle = `Recorded ${new Date(points[0].timestamp).toLocaleString()}`;
      const gpxContent = buildGpxXml(points, title.trim() || defaultTitle);
      const { data } = await saveRecordedActivity({ variables: { gpxContent } });
      const filename = data.saveRecordedActivity.filename;

      setSaveNote("Saved. Processing your activity...");
      const activity = await pollForActivity(filename);
      if (activity && activityType !== "Unknown") {
        await updateActivityType({ variables: { id: activity.id, activityType } });
      }
      if (activity) {
        navigate(`/activities/${activity.id}`);
      } else {
        setSaveNote("Saved. It should appear on the dashboard shortly.");
        setStatus("stopped");
      }
    } catch (err) {
      setError(`Failed to save recording: ${err.message}`);
      setStatus("stopped");
    }
  }

  const isRecording = status === "recording";
  const isPaused = status === "paused";
  const isStopped = status === "stopped";
  const isSaving = status === "saving";

  return (
    <div className="record-page">
      <h1>Record</h1>
      <p className="chart-hint">
        Foreground GPS recording only — keep this tab open and your screen on while recording.
        Backgrounding the tab or locking your phone will pause tracking; the browser does not
        support reliable GPS recording while backgrounded.
      </p>

      {error && <p className="title-edit-error">{error}</p>}
      {saveNote && <p className="chart-hint">{saveNote}</p>}

      <div className="record-stats">
        <div className="metric-tile">
          <span className="metric-icon">⏱️</span>
          <span className="metric-body">
            <span className="metric-value">{formatDuration(elapsedMs)}</span>
            <span className="metric-label">Duration</span>
          </span>
        </div>
        <div className="metric-tile">
          <span className="metric-icon">📏</span>
          <span className="metric-body">
            <span className="metric-value">{formatDistance(distanceMeters, unit)}</span>
            <span className="metric-label">Distance</span>
          </span>
        </div>
        <div className="metric-tile">
          <span className="metric-icon">⛰️</span>
          <span className="metric-body">
            <span className="metric-value">
              {lastPoint ? formatElevation(lastPoint.elevation, unit) : "-"}
            </span>
            <span className="metric-label">Elevation</span>
          </span>
        </div>
        <div className="metric-tile">
          <span className="metric-icon">📍</span>
          <span className="metric-body">
            <span className="metric-value">{points.length}</span>
            <span className="metric-label">Points</span>
          </span>
        </div>
      </div>

      {points.length === 0 ? (
        <p className="chart-hint">
          {isRecording ? "Waiting for a GPS fix..." : "Start recording to see your live track."}
        </p>
      ) : (
        <MapContainer center={positions[0]} zoom={17} className="record-map">
          {theme === "dark" ? (
            <TileLayer
              attribution='&copy; OpenStreetMap contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              subdomains="abcd"
            />
          ) : (
            <TileLayer
              attribution="&copy; OpenStreetMap contributors"
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
          )}
          <Polyline positions={positions} />
          {lastPoint && (
            <CircleMarker
              center={[lastPoint.lat, lastPoint.lon]}
              radius={7}
              pathOptions={{ color: "#fff", weight: 2, fillColor: "#2563eb", fillOpacity: 1 }}
              interactive={false}
            />
          )}
          <FollowMarker point={lastPoint} follow={isRecording} />
        </MapContainer>
      )}

      {(isStopped || isSaving) && (
        <div className="record-save-form">
          <label>
            Title
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={`Recorded ${new Date().toLocaleDateString()}`}
              disabled={isSaving}
            />
          </label>
          <label>
            Activity type
            <select
              value={activityType}
              onChange={(e) => setActivityType(e.target.value)}
              disabled={isSaving}
            >
              {ACTIVITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="record-controls">
        {status === "idle" && (
          <button className="record-button record-start" onClick={handleStart}>
            Start
          </button>
        )}
        {isRecording && (
          <>
            <button className="record-button record-pause" onClick={handlePause}>
              Pause
            </button>
            <button className="record-button record-stop" onClick={handleStop}>
              Stop
            </button>
          </>
        )}
        {isPaused && (
          <>
            <button className="record-button record-start" onClick={handleResume}>
              Resume
            </button>
            <button className="record-button record-stop" onClick={handleStop}>
              Stop
            </button>
          </>
        )}
        {isStopped && (
          <>
            <button className="record-button record-start" onClick={handleSave}>
              Save
            </button>
            <button className="record-button record-discard" onClick={handleDiscard}>
              Discard
            </button>
          </>
        )}
        {isSaving && (
          <button className="record-button record-start" disabled>
            Saving...
          </button>
        )}
      </div>
    </div>
  );
}
