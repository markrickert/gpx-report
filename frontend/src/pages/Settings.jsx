import { useState } from "react";
import { useMutation, useQuery } from "@apollo/client";
import { Link } from "react-router-dom";
import {
  REANALYZE_ALL,
  REANALYZE_RANGE,
  GET_ACTIVITIES_WITH_OUTLIERS,
  GET_ACTIVITIES_WITH_ELEVATION_SPIKES,
  GET_ACTIVITIES_WITH_LIFT_SEGMENTS,
} from "../graphql/queries.js";
import { useNotifications } from "../notifications.jsx";
import { activityTypeLabel } from "../activityTypeIcons.js";

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
];

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
    </div>
  );
}
