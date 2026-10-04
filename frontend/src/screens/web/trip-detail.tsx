import { useState } from "react";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { useMutation, useQuery } from "@apollo/client";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Link } from "@/components/web-link";
import { TripForm } from "@/components/trip-form";
import {
  TripProgress,
  formatTripDate,
  formatTripDistance,
  myTotal,
} from "@/components/trip-progress";
import { DELETE_TRIP, GET_TRIP } from "@/graphql/queries";
import { usePersonHref } from "@/lib/person";
import { activityTypeLabel } from "@/utils/activity-type-icons";
import { tripPace } from "@/utils/trip-pace";
import { useUnits, distanceValue, distanceUnitLabel, formatElevation } from "@/utils/units";

const DAY_MS = 24 * 60 * 60 * 1000;

function PaceTiles({ trip, totalMeters }) {
  const { unit } = useUnits();
  const pace = tripPace({ ...trip, totalMeters });
  const ahead = pace.aheadMeters >= 0;

  return (
    <section className="summary-grid">
      <div className="summary-tile">
        <span className="summary-value">{formatTripDistance(totalMeters, unit)}</span>
        <span className="summary-label">Equivalent distance</span>
      </div>
      <div className="summary-tile">
        <span className="summary-value">
          {formatTripDistance(Math.abs(pace.aheadMeters), unit)}
        </span>
        <span className="summary-label">{ahead ? "Ahead of pace" : "Behind pace"}</span>
      </div>
      {!pace.isPast && (
        <>
          <div className="summary-tile">
            <span className="summary-value">
              {formatTripDistance(pace.neededPerWeekMeters, unit)}
            </span>
            <span className="summary-label">Needed per week</span>
          </div>
          <div className="summary-tile">
            <span className="summary-value">{pace.daysRemaining}</span>
            <span className="summary-label">
              {pace.daysRemaining === 1 ? "Day left" : "Days left"}
            </span>
          </div>
        </>
      )}
    </section>
  );
}

// The viewer's running total against the straight line to the goal.
function ProgressChart({ trip }) {
  const { unit } = useUnits();
  const [loadedAt] = useState(() => Date.now());
  const start = new Date(`${trip.startDate}T00:00:00`).getTime();
  const end = new Date(`${trip.endDate}T00:00:00`).getTime() + DAY_MS;

  let total = 0;
  const actual = [{ t: start, value: 0 }];
  for (const activity of trip.myActivities) {
    total += activity.equivalentMeters;
    actual.push({ t: new Date(activity.startTime).getTime(), value: distanceValue(total, unit) });
  }
  // Carry the line flat up to today, so a quiet week shows as one.
  const now = Math.min(Math.max(loadedAt, start), end);
  if (now > actual[actual.length - 1].t) actual.push({ t: now, value: distanceValue(total, unit) });
  const target = [
    { t: start, value: 0 },
    { t: end, value: distanceValue(trip.goalMeters, unit) },
  ];
  const formatDay = (t) =>
    new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <div className="heatmap-card">
      <h2>Progress</h2>
      <ResponsiveContainer width="100%" height={250}>
        <LineChart>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={[start, end]}
            tickFormatter={formatDay}
          />
          <YAxis
            dataKey="value"
            tickFormatter={(value) => String(Math.round(value))}
            label={{
              value: `Equivalent ${distanceUnitLabel(unit)}`,
              angle: -90,
              position: "insideLeft",
            }}
          />
          <Tooltip
            contentStyle={{ background: "rgba(17, 24, 39, 0.92)", border: "none", borderRadius: 6 }}
            labelStyle={{ color: "#e5e7eb" }}
            itemStyle={{ color: "#e5e7eb" }}
            labelFormatter={formatDay}
            formatter={(value, name) => [
              `${Number(value).toFixed(1)} ${distanceUnitLabel(unit)}`,
              name,
            ]}
          />
          <Line
            data={target}
            dataKey="value"
            name="On pace"
            stroke="var(--text-muted)"
            strokeDasharray="6 4"
            dot={false}
            isAnimationActive={false}
          />
          <Line
            data={actual}
            dataKey="value"
            name="You"
            type="stepAfter"
            stroke="var(--accent)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function ByTypeTable({ activities }) {
  const { unit } = useUnits();
  const byType = new Map();
  for (const a of activities) {
    const row = byType.get(a.activityType) ?? {
      activityType: a.activityType,
      factor: a.factor,
      count: 0,
      distanceMeters: 0,
      elevationGain: 0,
      equivalentMeters: 0,
    };
    row.count += 1;
    row.distanceMeters += a.distanceMeters;
    row.elevationGain += a.totalElevationGain ?? 0;
    row.equivalentMeters += a.equivalentMeters;
    byType.set(a.activityType, row);
  }
  const rows = [...byType.values()].sort((a, b) => b.equivalentMeters - a.equivalentMeters);

  return (
    <div className="stats-table-wrap">
      <table className="stats-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Activities</th>
            <th>Distance</th>
            <th>Elevation gain</th>
            <th>Factor</th>
            <th>Counts as</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.activityType}>
              <td>{activityTypeLabel(row.activityType)}</td>
              <td>{row.count}</td>
              <td>{formatTripDistance(row.distanceMeters, unit)}</td>
              <td>{formatElevation(row.elevationGain, unit)}</td>
              <td>× {row.factor}</td>
              <td>{formatTripDistance(row.equivalentMeters, unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ActivityTable({ activities }) {
  const { unit } = useUnits();
  const href = usePersonHref();

  return (
    <div className="stats-table-wrap">
      <table className="stats-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Activity</th>
            <th>Type</th>
            <th>Distance</th>
            <th>Elevation gain</th>
            <th>Counts as</th>
          </tr>
        </thead>
        <tbody>
          {[...activities].reverse().map((a) => (
            <tr key={a.id}>
              <td>{new Date(a.startTime).toLocaleDateString()}</td>
              <td>
                <Link to={href(`/activities/${a.id}`)}>{a.title}</Link>
              </td>
              <td>{activityTypeLabel(a.activityType)}</td>
              <td>{formatTripDistance(a.distanceMeters, unit)}</td>
              <td>{formatElevation(a.totalElevationGain, unit)}</td>
              <td>{formatTripDistance(a.equivalentMeters, unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EffortFactors({ factors }) {
  return (
    <details className="trip-factors">
      <summary>How this is calculated</summary>
      <p>
        Every activity between the two dates counts as hiking distance: its own distance, plus 8
        times its elevation gain where climbing counts, times a factor for its type.
      </p>
      <div className="stats-table-wrap">
        <table className="stats-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Factor</th>
              <th>Climbing counts</th>
            </tr>
          </thead>
          <tbody>
            {factors.map((f) => (
              <tr key={f.activityType}>
                <td>
                  {f.activityType === "Unknown"
                    ? "Unknown and anything else"
                    : activityTypeLabel(f.activityType)}
                </td>
                <td>× {f.factor}</td>
                <td>{f.countsElevation ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function DeleteTripSection({ trip }) {
  const href = usePersonHref();
  const [deleteTrip, { loading }] = useMutation(DELETE_TRIP);
  const [error, setError] = useState(null);

  const handleDelete = async () => {
    const others = trip.participants.length > 1 ? " It goes away for everyone on it." : "";
    if (!window.confirm(`Delete "${trip.name}"?${others} No activities are touched.`)) return;
    setError(null);
    try {
      await deleteTrip({ variables: { id: trip.id } });
      router.push(href("/trips") as Href);
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="delete-activity-section">
      <button className="delete-activity-button" onClick={handleDelete} disabled={loading}>
        {loading ? "Deleting…" : "Delete Trip"}
      </button>
      {error && <p className="title-edit-error">Failed to delete: {error}</p>}
    </div>
  );
}

export default function TripDetail() {
  const { id, person } = useLocalSearchParams<{ id: string; person: string }>();
  const href = usePersonHref();
  // Progress moves whenever an activity lands, so never trust the cache alone.
  const { data, error, refetch } = useQuery(GET_TRIP, {
    variables: { id },
    fetchPolicy: "cache-and-network",
  });
  const [editing, setEditing] = useState(false);

  if (error) return <p>Error loading trip: {error.message}</p>;
  if (!data) return <p>Loading...</p>;
  const { trip, effortFactors } = data;
  if (!trip) {
    return (
      <p>
        No such trip for {person}. <Link to={href("/trips")}>Back to trips</Link>
      </p>
    );
  }
  const total = myTotal(trip, person);

  return (
    <div>
      <div className="heatmap-header-row">
        <h1>{trip.name}</h1>
        {!editing && (
          <button type="button" className="title-edit-button" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
      </div>
      {editing ? (
        <TripForm
          trip={trip}
          onSaved={async () => {
            await refetch();
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <p className="trip-dates">
          {formatTripDate(trip.startDate)} – {formatTripDate(trip.endDate)}
        </p>
      )}

      <section className="trip-card">
        {trip.participants.map((p) => (
          <TripProgress
            key={p.person}
            trip={trip}
            totalMeters={p.equivalentMeters}
            label={p.person}
          />
        ))}
      </section>

      <PaceTiles trip={trip} totalMeters={total} />
      <ProgressChart trip={trip} />

      <h2>Your activities</h2>
      {trip.myActivities.length === 0 ? (
        <p>Nothing in this window yet.</p>
      ) : (
        <>
          <ByTypeTable activities={trip.myActivities} />
          <ActivityTable activities={trip.myActivities} />
        </>
      )}
      <EffortFactors factors={effortFactors} />
      <DeleteTripSection trip={trip} />
    </div>
  );
}
