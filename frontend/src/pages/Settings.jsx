import { useState } from "react";
import { useLazyQuery, useMutation, useQuery } from "@apollo/client";
import { Link } from "react-router-dom";
import {
  REANALYZE_ALL,
  REANALYZE_RANGE,
  GET_ACTIVITIES_WITH_OUTLIERS,
  GET_ACTIVITIES_WITH_ELEVATION_SPIKES,
  GET_ACTIVITIES_WITH_LIFT_SEGMENTS,
  GET_ACTIVITIES_FOR_EXPORT,
} from "../graphql/queries.js";
import { useNotifications } from "../notifications.jsx";
import { activityTypeLabel } from "../activityTypeIcons.js";
import { downloadCsv, downloadJson } from "../csv.js";
import { apiOrigin } from "../apolloClient.js";

const RANGE_OPTIONS = [
  { label: "Last Week", days: 7 },
  { label: "Last Month", days: 30 },
  { label: "Last Year", days: 365 },
];

// Lists activities flagged by the backend's outlier detector (see
// track/outliers.js) so the user can review/clean each one individually on
// its Activity Detail page — nothing here mutates data itself.
function OutlierList() {
  const { data, loading, error } = useQuery(GET_ACTIVITIES_WITH_OUTLIERS);

  if (loading) return <p>Scanning activities for GPS anomalies...</p>;
  if (error) return <p>Error loading GPS anomalies: {error.message}</p>;

  const activities = data.activitiesWithOutliers;
  if (activities.length === 0) {
    return <p>No GPS anomalies detected across your activities.</p>;
  }

  return (
    <ul className="outlier-activity-list">
      {activities.map((a) => (
        <li key={a.activityId}>
          <Link to={`/activities/${a.activityId}`}>{a.title}</Link>{" "}
          <span className="activity-type-badge">{activityTypeLabel(a.activityType)}</span>{" "}
          <span className="chart-hint">
            {new Date(a.startTime).toLocaleDateString()} — {a.outlierPointCount} flagged point
            {a.outlierPointCount === 1 ? "" : "s"}
          </span>
        </li>
      ))}
    </ul>
  );
}

// Lists activities flagged by the backend's elevation-spike detector (see
// track/elevationSpikes.js) so the user can preview/normalize each one
// individually on its Activity Detail page — nothing here mutates data.
function ElevationSpikeList() {
  const { data, loading, error } = useQuery(GET_ACTIVITIES_WITH_ELEVATION_SPIKES);

  if (loading) return <p>Scanning activities for elevation spikes...</p>;
  if (error) return <p>Error loading elevation spikes: {error.message}</p>;

  const activities = data.activitiesWithElevationSpikes;
  if (activities.length === 0) {
    return <p>No elevation spikes detected across your activities.</p>;
  }

  return (
    <ul className="outlier-activity-list">
      {activities.map((a) => (
        <li key={a.activityId}>
          <Link to={`/activities/${a.activityId}`}>{a.title}</Link>{" "}
          <span className="activity-type-badge">{activityTypeLabel(a.activityType)}</span>{" "}
          <span className="chart-hint">
            {new Date(a.startTime).toLocaleDateString()} — {a.spikeCount} flagged point
            {a.spikeCount === 1 ? "" : "s"}, {Math.round(a.totalElevationDeltaMeters)} m affected
          </span>
        </li>
      ))}
    </ul>
  );
}

// Lists activities where the backend's lift detector (see
// track/liftDetection.js) flagged one or more straight-line, steady-climb
// stretches that look like a chairlift/gondola ride — informational only,
// nothing here mutates data. Open the activity to see the flagged range on
// its elevation chart.
function LiftList() {
  const { data, loading, error } = useQuery(GET_ACTIVITIES_WITH_LIFT_SEGMENTS);

  if (loading) return <p>Scanning activities for lift segments...</p>;
  if (error) return <p>Error loading lift segments: {error.message}</p>;

  const activities = data.activitiesWithLiftSegments;
  if (activities.length === 0) {
    return <p>No likely lift segments detected across your activities.</p>;
  }

  return (
    <ul className="outlier-activity-list">
      {activities.map((a) => (
        <li key={a.activityId}>
          <Link to={`/activities/${a.activityId}`}>{a.title}</Link>{" "}
          <span className="activity-type-badge">{activityTypeLabel(a.activityType)}</span>{" "}
          <span className="chart-hint">
            {new Date(a.startTime).toLocaleDateString()} — {a.liftSegmentCount} segment
            {a.liftSegmentCount === 1 ? "" : "s"}, {Math.round(a.totalLiftElevationGainMeters)} m
            gained
          </span>
        </li>
      ))}
    </ul>
  );
}

// Opt-in toggle for foreground browser Notifications when the watcher
// finishes ingesting a new activity (see notifications.jsx) — gated behind
// this explicit toggle rather than prompting for permission on page load,
// per standard Notification API UX norms.
function NotificationsToggle() {
  const { supported, enabled, permission, enableNotifications, disableNotifications } =
    useNotifications();

  if (!supported) {
    return (
      <p className="chart-hint">
        This browser doesn&apos;t support notifications, so new-activity alerts aren&apos;t
        available here.
      </p>
    );
  }

  return (
    <div className="settings-section">
      <label className="settings-toggle-row">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => (e.target.checked ? enableNotifications() : disableNotifications())}
        />
        Notify me when a new activity finishes ingesting
      </label>
      {permission === "denied" && (
        <p className="chart-hint">
          Notifications are blocked for this site in your browser settings — allow them there to
          enable this.
        </p>
      )}
      <p className="chart-hint">
        Foreground-only: this checks for newly ingested activities while a tab is open, so keep one
        open in the background to get the alert.
      </p>
    </div>
  );
}

const TABS = [
  { id: "reanalysis", label: "Re-analysis" },
  { id: "outliers", label: "GPS Anomaly Cleanup" },
  { id: "elevation-spikes", label: "Elevation Spikes" },
  { id: "lifts", label: "Suspected Lift Rides" },
  { id: "export", label: "Export Data" },
];

// Raw SI-unit columns for the CSV export — deliberately not unit-converted
// or display-formatted (unlike Dashboard's CSV export) since this is meant
// for feeding into Python/Jupyter/a spreadsheet, not for reading.
const EXPORT_COLUMNS = [
  { header: "id", accessor: (a) => a.id },
  { header: "gpxFilename", accessor: (a) => a.gpxFilename },
  { header: "title", accessor: (a) => a.title },
  { header: "activityType", accessor: (a) => a.activityType },
  { header: "startTime", accessor: (a) => a.startTime },
  { header: "endTime", accessor: (a) => a.endTime },
  { header: "durationSeconds", accessor: (a) => a.durationSeconds },
  { header: "distanceMeters", accessor: (a) => a.distanceMeters },
  { header: "avgSpeedMps", accessor: (a) => a.avgSpeedMps },
  { header: "movingAvgSpeedMps", accessor: (a) => a.movingAvgSpeedMps },
  { header: "maxSpeedMps", accessor: (a) => a.maxSpeedMps },
  { header: "totalElevationGain", accessor: (a) => a.totalElevationGain },
  { header: "totalElevationLoss", accessor: (a) => a.totalElevationLoss },
  { header: "notes", accessor: (a) => a.notes },
  { header: "locationName", accessor: (a) => a.locationName },
  { header: "best1kmSeconds", accessor: (a) => a.best1kmSeconds },
  { header: "best5kmSeconds", accessor: (a) => a.best5kmSeconds },
  { header: "best10kmSeconds", accessor: (a) => a.best10kmSeconds },
];

// Fetches every activity's summary/derived columns (distance, duration,
// elevation, speeds, activity type, personal-record bests, etc) and
// downloads them as JSON or CSV — for feeding into external analysis tools
// this app doesn't support itself. Deliberately excludes per-point
// route/track data (points_data/route_geom) — that's the separate,
// not-yet-built full-backup export's job, not this one's.
function ExportTab() {
  const [status, setStatus] = useState(null);
  const [fetchActivities, { loading }] = useLazyQuery(GET_ACTIVITIES_FOR_EXPORT, {
    fetchPolicy: "network-only",
  });

  async function handleExport(format) {
    setStatus(`Fetching activities for ${format.toUpperCase()} export...`);
    const { data } = await fetchActivities();
    const activities = data.activities;
    const dateStamp = new Date().toISOString().slice(0, 10);

    if (format === "json") {
      downloadJson(`activities-export-${dateStamp}.json`, activities);
    } else {
      downloadCsv(`activities-export-${dateStamp}.csv`, activities, EXPORT_COLUMNS);
    }
    setStatus(`Downloaded ${activities.length} activities as ${format.toUpperCase()}.`);
  }

  return (
    <>
      <p className="chart-hint">
        Exports every activity&apos;s summary data — distance, duration, elevation gain/loss,
        speeds, activity type, start/end time, and personal-record bests — as JSON or CSV, for
        analysis in Python/Jupyter/a spreadsheet. This does not include per-point GPS track data;
        for a full backup (source GPX files + database), see the project TODO.
      </p>
      <div className="button-row">
        <button disabled={loading} onClick={() => handleExport("json")}>
          Download JSON
        </button>
        <button disabled={loading} onClick={() => handleExport("csv")}>
          Download CSV
        </button>
      </div>
      {status && <p>{status}</p>}

      <div className="settings-section">
        <p className="chart-hint">
          Full backup — a .zip containing every raw source file (.gpx/.igc/.skiz) from{" "}
          <code>data/gpx/</code> plus a <code>db-export.json</code> with every{" "}
          <code>activities</code>/<code>activity_routes</code> row at full fidelity (including
          per-point GPS track data and route geometry). For off-site backup or migrating to a
          different host — everything needed to fully reconstitute this app&apos;s data, unlike the
          summary-only export above.
        </p>
        <div className="button-row">
          <a className="download-link" href={`${apiOrigin}/export/full`}>
            Download Full Backup (.zip)
          </a>
        </div>
      </div>
    </>
  );
}

function ReanalysisTab() {
  const [status, setStatus] = useState(null);
  const [reanalyzeAll, { loading: loadingAll }] = useMutation(REANALYZE_ALL);
  const [reanalyzeRange, { loading: loadingRange }] = useMutation(REANALYZE_RANGE);

  async function handleReanalyzeAll() {
    setStatus("Initiating re-analysis for all activities...");
    const { data } = await reanalyzeAll();
    setStatus(data.reanalyzeAllActivities.message);
  }

  async function handleReanalyzeRange(days, label) {
    setStatus(`Initiating re-analysis for ${label}...`);
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
    const { data } = await reanalyzeRange({
      variables: { startDate: startDate.toISOString(), endDate: endDate.toISOString() },
    });
    setStatus(data.reanalyzeActivitiesByDateRange.message);
  }

  const busy = loadingAll || loadingRange;

  return (
    <>
      <div className="button-row">
        {RANGE_OPTIONS.map((opt) => (
          <button
            key={opt.label}
            disabled={busy}
            onClick={() => handleReanalyzeRange(opt.days, opt.label)}
          >
            {opt.label}
          </button>
        ))}
        <button disabled={busy} onClick={handleReanalyzeAll}>
          All Time
        </button>
      </div>
      {status && <p>{status}</p>}
    </>
  );
}

export default function Settings() {
  const [activeTab, setActiveTab] = useState(TABS[0].id);

  return (
    <div>
      <h1>Settings</h1>
      <NotificationsToggle />
      <div className="settings-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={activeTab === tab.id ? "active" : ""}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "reanalysis" && <ReanalysisTab />}

      {activeTab === "outliers" && (
        <>
          <p className="chart-hint">
            Activities with GPS points that imply an implausible speed jump (device jitter or a
            teleport glitch) — none of these are removed automatically. Open an activity below to
            compare the original vs. cleaned track on a map and decide whether to remove the flagged
            points.
          </p>
          <OutlierList />
        </>
      )}

      {activeTab === "elevation-spikes" && (
        <>
          <p className="chart-hint">
            A single point (or short run of points) whose elevation jumps sharply off trend and then
            returns — a bad altitude reading, not a GPS teleport or real terrain. Nothing is changed
            automatically; open an activity below to preview the before/after fix and decide whether
            to normalize and save it.
          </p>
          <ElevationSpikeList />
        </>
      )}

      {activeTab === "lifts" && (
        <>
          <p className="chart-hint">
            Stretches of track that look like a chairlift/gondola ride — straight-line, roughly
            constant speed, steady climb — rather than the athlete&apos;s own effort. Nothing is
            changed automatically; open an activity below to see the flagged range on its elevation
            chart.
          </p>
          <LiftList />
        </>
      )}

      {activeTab === "export" && <ExportTab />}
    </div>
  );
}
