import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@apollo/client";
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from "react-leaflet";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
  ReferenceDot,
} from "recharts";
import {
  GET_ACTIVITY,
  UPDATE_ACTIVITY_TITLE,
  UPDATE_ACTIVITY_NOTES,
  UPDATE_ACTIVITY_TYPE,
  TRIM_ACTIVITY,
  GET_ACTIVITY_OUTLIER_DIFF,
  CLEAN_ACTIVITY_OUTLIERS,
  SEARCH_ACTIVITIES_FOR_COMPARE,
  DELETE_ACTIVITY,
  GET_PERSONAL_RECORDS,
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
import { activityTypeLabel } from "../activityTypeIcons.js";
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
// Records that this activity matches count as a "PR" badge — an activity
// only ever ties its own type's current best (never beats it, since the
// record itself is derived by MIN/MAX over all activities including this
// one), so equality is the right check rather than a > / < comparison.
function matchedRecords(activity, record) {
  if (!record) return [];
  const matches = [];
  if (activity.distanceMeters === record.longestDistanceMeters) matches.push("Longest Distance");
  // The record itself excludes lift-segment gain (see resolvers.js's
  // personalRecordsByType), so an activity with lift segments has to be
  // compared on the same lift-excluded basis, not its raw totalElevationGain.
  const liftGainMeters = activity.route.liftSegments.reduce(
    (sum, seg) => sum + Math.max(0, seg.elevationGainMeters),
    0,
  );
  const elevationGainForRecord =
    activity.totalElevationGain != null ? activity.totalElevationGain - liftGainMeters : null;
  if (
    elevationGainForRecord != null &&
    elevationGainForRecord === record.biggestElevationGainMeters
  ) {
    matches.push("Biggest Elevation Gain");
  }
  if (activity.best1kmSeconds != null && activity.best1kmSeconds === record.best1kmSeconds) {
    matches.push("Fastest 1km");
  }
  if (activity.best5kmSeconds != null && activity.best5kmSeconds === record.best5kmSeconds) {
    matches.push("Fastest 5km");
  }
  if (activity.best10kmSeconds != null && activity.best10kmSeconds === record.best10kmSeconds) {
    matches.push("Fastest 10km");
  }
  return matches;
}

function ActivityHeader({ activity, record, editMode, onEditModeChange }) {
  const [updateTitle] = useMutation(UPDATE_ACTIVITY_TITLE);
  const [updateType] = useMutation(UPDATE_ACTIVITY_TYPE);
  const [titleDraft, setTitleDraft] = useState(activity.title);
  const [typeDraft, setTypeDraft] = useState(activity.activityType);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  if (!editMode) {
    const records = matchedRecords(activity, record);
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
        {records.length > 0 && (
          <p>
            {records.map((label) => (
              <span className="activity-type-badge" key={label}>
                {label} PR
              </span>
            ))}
          </p>
        )}
        <p>
          <span className="activity-type-badge">{activityTypeLabel(activity.activityType)}</span>{" "}
          {new Date(activity.startTime).toLocaleString()}
          {activity.locationName && (
            <>
              {" "}
              — <span className="activity-location">{activity.locationName}</span>
            </>
          )}{" "}
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

// Freeform notes are DB-only (no source-file round-trip), so this edits
// independently of the title/type/trim edit-mode flag above and works for
// every file type, including .igc which has no writer.js equivalent.
function NotesSection({ activity }) {
  const [updateNotes] = useMutation(UPDATE_ACTIVITY_NOTES);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(activity.notes || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  if (!editing) {
    return (
      <div className="notes-section">
        {activity.notes ? (
          <p className="notes-text">{activity.notes}</p>
        ) : (
          <p className="notes-text notes-empty">No notes yet.</p>
        )}
        <button
          className="title-edit-button"
          onClick={() => {
            setDraft(activity.notes || "");
            setError(null);
            setEditing(true);
          }}
        >
          {activity.notes ? "Edit notes" : "Add notes"}
        </button>
      </div>
    );
  }

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateNotes({ variables: { id: activity.id, notes: draft.trim() } });
      setEditing(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="notes-section">
      <textarea
        className="notes-textarea"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Route conditions, how it felt, gear used..."
        rows={4}
        autoFocus
        disabled={saving}
      />
      <div className="notes-actions">
        <button onClick={save} disabled={saving}>
          Save
        </button>
        <button onClick={() => setEditing(false)} disabled={saving}>
          Cancel
        </button>
      </div>
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

// Leaflet has no per-segment line coloring either, so the route is rendered
// as many short Polylines, each colored by that stretch's average speed
// (same speedColor scale as the elevation chart's gradient, for a
// consistent read between the two). Points are grouped into chunks rather
// than one Polyline per point pair — routes can have thousands of points,
// and thousands of individual Polyline components pans/zooms noticeably
// worse than a bounded number of chunked segments. Consecutive chunks share
// their boundary point so the rendered line stays visually continuous.
const MAX_SPEED_MAP_SEGMENTS = 150;

function buildSpeedMapSegments(positions, elevationData, maxSpeedMps) {
  const n = positions.length;
  if (n < 2) return [];
  const maxSpeed = maxSpeedMps || Math.max(1, ...elevationData.map((p) => p.speedMps || 0));
  const chunkSize = Math.max(1, Math.ceil((n - 1) / MAX_SPEED_MAP_SEGMENTS));
  const segments = [];
  for (let start = 0; start < n - 1; start += chunkSize) {
    const end = Math.min(n - 1, start + chunkSize);
    const chunkSpeeds = elevationData.slice(start, end + 1).map((p) => p.speedMps ?? 0);
    const avgSpeed = chunkSpeeds.reduce((sum, s) => sum + s, 0) / chunkSpeeds.length;
    segments.push({
      positions: positions.slice(start, end + 1),
      color: speedColor(Math.min(1, avgSpeed / maxSpeed)),
    });
  }
  return segments;
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

// A few still points aren't meaningful (GPS jitter can dip under the speed
// threshold for a point or two even while moving) - only pre-crop a
// lead-in/trailing stretch if it lasted at least this long. Measured via
// point timestamps rather than a point count since recording interval
// varies by device.
const MIN_STILLNESS_DURATION_SECONDS = 30;

// Pre-positions the trim handles by walking in from each end while points
// are below REST_SPEED_THRESHOLD_MPS (the same threshold buildRestBands
// uses), then only committing to that crop if the stillness it found lasted
// long enough to be worth trimming. Falls back to the full track when
// there's nothing meaningful to crop at either end.
function suggestTrimRange(elevationData, coordinates) {
  const lastIdx = elevationData.length - 1;
  if (lastIdx < 1) return [0, lastIdx];

  let start = 0;
  while (start < lastIdx && (elevationData[start].speedMps ?? 0) < REST_SPEED_THRESHOLD_MPS) {
    start++;
  }
  const startStillSeconds =
    coordinates[0]?.timestamp != null && coordinates[start]?.timestamp != null
      ? (coordinates[start].timestamp - coordinates[0].timestamp) / 1000
      : 0;
  const suggestedStart = startStillSeconds >= MIN_STILLNESS_DURATION_SECONDS ? start : 0;

  let end = lastIdx;
  while (end > 0 && (elevationData[end].speedMps ?? 0) < REST_SPEED_THRESHOLD_MPS) {
    end--;
  }
  const endStillSeconds =
    coordinates[end]?.timestamp != null && coordinates[lastIdx]?.timestamp != null
      ? (coordinates[lastIdx].timestamp - coordinates[end].timestamp) / 1000
      : 0;
  const suggestedEnd = endStillSeconds >= MIN_STILLNESS_DURATION_SECONDS ? end : lastIdx;

  if (suggestedStart >= suggestedEnd) return [0, lastIdx];
  return [suggestedStart, suggestedEnd];
}

const MAX_GRADE_FRACTION = 0.45; // clamp: Minetti's model is only fit over roughly this range
const MIN_GRADE_WINDOW_METERS = 10; // aggregate this much horizontal distance before computing a grade

// Metabolic cost of running on a grade, normalized to flat-ground cost (1.0
// at grade 0), per Minetti et al. 2002 ("Energy cost of walking and running
// at extreme uphill and downhill slopes", J. Appl. Physiol. 93(3)). Actual
// speed * this multiplier gives the equivalent flat-ground speed for the
// same effort — the basis of grade-adjusted pace (GAP).
const FLAT_RUNNING_COST_J_PER_KG_PER_M = 3.6; // Minetti's C(0), used to normalize the polynomial to a ratio

function gradeCostMultiplier(grade) {
  const g = Math.max(-MAX_GRADE_FRACTION, Math.min(MAX_GRADE_FRACTION, grade));
  const costJPerKgPerM =
    155.4 * g ** 5 - 30.4 * g ** 4 - 43.3 * g ** 3 + 46.3 * g ** 2 + 19.5 * g + 3.6;
  return costJPerKgPerM / FLAT_RUNNING_COST_J_PER_KG_PER_M;
}

// Time-weighted average of the equivalent-flat-ground speed across the
// track, so climbs (which get a pace credit) and descents (a penalty, past
// a certain steepness) don't skew raw avg speed. Consecutive points in
// elevationProfile can be under a meter apart (dense recordings), far too
// close together for a stable grade — elevation noise of a meter or two
// would swing point-to-point grade wildly — so points are accumulated into
// windows of at least MIN_GRADE_WINDOW_METERS before grade is computed,
// while per-step time is still summed exactly within each window.
function computeGradeAdjustedSpeedMps(elevationProfile) {
  let weightedSpeedTime = 0;
  let totalTime = 0;
  let windowStart = 0;
  let windowDt = 0;
  for (let i = 1; i < elevationProfile.length; i++) {
    const prev = elevationProfile[i - 1];
    const curr = elevationProfile[i];
    const stepDist = curr.distanceMeters - prev.distanceMeters;
    const speedMps = curr.speedMps;
    if (!(stepDist > 0) || !(speedMps > 0)) continue;
    windowDt += stepDist / speedMps;

    const windowDist = curr.distanceMeters - elevationProfile[windowStart].distanceMeters;
    const isLastPoint = i === elevationProfile.length - 1;
    if (windowDist < MIN_GRADE_WINDOW_METERS && !isLastPoint) continue;
    if (!(windowDist > 0) || !(windowDt > 0)) {
      windowStart = i;
      windowDt = 0;
      continue;
    }

    const grade = (curr.elevation - elevationProfile[windowStart].elevation) / windowDist;
    const avgSpeedMps = windowDist / windowDt;
    const adjustedSpeedMps = avgSpeedMps * gradeCostMultiplier(grade);
    weightedSpeedTime += adjustedSpeedMps * windowDt;
    totalTime += windowDt;
    windowStart = i;
    windowDt = 0;
  }
  return totalTime > 0 ? weightedSpeedTime / totalTime : null;
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

// Resets pan/zoom back to the track bounds.
function ResetViewControl({ positions }) {
  const map = useMap();
  return (
    <button
      type="button"
      className="map-reset-btn"
      aria-label="Reset map view"
      title="Reset view"
      onClick={() => map.fitBounds(positions, { padding: [20, 20] })}
    >
      ⟲
    </button>
  );
}

// Lightweight search-by-title picker for choosing a second activity to
// compare against. Mirrors Dashboard's debounced search-input pattern
// rather than introducing a new one, backed by the same `activities(search)`
// query with a trimmed field selection (SEARCH_ACTIVITIES_FOR_COMPARE).
function ActivityPicker({ excludeId, onSelect, onClose }) {
  const { unit } = useUnits();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  const { data, loading } = useQuery(SEARCH_ACTIVITIES_FOR_COMPARE, {
    variables: { search: search || undefined, limit: 8 },
  });
  const results = (data?.activities ?? []).filter((a) => a.id !== excludeId);

  return (
    <div className="compare-picker">
      <input
        type="text"
        autoFocus
        placeholder="Search activities to compare..."
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
      />
      {loading && <span className="filter-loading">Searching…</span>}
      {search && !loading && results.length === 0 && (
        <p className="chart-hint">No matching activities.</p>
      )}
      {results.length > 0 && (
        <ul className="compare-picker-results">
          {results.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => onSelect(a.id)}>
                <span className="activity-list-title">{a.title}</span>
                <span className="activity-list-meta">
                  <span className="activity-type-badge">{activityTypeLabel(a.activityType)}</span>{" "}
                  {new Date(a.startTime).toLocaleDateString()} ·{" "}
                  {formatDistance(a.distanceMeters, unit)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="title-edit-button" onClick={onClose}>
        Cancel
      </button>
    </div>
  );
}

// Delta cell for the compare stats table: signs the difference and formats
// it with the same formatter used for the raw value (formatDuration takes
// no unit arg, so the extra `unit` argument is simply ignored there).
function diffLabel(primary, compare, formatFn, unit) {
  if (primary == null || compare == null) return "—";
  const delta = compare - primary;
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "±";
  return `${sign}${formatFn(Math.abs(delta), unit)}`;
}

// Additive comparison view: doesn't touch the primary elevation chart above
// (still index-based, per its own big comment on why "dist" can't key
// Reference* components). This chart uses its own two-Line overlay keyed by
// percent-of-distance-covered instead of point index, since the two
// activities being compared can have very different point counts/lengths
// and raw index alignment would badly misrepresent them.
function ComparisonSection({ activity }) {
  const { unit } = useUnits();
  const [compareId, setCompareId] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const { data } = useQuery(GET_ACTIVITY, { variables: { id: compareId }, skip: !compareId });
  const compareActivity = data?.activity;

  if (!compareId) {
    return (
      <div className="comparison-section">
        {pickerOpen ? (
          <ActivityPicker
            excludeId={activity.id}
            onSelect={(id) => {
              setCompareId(id);
              setPickerOpen(false);
            }}
            onClose={() => setPickerOpen(false)}
          />
        ) : (
          <button type="button" className="title-edit-button" onClick={() => setPickerOpen(true)}>
            Compare with another activity
          </button>
        )}
      </div>
    );
  }

  if (!compareActivity) {
    return (
      <div className="comparison-section">
        <p>Loading comparison…</p>
      </div>
    );
  }

  const totalPrimaryDist = activity.distanceMeters || 1;
  const primarySeries = activity.route.elevationProfile.map((p) => ({
    pct: (p.distanceMeters / totalPrimaryDist) * 100,
    elevation: elevationValue(p.elevation, unit),
  }));
  const totalCompareDist = compareActivity.distanceMeters || 1;
  const compareSeries = compareActivity.route.elevationProfile.map((p) => ({
    pct: (p.distanceMeters / totalCompareDist) * 100,
    elevation: elevationValue(p.elevation, unit),
  }));
  const combinedElevations = [...primarySeries, ...compareSeries].map((p) => p.elevation);
  const comparePadding = unit === "imperial" ? 30 : 10;
  const compareElevationDomain =
    combinedElevations.length > 0
      ? [
          Math.floor(Math.min(...combinedElevations) - comparePadding),
          Math.ceil(Math.max(...combinedElevations) + comparePadding),
        ]
      : [0, "auto"];

  const rows = [
    [
      "Distance",
      formatDistance(activity.distanceMeters, unit),
      formatDistance(compareActivity.distanceMeters, unit),
      diffLabel(activity.distanceMeters, compareActivity.distanceMeters, formatDistance, unit),
    ],
    [
      "Duration",
      formatDuration(activity.durationSeconds),
      formatDuration(compareActivity.durationSeconds),
      diffLabel(activity.durationSeconds, compareActivity.durationSeconds, formatDuration),
    ],
    [
      "Elevation Gain",
      formatElevation(activity.totalElevationGain, unit),
      formatElevation(compareActivity.totalElevationGain, unit),
      diffLabel(
        activity.totalElevationGain,
        compareActivity.totalElevationGain,
        formatElevation,
        unit,
      ),
    ],
    [
      "Avg Speed",
      formatSpeed(activity.avgSpeedMps, unit),
      formatSpeed(compareActivity.avgSpeedMps, unit),
      diffLabel(activity.avgSpeedMps, compareActivity.avgSpeedMps, formatSpeed, unit),
    ],
  ];

  return (
    <div className="comparison-section">
      <h2>Compare</h2>
      <div className="stats-table-wrap">
        <table className="stats-table">
          <thead>
            <tr>
              <th></th>
              <th>{activity.title}</th>
              <th>{compareActivity.title}</th>
              <th>Δ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, primary, compare, delta]) => (
              <tr key={label}>
                <td>{label}</td>
                <td>{primary}</td>
                <td>{compare}</td>
                <td>{delta}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="chart-hint">
        Elevation profiles aligned by percent of distance covered (rather than point index), since
        the two tracks may have different lengths.
      </p>
      <ResponsiveContainer width="100%" height={250} className="elevation-chart">
        <LineChart>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="pct"
            type="number"
            domain={[0, 100]}
            tickFormatter={(v) => `${Math.round(v)}%`}
            label={{ value: "Distance covered (%)", position: "insideBottom", offset: -5 }}
          />
          <YAxis
            domain={compareElevationDomain}
            tickFormatter={(v) => Math.round(v)}
            label={{
              value: `Elevation (${elevationUnitLabel(unit)})`,
              angle: -90,
              position: "insideLeft",
            }}
          />
          <Tooltip
            formatter={(v) => `${Math.round(v)} ${elevationUnitLabel(unit)}`}
            labelFormatter={(v) => `${Math.round(v)}%`}
            contentStyle={{ background: "rgba(17, 24, 39, 0.92)", border: "none", borderRadius: 6 }}
            labelStyle={{ color: "#e5e7eb" }}
            itemStyle={{ color: "#e5e7eb" }}
          />
          <Legend />
          <Line
            data={primarySeries}
            type="monotone"
            dataKey="elevation"
            name={activity.title}
            stroke="#2563eb"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            data={compareSeries}
            type="monotone"
            dataKey="elevation"
            name={compareActivity.title}
            stroke="#f97316"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>

      <p>
        <Link to={`/activities/${compareActivity.id}`}>View {compareActivity.title}</Link>{" "}
        <button type="button" className="title-edit-button" onClick={() => setCompareId(null)}>
          Remove comparison
        </button>
      </p>
    </div>
  );
}

// Permanently removes both the DB row and the source .gpx/.igc/.skiz file
// (see deleteActivity resolver) — irreversible, so this requires the same
// window.confirm guard used by the other destructive action on this page
// (OutlierCleanup's "Clean & Save").
function DeleteActivitySection({ activity }) {
  const navigate = useNavigate();
  const [deleteActivity, { loading: deleting }] = useMutation(DELETE_ACTIVITY);
  const [error, setError] = useState(null);

  const handleDelete = async () => {
    if (
      !window.confirm(
        `Delete "${activity.title}" permanently? This removes the activity and its source file and cannot be undone.`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      await deleteActivity({ variables: { id: activity.id } });
      navigate("/");
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="delete-activity-section">
      <button className="delete-activity-button" onClick={handleDelete} disabled={deleting}>
        {deleting ? "Deleting…" : "Delete Activity"}
      </button>
      {error && <p className="title-edit-error">Failed to delete: {error}</p>}
    </div>
  );
}

// similarActivities comes from a resolver-side ST_HausdorffDistance spatial
// match (see backend/src/graphql/resolvers.js), already filtered/sorted/
// capped server-side — this just hides the section entirely when empty
// rather than rendering an empty heading.
function SimilarActivitiesSection({ activity }) {
  const { unit } = useUnits();
  if (activity.similarActivities.length === 0) return null;

  return (
    <section className="on-this-day">
      <h2>Similar Past Activities</h2>
      <ul className="on-this-day-list">
        {activity.similarActivities.map((match) => (
          <li key={match.id}>
            <Link to={`/activities/${match.id}`}>
              {match.title} — {new Date(match.startTime).toLocaleDateString()} (
              {activityTypeLabel(match.activityType)}, {formatDistance(match.distanceMeters, unit)})
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function ActivityDetail() {
  const { id } = useParams();
  const { unit } = useUnits();
  const { theme } = useTheme();
  const { data, loading, error, refetch } = useQuery(GET_ACTIVITY, { variables: { id } });
  const { data: recordsData } = useQuery(GET_PERSONAL_RECORDS);
  const [editMode, setEditMode] = useState(false);
  const [trimRange, setTrimRange] = useState(null);
  const [dragging, setDragging] = useState(null); // null | "start" | "end"
  const [hoverIndex, setHoverIndex] = useState(null); // synced chart<->map hover position

  if (loading) return <p>Loading...</p>;
  if (error) return <p>Error loading activity: {error.message}</p>;
  if (!data.activity) return <p>Activity not found.</p>;

  const activity = data.activity;
  const personalRecord = recordsData?.personalRecordsByType.find(
    (r) => r.activityType === activity.activityType,
  );
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
  const gradeAdjustedSpeedMps = computeGradeAdjustedSpeedMps(activity.route.elevationProfile);
  const liftElevationGainMeters = activity.route.liftSegments.reduce(
    (sum, seg) => sum + Math.max(0, seg.elevationGainMeters),
    0,
  );
  const runCount = activity.route.liftSegments.filter((seg) => seg.elevationGainMeters > 0).length;
  const elevationGainExcludingLift =
    activity.totalElevationGain != null
      ? activity.totalElevationGain - liftElevationGainMeters
      : null;

  const [trimStart, trimEnd] = trimRange ?? [0, elevationData.length - 1];
  const trimActive = editMode && isEditable(activity) && trimRange !== null;
  const visiblePositions = trimActive ? positions.slice(trimStart, trimEnd + 1) : positions;
  const visibleElevationData = trimActive
    ? elevationData.slice(trimStart, trimEnd + 1)
    : elevationData;
  const speedMapSegments = buildSpeedMapSegments(
    visiblePositions,
    visibleElevationData,
    activity.maxSpeedMps,
  );
  const movingSpeeds = visibleElevationData
    .map((p) => p.speedMps ?? 0)
    .filter((s) => s >= REST_SPEED_THRESHOLD_MPS);
  const minMovingSpeedMps = movingSpeeds.length > 0 ? Math.min(...movingSpeeds) : 0;

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
    setTrimRange(suggestTrimRange(elevationData, activity.route.coordinates));
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
        record={personalRecord}
        editMode={editMode}
        onEditModeChange={(next) => (next ? enterEditMode() : exitEditMode())}
      />

      <NotesSection activity={activity} />

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
        {activity.movingAvgSpeedMps != null && (
          <div className="metric-tile">
            <span className="metric-icon" aria-hidden="true">
              🏃
            </span>
            <span className="metric-body">
              <span className="metric-value">{formatSpeed(activity.movingAvgSpeedMps, unit)}</span>
              <span className="metric-label">Moving Speed</span>
            </span>
          </div>
        )}
        <div className="metric-tile">
          <span className="metric-icon" aria-hidden="true">
            🚀
          </span>
          <span className="metric-body">
            <span className="metric-value">{formatSpeed(activity.maxSpeedMps, unit)}</span>
            <span className="metric-label">Max Speed</span>
          </span>
        </div>
        {gradeAdjustedSpeedMps != null && (
          <div className="metric-tile">
            <span className="metric-icon" aria-hidden="true">
              📐
            </span>
            <span className="metric-body">
              <span className="metric-value">{formatSpeed(gradeAdjustedSpeedMps, unit)}</span>
              <span className="metric-label">Grade-Adjusted Pace</span>
            </span>
          </div>
        )}
        <div className="metric-tile">
          <span className="metric-icon" aria-hidden="true">
            ⛰️
          </span>
          <span className="metric-body">
            <span className="metric-value">
              {formatElevation(
                activity.route.liftSegments.length > 0
                  ? elevationGainExcludingLift
                  : activity.totalElevationGain,
                unit,
              )}
            </span>
            <span className="metric-label">Elevation Gain</span>
          </span>
        </div>
        {runCount > 0 && (
          <div className="metric-tile">
            <span className="metric-icon" aria-hidden="true">
              🎿
            </span>
            <span className="metric-body">
              <span className="metric-value">{runCount}</span>
              <span className="metric-label">Runs</span>
            </span>
          </div>
        )}
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
          {speedMapSegments.map((segment, i) => (
            <Polyline
              key={i}
              positions={segment.positions}
              pathOptions={{ color: segment.color, weight: 4 }}
              eventHandlers={{
                mousemove: handleMapHover,
                mouseout: clearHover,
              }}
            />
          ))}
          <ResetViewControl positions={visiblePositions} />
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
      {speedMapSegments.length > 0 && (
        <div className="speed-map-legend">
          <span>{formatSpeed(minMovingSpeedMps, unit)}</span>
          <span className="speed-map-legend-bar" aria-hidden="true" />
          <span>{formatSpeed(activity.maxSpeedMps, unit)}</span>
        </div>
      )}

      <h2>Elevation Profile</h2>
      <p className="chart-hint">
        Line color shows speed (blue = fast, red = slow); gray bands mark rest stops, purple bands
        mark suspected lift rides.
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
          {activity.route.liftSegments.map((seg) => (
            <ReferenceArea
              key={`lift-${seg.startIndex}-${seg.endIndex}`}
              xAxisId="idx"
              x1={seg.startIndex}
              x2={seg.endIndex}
              fill="#a855f7"
              fillOpacity={0.25}
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

      <ComparisonSection activity={activity} />

      <SimilarActivitiesSection activity={activity} />

      <DeleteActivitySection activity={activity} />
    </div>
  );
}
