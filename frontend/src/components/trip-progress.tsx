import { useUnits, distanceValue, distanceUnitLabel } from "@/utils/units";
import { tripPace } from "@/utils/trip-pace";

export function formatTripDistance(meters, unit) {
  return `${distanceValue(meters, unit).toFixed(1)} ${distanceUnitLabel(unit)}`;
}

/** A goal's range, or its one distance when highMeters is missing or the same. */
export function formatTripRange(lowMeters, highMeters, unit) {
  const low = distanceValue(lowMeters, unit).toFixed(1);
  const high = distanceValue(highMeters ?? lowMeters, unit).toFixed(1);
  return `${low === high ? low : `${low}–${high}`} ${distanceUnitLabel(unit)}`;
}

export function formatTripDate(date) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function myTotal(trip, person) {
  return trip.participants.find((p) => p.person === person)?.equivalentMeters ?? 0;
}

export function paceLabel(trip, totalMeters, unit) {
  const pace = tripPace({ ...trip, totalMeters });
  if (totalMeters >= trip.goalMeters) return "Goal reached";
  if (pace.isPast) {
    return `Finished ${formatTripDistance(trip.goalMeters - totalMeters, unit)} short`;
  }
  const ahead = formatTripDistance(Math.abs(pace.aheadMeters), unit);
  const line = trip.weeklyTargetsMeters ? "plan" : "pace";
  if (pace.inRange) return `On ${line}`;
  const over = trip.goalMaxMeters == null ? "ahead of" : "over";
  return pace.aheadMeters >= 0 ? `${ahead} ${over} ${line}` : `${ahead} behind ${line}`;
}

/** Where a bar's fill ends and where its low-goal mark sits, as percents of the top goal. */
export function tripBar(trip, totalMeters) {
  const top = trip.goalMaxMeters ?? trip.goalMeters;
  return {
    fill: Math.min(Math.round((totalMeters / top) * 100), 100),
    low: trip.goalMaxMeters == null ? null : (trip.goalMeters / top) * 100,
  };
}

/** One person's bar toward a trip's goal, with where they stand against the pace line. */
export function TripProgress({ trip, totalMeters, label = null }) {
  const { unit } = useUnits();
  const percent = Math.round((totalMeters / trip.goalMeters) * 100);
  const bar = tripBar(trip, totalMeters);

  return (
    <div className="trip-progress">
      <div className="trip-progress-text">
        <span>
          {label && <strong className="trip-progress-person">{label}</strong>}
          {formatTripDistance(totalMeters, unit)} of{" "}
          {formatTripRange(trip.goalMeters, trip.goalMaxMeters, unit)} ({percent}%)
        </span>
        <span className="trip-progress-pace">{paceLabel(trip, totalMeters, unit)}</span>
      </div>
      <div
        className="trip-progress-bar"
        role="progressbar"
        aria-valuenow={bar.fill}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="trip-progress-fill" style={{ width: `${bar.fill}%` }} />
        {bar.low != null && <div className="trip-progress-low" style={{ left: `${bar.low}%` }} />}
      </div>
    </div>
  );
}
