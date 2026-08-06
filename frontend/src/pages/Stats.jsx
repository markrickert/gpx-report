import { useQuery } from "@apollo/client";
import { GET_STATS_BY_TYPE } from "../graphql/queries.js";
import { useUnits, formatDistance, formatElevation } from "../units.jsx";

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function Stats() {
  const { unit } = useUnits();
  const { data, loading, error } = useQuery(GET_STATS_BY_TYPE);

  if (loading) return <p>Loading...</p>;
  if (error) return <p>Error loading stats: {error.message}</p>;

  const stats = data.aggregatedStatsByType;

  return (
    <div>
      <h1>Stats by Activity Type</h1>
      {stats.length === 0 ? (
        <p>No activities yet.</p>
      ) : (
        <div className="stats-table-wrap">
          <table className="stats-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Count</th>
                <th>Total Distance</th>
                <th>Total Duration</th>
                <th>Avg Distance</th>
                <th>Avg Duration</th>
                <th>Avg Elevation Gain</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((row) => (
                <tr key={row.activityType}>
                  <td>{row.activityType}</td>
                  <td>{row.count}</td>
                  <td>{formatDistance(row.totalDistanceMeters, unit)}</td>
                  <td>{formatDuration(row.totalDurationSeconds)}</td>
                  <td>{formatDistance(row.averageDistanceMeters, unit)}</td>
                  <td>{formatDuration(row.averageDurationSeconds)}</td>
                  <td>{formatElevation(row.averageElevationGainMeters, unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
