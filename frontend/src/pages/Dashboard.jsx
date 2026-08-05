import { useState } from "react";
import { useQuery } from "@apollo/client";
import { Link } from "react-router-dom";
import { GET_DASHBOARD } from "../graphql/queries.js";

const ACTIVITY_TYPES = ["Running", "Hiking", "Cycling", "Skiing", "Paragliding", "Walking", "Swimming"];

function formatDistance(meters) {
  return `${(meters / 1000).toFixed(2)} km`;
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function Dashboard() {
  const [activityType, setActivityType] = useState("");
  const { data, loading, error } = useQuery(GET_DASHBOARD, {
    variables: { activityType: activityType || undefined },
  });

  if (loading) return <p>Loading...</p>;
  if (error) return <p>Error loading dashboard: {error.message}</p>;

  const { activitySummary, activities } = data;

  return (
    <div>
      <section className="summary-grid">
        <div className="summary-tile">
          <span className="summary-value">{activitySummary.totalActivities}</span>
          <span className="summary-label">Activities</span>
        </div>
        <div className="summary-tile">
          <span className="summary-value">{formatDistance(activitySummary.totalDistanceMeters)}</span>
          <span className="summary-label">Total Distance</span>
        </div>
        <div className="summary-tile">
          <span className="summary-value">{formatDuration(activitySummary.totalDurationSeconds)}</span>
          <span className="summary-label">Total Duration</span>
        </div>
        <div className="summary-tile">
          <span className="summary-value">
            {activitySummary.totalElevationGainMeters?.toFixed(0) ?? 0} m
          </span>
          <span className="summary-label">Elevation Gain</span>
        </div>
      </section>

      <div className="filter-row">
        <label htmlFor="activityType">Filter by type: </label>
        <select
          id="activityType"
          value={activityType}
          onChange={(e) => setActivityType(e.target.value)}
        >
          <option value="">All</option>
          {ACTIVITY_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </div>

      <ul className="activity-list">
        {activities.map((activity) => (
          <li key={activity.id}>
            <Link to={`/activities/${activity.id}`}>
              <strong>{activity.activityType}</strong> —{" "}
              {new Date(activity.startTime).toLocaleString()} —{" "}
              {formatDistance(activity.distanceMeters)} — {formatDuration(activity.durationSeconds)}
            </Link>
          </li>
        ))}
        {activities.length === 0 && <li>No activities found.</li>}
      </ul>
    </div>
  );
}
