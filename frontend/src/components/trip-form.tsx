import { useState } from "react";
import { useLocalSearchParams } from "expo-router";
import { useMutation, useQuery } from "@apollo/client";
import { GET_PEOPLE, SAVE_TRIP } from "@/graphql/queries";
import { useUnits, distanceValue, distanceUnitLabel } from "@/utils/units";
import { localDate } from "@/utils/trip-pace";

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
            goalMeters: Number(goal) / distanceValue(1, unit),
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
