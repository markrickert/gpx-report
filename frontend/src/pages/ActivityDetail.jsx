import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation } from "@apollo/client";
import { MapContainer, TileLayer, Polyline, CircleMarker } from "react-leaflet";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
  ReferenceDot,
} from "recharts";
import {
  GET_ACTIVITY,
  UPDATE_ACTIVITY_TITLE,
  UPDATE_ACTIVITY_TYPE,
  TRIM_ACTIVITY,
  GET_ACTIVITY_OUTLIER_DIFF,
  CLEAN_ACTIVITY_OUTLIERS,
} from "../graphql/queries.js";
import {
  useUnits,
  formatDistance,
  formatElevation,
  formatSpeed,
  distanceValue,
  elevationValue,
  distanceUnitLabel,
  elevationUnitLabel,
} from "../units.jsx";
import { useTheme } from "../theme.jsx";
import { ACTIVITY_TYPES } from "../activityTypes.js";
import { apiOrigin } from "../apolloClient.js";

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// .gpx and .skiz activities support edits (gpx/writer.js and skiz/writer.js
// rewrite the source file; .igc has no equivalent write path yet).
function isEditable(activity) {
  const filename = activity.gpxFilename.toLowerCase();
  return filename.endsWith(".gpx") || filename.endsWith(".skiz");
}

// A single edit-mode flag drives every editable field on the page (title,
// activity type, and future track-editing tools like trim), so entering
// edit puts the whole activity into one consistent editable state rather
// than each field toggling independently.
function ActivityHeader({ activity, editMode, onEditModeChange }) {
  const [updateTitle] = useMutation(UPDATE_ACTIVITY_TITLE);
  const [updateType] = useMutation(UPDATE_ACTIVITY_TYPE);
  const [titleDraft, setTitleDraft] = useState(activity.title);
  const [typeDraft, setTypeDraft] = useState(activity.activityType);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  if (!editMode) {
    return (
      <>
        <h1>
          {activity.title}{" "}
          {isEditable(activity) && (
            <button
              className="title-edit-button"
              onClick={() => {
                setTitleDraft(activity.title);
                setTypeDraft(activity.activityType);
                setError(null);
                onEditModeChange(true);
              }}
              aria-label="Edit activity"
            >
              Edit
            </button>
          )}
        </h1>
        <p>
          <span className="activity-type-badge">{activity.activityType}</span>{" "}
          {new Date(activity.startTime).toLocaleString()}{" "}
          <a href={`${apiOrigin}/activities/${activity.id}/download`} className="download-link">
            Download {activity.gpxFilename.split(".").pop().toUpperCase()}
          </a>
        </p>
      </>
    );
  }

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const title = titleDraft.trim();
      const updates = [];
      if (title && title !== activity.title) {
        updates.push(updateTitle({ variables: { id: activity.id, title } }));
      }
      if (typeDraft !== activity.activityType) {
        updates.push(updateType({ variables: { id: activity.id, activityType: typeDraft } }));
      }
      await Promise.all(updates);
      onEditModeChange(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="title-edit-row">
      <input
        value={titleDraft}
        onChange={(e) => setTitleDraft(e.target.value)}
        autoFocus
        disabled={saving}
      />
      <select value={typeDraft} onChange={(e) => setTypeDraft(e.target.value)} disabled={saving}>
        {ACTIVITY_TYPES.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>
      <button onClick={save} disabled={saving}>
        Save
      </button>
      <button onClick={() => onEditModeChange(false)} disabled={saving}>
        Cancel
      </button>
      {error && <p className="title-edit-error">Failed to save: {error}</p>}
    </div>
  );
}

// Taller grey pill (rather than recharts' default small circle) centered on
// the chart's vertical middle, easier to grab on a touch screen. Spreads the
// rest of the props (recharts passes onMouseDown/onTouchStart/style etc.
// through here) onto the <rect> before the explicit visual attrs below, so
// the dot itself stays draggable instead of silently swallowing touches that
// land on it (it renders isFront, on top of the invisible wide catch-line,
// so a touch landing on the dot never reaches the line's own handler).
function TrimHandleShape({ cx, cy, ...rest }) {
  return (
    <rect
      {...rest}
      x={cx - 7}
      y={cy - 18}
      width={14}
      height={36}
      rx={7}
      fill="#9ca3af"
      stroke="#fff"
      strokeWidth={2}
    />
  );
}

const REST_SPEED_THRESHOLD_MPS = 0.3;

function speedColor(normalizedSpeed) {
  const hue = 220 * normalizedSpeed;
  return `hsl(${hue}, 70%, 50%)`;
}

// Recharts has no built-in per-segment line coloring, so the "gradient by
// speed" line is faked with an SVG linearGradient whose stops are spread
// evenly along the line (matching the chart's category-based x-axis, which
// already spaces points by index rather than true distance).
function buildSpeedGradientStops(elevationData, maxSpeedMps) {
  const maxSpeed = maxSpeedMps || Math.max(1, ...elevationData.map((p) => p.speedMps || 0));
  const stopCount = Math.min(elevationData.length, 60);
  const step = Math.max(1, Math.floor(elevationData.length / stopCount));
  const stops = [];
  for (let i = 0; i < elevationData.length; i += step) {
    const point = elevationData[i];
    const normalizedSpeed = Math.min(1, (point.speedMps ?? 0) / maxSpeed);
    stops.push({
      offset: `${(i / (elevationData.length - 1 || 1)) * 100}%`,
      color: speedColor(normalizedSpeed),
    });
  }
  const last = elevationData[elevationData.length - 1];
  stops.push({
    offset: "100%",
    color: speedColor(Math.min(1, (last?.speedMps ?? 0) / maxSpeed)),
  });
  return stops;
}

function buildRestBands(elevationData) {
  const bands = [];
  let start = null;
  elevationData.forEach((point, i) => {
    const resting = (point.speedMps ?? 0) < REST_SPEED_THRESHOLD_MPS;
    if (resting && start === null) {
      start = i;
    } else if (!resting && start !== null) {
      if (i - start > 1) bands.push([start, i - 1]);
      start = null;
    }
  });
  if (start !== null && elevationData.length - start > 1) {
    bands.push([start, elevationData.length - 1]);
  }
  return bands;
}

// Saves the range set by the two draggable ReferenceLine handles on the
// elevation chart (see ActivityDetail below). Destructive-action
// confirmation since trimActivity permanently deletes GPX track points.
function TrimControls({ activity, pointCount, trimRange, onSaved }) {
  const [trimActivity] = useMutation(TRIM_ACTIVITY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [start, end] = trimRange;
  const trimmed = start > 0 || end < pointCount - 1;

  const save = async () => {
    if (
      !window.confirm(
        "Trimming permanently deletes the selected track points from the source GPX file. This cannot be undone. Continue?",
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await trimActivity({ variables: { id: activity.id, startIndex: start, endIndex: end } });
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="trim-controls">
      <p className="chart-hint">
        Drag the two vertical handles on the chart above to set the trim range.
      </p>
      <button onClick={save} disabled={saving || !trimmed}>
        Trim &amp; Save
      </button>
      {error && <p className="title-edit-error">Failed to save: {error}</p>}
    </div>
  );
}

// Surfaces the backend's outlier detector (track/outliers.js) for this one
// activity: shows original vs. cleaned track on a map plus a stats diff, and
// lets the user opt in to permanently rewriting the source file to drop the
// flagged points. Self-hides when the activity has no flagged points, so it
// costs nothing to always render on the page. Unlike title/type/trim
// editing, this supports .igc as well (igc/writer.js can drop B-records).
function OutlierCleanup({ activity }) {
  const { unit } = useUnits();
  const { theme } = useTheme();
  const { data, loading, error, refetch } = useQuery(GET_ACTIVITY_OUTLIER_DIFF, {
    variables: { id: activity.id },
  });
  const [cleanOutliers, { loading: cleaning }] = useMutation(CLEAN_ACTIVITY_OUTLIERS);
  const [saveError, setSaveError] = useState(null);

  if (loading || error || !data?.activityOutlierDiff) return null;
  const diff = data.activityOutlierDiff;
  if (diff.outlierPoints.length === 0) return null;

  const removedSet = new Set(diff.outlierPoints.map((p) => p.index));
  const originalPositions = activity.route.coordinates.map((p) => [p.lat, p.lon]);
  const cleanedPositions = originalPositions.filter((_, i) => !removedSet.has(i));
  const outlierPositions = diff.outlierPoints.map((p) => [p.lat, p.lon]);

  const save = async () => {
    if (
      !window.confirm(
        `Remove ${diff.outlierPoints.length} flagged GPS point(s) from the source file? This permanently rewrites the file and cannot be undone.`,
      )
    ) {
      return;
    }
    setSaveError(null);
    try {
      await cleanOutliers({ variables: { id: activity.id } });
      await refetch();
    } catch (e) {
      setSaveError(e.message);
    }
  };

  return (
    <div className="outlier-cleanup">
      <h2>⚠️ GPS Anomalies ({diff.outlierPoints.length})</h2>
      <p className="chart-hint">
        These points imply an implausible speed jump (device jitter or a GPS teleport glitch). Grey
        is the original track, blue is the track with the flagged points removed; red markers are
        the flagged points themselves.
      </p>
      <div className="stats-table-wrap">
        <table className="stats-table">
          <thead>
            <tr>
              <th></th>
              <th>Original</th>
              <th>Cleaned</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Max Speed</td>
              <td>{formatSpeed(diff.originalMaxSpeedMps, unit)}</td>
              <td>{formatSpeed(diff.cleanedMaxSpeedMps, unit)}</td>
            </tr>
            <tr>
              <td>Distance</td>
              <td>{formatDistance(diff.originalDistanceMeters, unit)}</td>
              <td>{formatDistance(diff.cleanedDistanceMeters, unit)}</td>
            </tr>
            <tr>
              <td>Points</td>
              <td>{diff.originalPointCount}</td>
              <td>{diff.cleanedPointCount}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {originalPositions.length > 0 && (
        <MapContainer
          bounds={originalPositions}
          boundsOptions={{ padding: [20, 20] }}
          className="activity-map"
        >
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
          <Polyline positions={originalPositions} pathOptions={{ color: "#9ca3af", weight: 2 }} />
          <Polyline positions={cleanedPositions} pathOptions={{ color: "#2563eb", weight: 3 }} />
          {outlierPositions.map((pos, i) => (
            <CircleMarker
              key={i}
              center={pos}
              radius={7}
              pathOptions={{ color: "#fff", weight: 2, fillColor: "#ef4444", fillOpacity: 1 }}
            />
          ))}
        </MapContainer>
      )}
      <div className="trim-controls">
        <button onClick={save} disabled={cleaning}>
          Clean &amp; Save
        </button>
        {saveError && <p className="title-edit-error">Failed to save: {saveError}</p>}
      </div>
    </div>
  );
}

export default function ActivityDetail() {
  const { id } = useParams();
  const { unit } = useUnits();
  const { theme } = useTheme();
  const { data, loading, error, refetch } = useQuery(GET_ACTIVITY, { variables: { id } });
  const [editMode, setEditMode] = useState(false);
  const [trimRange, setTrimRange] = useState(null);
  const [dragging, setDragging] = useState(null); // null | "start" | "end"
  const [hoverIndex, setHoverIndex] = useState(null); // synced chart<->map hover position

  if (loading) return <p>Loading...</p>;
  if (error) return <p>Error loading activity: {error.message}</p>;
  if (!data.activity) return <p>Activity not found.</p>;

  const activity = data.activity;
  const positions = activity.route.coordinates.map((p) => [p.lat, p.lon]);
  const elevationData = activity.route.elevationProfile.map((p, i) => ({
    idx: i,
    dist: distanceValue(p.distanceMeters, unit).toFixed(2),
    elevation: elevationValue(p.elevation, unit),
    speedMps: p.speedMps,
  }));
  const elevations = elevationData.map((p) => p.elevation);
  const elevationPadding = unit === "imperial" ? 30 : 10;
  const elevationDomain =
    elevations.length > 0
      ? [
          Math.floor(Math.min(...elevations) - elevationPadding),
          Math.ceil(Math.max(...elevations) + elevationPadding),
        ]
      : [0, "auto"];
  const elevationMid = elevations.length > 0 ? (elevationDomain[0] + elevationDomain[1]) / 2 : 0;
  const speedGradientStops = buildSpeedGradientStops(elevationData, activity.maxSpeedMps);
  const restBands = buildRestBands(elevationData);

  const [trimStart, trimEnd] = trimRange ?? [0, elevationData.length - 1];
  const trimActive = editMode && isEditable(activity) && trimRange !== null;
  const visiblePositions = trimActive ? positions.slice(trimStart, trimEnd + 1) : positions;

  // Drag handles report position via recharts' own hit-testing
  // (activeTooltipIndex, computed against the chart's real pixel scale)
  // rather than manual pixel math, so it stays accurate regardless of
  // chart margins/axis width. Same handler serves mouse and touch since
  // recharts passes the same shape of state for both.
  const handleChartDrag = (state) => {
    if (!dragging) {
      const idx = state?.activeTooltipIndex;
      setHoverIndex(idx == null ? null : idx);
      return;
    }
    const idx = state?.activeTooltipIndex;
    if (idx == null) return;
    if (dragging === "start") {
      setTrimRange([Math.max(0, Math.min(idx, trimEnd)), trimEnd]);
    } else {
      setTrimRange([trimStart, Math.min(elevationData.length - 1, Math.max(idx, trimStart))]);
    }
  };
  const endDrag = () => setDragging(null);
  const clearHover = () => setHoverIndex(null);

  // Finds the closest track point to a map mousemove event, so hovering the
  // route on the map can drive the same hoverIndex the elevation chart uses.
  // Nearest-neighbor scan over visiblePositions is fine here: single-activity
  // tracks top out at a few thousand points, no spatial index needed.
  const handleMapHover = (e) => {
    if (visiblePositions.length === 0) return;
    const { lat, lng } = e.latlng;
    let bestIdx = 0;
    let bestDist = Infinity;
    visiblePositions.forEach(([plat, plon], i) => {
      const d = (plat - lat) ** 2 + (plon - lng) ** 2;
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    });
    setHoverIndex(bestIdx + trimStart);
  };

  const enterEditMode = () => {
    setTrimRange([0, elevationData.length - 1]);
    setEditMode(true);
  };
  const exitEditMode = () => {
    setTrimRange(null);
    setEditMode(false);
  };

  return (
    <div>
      <ActivityHeader
        activity={activity}
        editMode={editMode}
        onEditModeChange={(next) => (next ? enterEditMode() : exitEditMode())}
      />

      <div className="metrics-grid">
        <div className="metric-tile">
          <span className="metric-icon" aria-hidden="true">
            ⏱
          </span>
          <span className="metric-body">
            <span className="metric-value">{formatDuration(activity.durationSeconds)}</span>
            <span className="metric-label">Duration</span>
          </span>
        </div>
        <div className="metric-tile">
          <span className="metric-icon" aria-hidden="true">
            📏
          </span>
          <span className="metric-body">
            <span className="metric-value">{formatDistance(activity.distanceMeters, unit)}</span>
            <span className="metric-label">Distance</span>
          </span>
        </div>
        <div className="metric-tile">
          <span className="metric-icon" aria-hidden="true">
            ⚡
          </span>
          <span className="metric-body">
            <span className="metric-value">{formatSpeed(activity.avgSpeedMps, unit)}</span>
            <span className="metric-label">Avg Speed</span>
          </span>
        </div>
        <div className="metric-tile">
          <span className="metric-icon" aria-hidden="true">
            🚀
          </span>
          <span className="metric-body">
            <span className="metric-value">{formatSpeed(activity.maxSpeedMps, unit)}</span>
            <span className="metric-label">Max Speed</span>
          </span>
        </div>
        <div className="metric-tile">
          <span className="metric-icon" aria-hidden="true">
            ⛰️
          </span>
          <span className="metric-body">
            <span className="metric-value">
              {formatElevation(activity.totalElevationGain, unit)}
            </span>
            <span className="metric-label">Elevation Gain</span>
          </span>
        </div>
        <div className="metric-tile">
          <span className="metric-icon" aria-hidden="true">
            📉
          </span>
          <span className="metric-body">
            <span className="metric-value">
              {formatElevation(activity.totalElevationLoss, unit)}
            </span>
            <span className="metric-label">Elevation Loss</span>
          </span>
        </div>
      </div>

      {visiblePositions.length > 0 && (
        <MapContainer
          bounds={visiblePositions}
          boundsOptions={{ padding: [20, 20] }}
          className="activity-map"
        >
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
          <Polyline
            positions={visiblePositions}
            eventHandlers={{
              mousemove: handleMapHover,
              mouseout: clearHover,
            }}
          />
          {hoverIndex != null &&
            hoverIndex >= trimStart &&
            hoverIndex <= trimEnd &&
            positions[hoverIndex] && (
              <CircleMarker
                center={positions[hoverIndex]}
                radius={6}
                pathOptions={{ color: "#fff", weight: 2, fillColor: "#2563eb", fillOpacity: 1 }}
                interactive={false}
              />
            )}
        </MapContainer>
      )}

      <h2>Elevation Profile</h2>
      <p className="chart-hint">
        Line color shows speed (blue = fast, red = slow); shaded bands mark rest stops.
      </p>
      <ResponsiveContainer width="100%" height={250} className="elevation-chart">
        <LineChart
          data={elevationData}
          onMouseMove={handleChartDrag}
          onMouseUp={endDrag}
          onMouseLeave={() => {
            endDrag();
            clearHover();
          }}
          onTouchMove={handleChartDrag}
          onTouchEnd={endDrag}
        >
          <defs>
            <linearGradient id="speedGradient" x1="0" y1="0" x2="1" y2="0">
              {speedGradientStops.map((stop, i) => (
                <stop key={i} offset={stop.offset} stopColor={stop.color} />
              ))}
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="dist"
            label={{
              value: `Distance (${distanceUnitLabel(unit)})`,
              position: "insideBottom",
              offset: -5,
            }}
          />
          {/* Hidden axis keyed by point index rather than "dist": recharts'
              category-axis Reference* lookup silently fails to render at all
              once the axis key has duplicate values, which "dist" (rounded
              to 2 decimals) does constantly on real tracks — index is always
              unique, so Reference* components below target this axis instead. */}
          <XAxis dataKey="idx" xAxisId="idx" hide allowDuplicatedCategory={false} />
          <YAxis
            domain={elevationDomain}
            tickFormatter={(value) => Math.round(value)}
            label={{
              value: `Elevation (${elevationUnitLabel(unit)})`,
              angle: -90,
              position: "insideLeft",
            }}
          />
          <Tooltip
            contentStyle={{ background: "rgba(17, 24, 39, 0.92)", border: "none", borderRadius: 6 }}
            labelStyle={{ color: "#e5e7eb" }}
            itemStyle={{ color: "#e5e7eb" }}
          />
          {restBands.map(([start, end]) => (
            <ReferenceArea
              key={`${start}-${end}`}
              xAxisId="idx"
              x1={start}
              x2={end}
              fill="#94a3b8"
              fillOpacity={0.2}
              strokeOpacity={0}
            />
          ))}
          {trimActive && trimStart > 0 && (
            <ReferenceArea
              xAxisId="idx"
              x1={0}
              x2={trimStart}
              fill="#ef4444"
              fillOpacity={0.4}
              strokeOpacity={0}
            />
          )}
          {trimActive && trimEnd < elevationData.length - 1 && (
            <ReferenceArea
              xAxisId="idx"
              x1={trimEnd}
              x2={elevationData.length - 1}
              fill="#ef4444"
              fillOpacity={0.4}
              strokeOpacity={0}
            />
          )}
          <Line
            type="monotone"
            dataKey="elevation"
            stroke="url(#speedGradient)"
            strokeWidth={2}
            dot={false}
          />
          {/* Recharts only recognizes Reference* components as direct chart
              children, not ones nested inside a Fragment/wrapper — each must
              be its own top-level conditional expression here. */}
          {trimActive && (
            <ReferenceLine xAxisId="idx" x={trimStart} stroke="#9ca3af" strokeWidth={2} isFront />
          )}
          {trimActive && (
            <ReferenceLine
              xAxisId="idx"
              x={trimStart}
              stroke="transparent"
              strokeWidth={24}
              isFront
              style={{ cursor: "ew-resize" }}
              onMouseDown={() => setDragging("start")}
              onTouchStart={() => setDragging("start")}
            />
          )}
          {trimActive && (
            <ReferenceDot
              xAxisId="idx"
              x={trimStart}
              y={elevationMid}
              shape={TrimHandleShape}
              isFront
              style={{ cursor: "ew-resize" }}
              onMouseDown={() => setDragging("start")}
              onTouchStart={() => setDragging("start")}
            />
          )}
          {trimActive && (
            <ReferenceLine xAxisId="idx" x={trimEnd} stroke="#9ca3af" strokeWidth={2} isFront />
          )}
          {trimActive && (
            <ReferenceLine
              xAxisId="idx"
              x={trimEnd}
              stroke="transparent"
              strokeWidth={24}
              isFront
              style={{ cursor: "ew-resize" }}
              onMouseDown={() => setDragging("end")}
              onTouchStart={() => setDragging("end")}
            />
          )}
          {trimActive && (
            <ReferenceDot
              xAxisId="idx"
              x={trimEnd}
              y={elevationMid}
              shape={TrimHandleShape}
              isFront
              style={{ cursor: "ew-resize" }}
              onMouseDown={() => setDragging("end")}
              onTouchStart={() => setDragging("end")}
            />
          )}
          {hoverIndex != null && !dragging && elevationData[hoverIndex] && (
            <ReferenceDot
              xAxisId="idx"
              x={hoverIndex}
              y={elevationData[hoverIndex].elevation}
              r={5}
              fill="#2563eb"
              stroke="#fff"
              strokeWidth={2}
              isFront
              ifOverflow="visible"
            />
          )}
        </LineChart>
      </ResponsiveContainer>

      {trimActive && (
        <TrimControls
          activity={activity}
          pointCount={elevationData.length}
          trimRange={trimRange}
          onSaved={async () => {
            await refetch();
            exitEditMode();
          }}
        />
      )}

      <OutlierCleanup activity={activity} />
    </div>
  );
}
