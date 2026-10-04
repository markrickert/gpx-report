import { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { useMutation, useQuery } from "@apollo/client";
import { GET_PEOPLE, SAVE_TRIP } from "@/graphql/queries";
import { useUnits, distanceValue, distanceUnitLabel } from "@/utils/units";
import { localDate, tripWeekCount } from "@/utils/trip-pace";
import { formatTripDate } from "@/components/trip-progress";

/** Creates a trip, or edits `trip` when given. Calls onSaved with the trip's id. */
export function TripForm({ trip = null, onSaved, onCancel }) {
  const { person } = useLocalSearchParams<{ person: string }>();
  const { unit } = useUnits();
  const { data } = useQuery(GET_PEOPLE);
  const [saveTrip, { loading }] = useMutation(SAVE_TRIP);
  const [error, setError] = useState(null);
  const [name, setName] = useState(trip?.name ?? "");
  const [startDate, setStartDate] = useState(trip?.startDate ?? localDate());
  const [endDate, setEndDate] = useState(trip?.endDate ?? "");
  const [goal, setGoal] = useState(
    trip ? String(Number(distanceValue(trip.goalMeters, unit).toFixed(1))) : "",
  );
  const [countsElevation, setCountsElevation] = useState<boolean>(trip?.countsElevation ?? true);
  const toUnit = (meters) => String(Number(distanceValue(meters, unit).toFixed(1)));
  const [planned, setPlanned] = useState(Boolean(trip?.weeklyTargetsMeters));
  const [typedWeeks, setTypedWeeks] = useState<string[]>(
    (trip?.weeklyTargetsMeters ?? []).map(toUnit),
  );
  // One box per week of the current dates, keeping whatever is already typed.
  const weekCount = startDate && endDate >= startDate ? tripWeekCount(startDate, endDate) : 0;
  const weeks = Array.from({ length: weekCount }, (_, i) => typedWeeks[i] ?? "");
  const weekTotal = weeks.reduce((sum, w) => sum + (Number(w) || 0), 0);
  const weekLabel = (i) => {
    const day = (offset) => {
      const d = new Date(`${startDate}T00:00:00`);
      d.setDate(d.getDate() + offset);
      return localDate(d);
    };
    const last = i === weekCount - 1 ? endDate : day(7 * i + 6);
    return `Week ${i + 1}: ${formatTripDate(day(7 * i))} – ${formatTripDate(last)}`;
  };
  const [participants, setParticipants] = useState<string[]>(
    trip ? trip.participants.map((p) => p.person) : [person],
  );

  const toggle = (who, checked) =>
    setParticipants(checked ? [...participants, who] : participants.filter((p) => p !== who));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const { data: saved } = await saveTrip({
        variables: {
          id: trip?.id ?? null,
          input: {
            name,
            startDate,
            endDate,
            goalMeters: (planned ? weekTotal : Number(goal)) / distanceValue(1, unit),
            countsElevation,
            weeklyTargetsMeters: planned
              ? weeks.map((w) => (Number(w) || 0) / distanceValue(1, unit))
              : null,
            participants,
          },
        },
      });
      onSaved(saved.saveTrip.id);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <form className="trip-form" onSubmit={submit}>
      <label>
        Trip name
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>
        Training starts
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          required
        />
      </label>
      <label>
        Training ends
        <input
          type="date"
          value={endDate}
          min={startDate}
          onChange={(e) => setEndDate(e.target.value)}
          required
        />
      </label>
      {planned ? (
        <label>
          Goal ({distanceUnitLabel(unit)} of hiking or walking)
          <input value={weekTotal.toFixed(1)} disabled />
        </label>
      ) : (
        <label>
          Goal ({distanceUnitLabel(unit)} of hiking or walking)
          <input
            type="number"
            min="0"
            step="any"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            required
          />
        </label>
      )}
      <fieldset className="trip-form-people trip-form-options">
        <legend>Options</legend>
        <label>
          <input
            type="checkbox"
            checked={countsElevation}
            onChange={(e) => setCountsElevation(e.target.checked)}
          />{" "}
          Give extra credit for climbing
        </label>
        <label>
          <input type="checkbox" checked={planned} onChange={(e) => setPlanned(e.target.checked)} />{" "}
          Plan it week by week
        </label>
      </fieldset>
      {planned &&
        weeks.map((value, i) => (
          <label key={i}>
            {weekLabel(i)}
            <input
              type="number"
              min="0"
              step="any"
              value={value}
              placeholder={distanceUnitLabel(unit)}
              onChange={(e) => setTypedWeeks(weeks.map((w, j) => (j === i ? e.target.value : w)))}
            />
          </label>
        ))}
      <fieldset className="trip-form-people">
        <legend>Who&apos;s training</legend>
        {(data?.people ?? []).map((who) => (
          <label key={who}>
            <input
              type="checkbox"
              checked={participants.includes(who)}
              onChange={(e) => toggle(who, e.target.checked)}
            />{" "}
            {who}
          </label>
        ))}
      </fieldset>
      <div className="trip-form-actions">
        <button type="submit" className="title-edit-button" disabled={loading}>
          {loading ? "Saving…" : "Save"}
        </button>
        <button type="button" className="title-edit-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {error && <p className="title-edit-error">Failed to save: {error}</p>}
    </form>
  );
}
