import { useParams } from "react-router-dom";
import { useQuery } from "@apollo/client";
import { MapContainer, TileLayer, Polyline } from "react-leaflet";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";
import { GET_ACTIVITY } from "../graphql/queries.js";

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function ActivityDetail() {
  const { id } = useParams();
  const { data, loading, error } = useQuery(GET_ACTIVITY, { variables: { id } });

  if (loading) return <p>Loading...</p>;
  if (error) return <p>Error loading activity: {error.message}</p>;
  if (!data.activity) return <p>Activity not found.</p>;

  const activity = data.activity;
  const positions = activity.route.coordinates.map((p) => [p.lat, p.lon]);
  const elevationData = activity.route.elevationProfile.map((p) => ({
    km: (p.distanceMeters / 1000).toFixed(2),
    elevation: p.elevation,
  }));

  return (
    <div>
      <h1>{activity.activityType}</h1>
      <p>{new Date(activity.startTime).toLocaleString()}</p>

      <div className="metrics-row">
        <div>Duration: {formatDuration(activity.durationSeconds)}</div>
        <div>Distance: {(activity.distanceMeters / 1000).toFixed(2)} km</div>
        <div>Avg Speed: {activity.avgSpeedMps ? `${(activity.avgSpeedMps * 3.6).toFixed(1)} km/h` : "-"}</div>
        <div>Max Speed: {activity.maxSpeedMps ? `${(activity.maxSpeedMps * 3.6).toFixed(1)} km/h` : "-"}</div>
        <div>Elevation Gain: {activity.totalElevationGain?.toFixed(0) ?? "-"} m</div>
        <div>Elevation Loss: {activity.totalElevationLoss?.toFixed(0) ?? "-"} m</div>
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
          <XAxis dataKey="km" label={{ value: "Distance (km)", position: "insideBottom", offset: -5 }} />
          <YAxis label={{ value: "Elevation (m)", angle: -90, position: "insideLeft" }} />
          <Tooltip />
          <Line type="monotone" dataKey="elevation" stroke="#2563eb" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
