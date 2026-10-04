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
import {
  ADD_TRIP_MANUAL_ENTRY,
  DELETE_TRIP,
  DELETE_TRIP_MANUAL_ENTRY,
  GET_TRIP,
} from "@/graphql/queries";
import { usePersonHref } from "@/lib/person";
import { activityTypeLabel } from "@/utils/activity-type-icons";
import { localDate, tripPace, tripTargetLine } from "@/utils/trip-pace";
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
        <span className="summary-label">
          {ahead ? "Ahead of" : "Behind"} {trip.weeklyTargetsMeters ? "plan" : "pace"}
        </span>
      </div>
      {!pace.isPast && (
        <>
          <div className="summary-tile">
            <span className="summary-value">
              {formatTripDistance(pace.neededThisWeekMeters ?? pace.neededPerWeekMeters, unit)}
            </span>
            <span className="summary-label">
              {pace.neededThisWeekMeters == null ? "Needed per week" : "Left this week"}
            </span>
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

  // A manual entry has a day but no time, so it lands at noon.
  const events = [
    ...trip.myActivities.map((a) => ({
      t: new Date(a.startTime).getTime(),
      meters: a.equivalentMeters,
    })),
    ...trip.myManualEntries.map((m) => ({
      t: new Date(`${m.date}T12:00:00`).getTime(),
      meters: m.distanceMeters,
    })),
  ].sort((a, b) => a.t - b.t);
  let total = 0;
  const actual = [{ t: start, value: 0 }];
  for (const event of events) {
    total += event.meters;
    actual.push({ t: event.t, value: distanceValue(total, unit) });
  }
  // Carry the line flat up to today, so a quiet week shows as one.
  const now = Math.min(Math.max(loadedAt, start), end);
  if (now > actual[actual.length - 1].t) actual.push({ t: now, value: distanceValue(total, unit) });
  const target = tripTargetLine(trip).map(({ day, meters }) => ({
    t: start + day * DAY_MS,
    value: distanceValue(meters, unit),
  }));
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
            name={trip.weeklyTargetsMeters ? "Plan" : "On pace"}
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

// Distance with no recorded track (a treadmill, a forgotten phone). It's
// entered as hiking distance already, so it counts as-is.
function ManualEntries({ trip, onChanged }) {
  const { unit } = useUnits();
  const [addEntry, { loading: adding }] = useMutation(ADD_TRIP_MANUAL_ENTRY);
  const [deleteEntry, { loading: deleting }] = useMutation(DELETE_TRIP_MANUAL_ENTRY);
  const [error, setError] = useState(null);
  const today = localDate();
  const [date, setDate] = useState(
    today < trip.startDate ? trip.startDate : today > trip.endDate ? trip.endDate : today,
  );
  const [distance, setDistance] = useState("");
  const [note, setNote] = useState("");

  const run = async (action) => {
    setError(null);
    try {
      await action();
      await onChanged();
    } catch (e) {
      setError(e.message);
    }
  };

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      await addEntry({
        variables: {
          tripId: trip.id,
          date,
          distanceMeters: Number(distance) / distanceValue(1, unit),
          note,
        },
      });
      setDistance("");
      setNote("");
    });
  };

  return (
    <section>
      <h2>Manual entries</h2>
      <p className="trip-dates">
        For distance with no recorded track. It counts toward your total as entered.
      </p>
      <form className="trip-form" onSubmit={submit}>
        <label>
          Date
          <input
            type="date"
            value={date}
            min={trip.startDate}
            max={trip.endDate}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </label>
        <label>
          Distance ({distanceUnitLabel(unit)})
          <input
            type="number"
            min="0"
            step="any"
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
            required
          />
        </label>
        <label>
          Note (optional)
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="trip-form-actions">
          <button type="submit" className="title-edit-button" disabled={adding}>
            {adding ? "Adding…" : "Add"}
          </button>
        </div>
        {error && <p className="title-edit-error">Failed: {error}</p>}
      </form>
      {trip.myManualEntries.length > 0 && (
        <div className="stats-table-wrap">
          <table className="stats-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Distance</th>
                <th>Note</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {[...trip.myManualEntries].reverse().map((m) => (
                <tr key={m.id}>
                  <td>{formatTripDate(m.date)}</td>
                  <td>{formatTripDistance(m.distanceMeters, unit)}</td>
                  <td>{m.note}</td>
                  <td>
                    <button
                      type="button"
                      className="delete-activity-button"
                      disabled={deleting}
                      onClick={() => run(() => deleteEntry({ variables: { id: m.id } }))}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function EffortFactors({ factors, countsElevation }) {
  return (
    <details className="trip-factors">
      <summary>How this is calculated</summary>
      <p>
        {countsElevation
          ? "Every activity between the two dates counts as hiking distance: its own distance, plus 8 times its elevation gain where climbing counts, times a factor for its type."
          : "Every activity between the two dates counts as hiking distance: its own distance times a factor for its type. This trip gives no extra credit for climbing."}
      </p>
      <div className="stats-table-wrap">
        <table className="stats-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Factor</th>
              {countsElevation && <th>Climbing counts</th>}
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
                {countsElevation && <td>{f.countsElevation ? "Yes" : "No"}</td>}
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
      <ManualEntries trip={trip} onChanged={refetch} />
      <EffortFactors factors={effortFactors} countsElevation={trip.countsElevation} />
      <DeleteTripSection trip={trip} />
    </div>
  );
}
