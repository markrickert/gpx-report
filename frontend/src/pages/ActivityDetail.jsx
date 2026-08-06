import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation } from "@apollo/client";
import { MapContainer, TileLayer, Polyline } from "react-leaflet";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";
import { GET_ACTIVITY, UPDATE_ACTIVITY_TITLE } from "../graphql/queries.js";
import { useUnits, formatDistance, formatElevation, formatSpeed, distanceValue, elevationValue, distanceUnitLabel, elevationUnitLabel } from "../units.jsx";

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function ActivityTitle({ activity }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(activity.title);
  const [updateTitle, { loading, error }] = useMutation(UPDATE_ACTIVITY_TITLE);

  if (!editing) {
    return (
      <h1>
        {activity.title}{" "}
        <button
          className="title-edit-button"
          onClick={() => {
            setDraft(activity.title);
            setEditing(true);
          }}
          aria-label="Edit title"
        >
          Edit
        </button>
      </h1>
    );
  }

  const save = async () => {
    const title = draft.trim();
    if (!title || title === activity.title) {
      setEditing(false);
      return;
    }
    await updateTitle({ variables: { id: activity.id, title } });
    setEditing(false);
  };

  return (
    <div className="title-edit-row">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        autoFocus
        disabled={loading}
      />
      <button onClick={save} disabled={loading}>Save</button>
      <button onClick={() => setEditing(false)} disabled={loading}>Cancel</button>
      {error && <p className="title-edit-error">Failed to save: {error.message}</p>}
    </div>
  );
}

export default function ActivityDetail() {
  const { id } = useParams();
  const { unit } = useUnits();
  const { data, loading, error } = useQuery(GET_ACTIVITY, { variables: { id } });

  if (loading) return <p>Loading...</p>;
  if (error) return <p>Error loading activity: {error.message}</p>;
  if (!data.activity) return <p>Activity not found.</p>;

  const activity = data.activity;
  const positions = activity.route.coordinates.map((p) => [p.lat, p.lon]);
  const elevationData = activity.route.elevationProfile.map((p) => ({
    dist: distanceValue(p.distanceMeters, unit).toFixed(2),
    elevation: elevationValue(p.elevation, unit),
  }));
  const elevations = elevationData.map((p) => p.elevation);
  const elevationPadding = unit === "imperial" ? 30 : 10;
  const elevationDomain =
    elevations.length > 0
      ? [Math.floor(Math.min(...elevations) - elevationPadding), Math.ceil(Math.max(...elevations) + elevationPadding)]
      : [0, "auto"];

  return (
    <div>
      <ActivityTitle activity={activity} />
      <p>
        <span className="activity-type-badge">{activity.activityType}</span>{" "}
        {new Date(activity.startTime).toLocaleString()}
      </p>

      <div className="metrics-row">
        <div>Duration: {formatDuration(activity.durationSeconds)}</div>
        <div>Distance: {formatDistance(activity.distanceMeters, unit)}</div>
        <div>Avg Speed: {formatSpeed(activity.avgSpeedMps, unit)}</div>
        <div>Max Speed: {formatSpeed(activity.maxSpeedMps, unit)}</div>
        <div>Elevation Gain: {formatElevation(activity.totalElevationGain, unit)}</div>
        <div>Elevation Loss: {formatElevation(activity.totalElevationLoss, unit)}</div>
      </div>

      {positions.length > 0 && (
        <MapContainer bounds={positions} boundsOptions={{ padding: [20, 20] }} className="activity-map">
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Polyline positions={positions} />
        </MapContainer>
      )}

      <h2>Elevation Profile</h2>
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={elevationData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="dist"
            label={{ value: `Distance (${distanceUnitLabel(unit)})`, position: "insideBottom", offset: -5 }}
          />
          <YAxis
            domain={elevationDomain}
            label={{ value: `Elevation (${elevationUnitLabel(unit)})`, angle: -90, position: "insideLeft" }}
          />
          <Tooltip />
          <Line type="monotone" dataKey="elevation" stroke="#2563eb" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
