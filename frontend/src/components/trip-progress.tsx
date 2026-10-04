import { useUnits, distanceValue, distanceUnitLabel } from "@/utils/units";
import { tripPace } from "@/utils/trip-pace";

export function formatTripDistance(meters, unit) {
  return `${distanceValue(meters, unit).toFixed(1)} ${distanceUnitLabel(unit)}`;
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
  return pace.aheadMeters >= 0 ? `${ahead} ahead of pace` : `${ahead} behind pace`;
}

/** One person's bar toward a trip's goal, with where they stand against the pace line. */
export function TripProgress({ trip, totalMeters, label = null }) {
  const { unit } = useUnits();
  const percent = Math.round((totalMeters / trip.goalMeters) * 100);

  return (
    <div className="trip-progress">
      <div className="trip-progress-text">
        <span>
          {label && <strong className="trip-progress-person">{label}</strong>}
          {formatTripDistance(totalMeters, unit)} of {formatTripDistance(trip.goalMeters, unit)} (
          {percent}%)
        </span>
        <span className="trip-progress-pace">{paceLabel(trip, totalMeters, unit)}</span>
      </div>
      <div
        className="trip-progress-bar"
        role="progressbar"
        aria-valuenow={Math.min(percent, 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="trip-progress-fill" style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>
    </div>
  );
}
