import { useState } from "react";
import { useMutation } from "@apollo/client";
import { ADD_MANUAL_ACTIVITY, UPDATE_MANUAL_ACTIVITY } from "@/graphql/queries";
import { ACTIVITY_TYPES } from "@/utils/activity-types";
import { defaultManualTitle, manualActivityInput } from "@/utils/manual-activity";
import { localDate } from "@/utils/trip-pace";
import {
  useUnits,
  distanceValue,
  elevationValue,
  distanceUnitLabel,
  elevationUnitLabel,
} from "@/utils/units";

const trimmed = (value: number) => String(Number(value.toFixed(2)));

// Adds an activity with no track, or with `activity` changes one. The same
// fields either way; only the date, a distance, and a type are required.
export function ManualActivityForm({
  activity = null,
  onSaved,
  onCancel,
}: {
  activity?: any;
  onSaved: () => unknown;
  onCancel: () => void;
}) {
  const { unit } = useUnits();
  const [addActivity] = useMutation(ADD_MANUAL_ACTIVITY);
  const [updateActivity] = useMutation(UPDATE_MANUAL_ACTIVITY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(() => ({
    date: localDate(activity ? new Date(activity.startTime) : new Date()),
    // Empty follows the type until the person types a title of their own.
    title: activity?.title ?? "",
    activityType: activity?.activityType ?? "Hiking",
    distance: activity ? trimmed(distanceValue(activity.distanceMeters, unit)) : "",
    hours: activity?.durationSeconds ? String(Math.floor(activity.durationSeconds / 3600)) : "",
    minutes: activity?.durationSeconds
      ? String(Math.round((activity.durationSeconds % 3600) / 60))
      : "",
    elevationGain:
      activity?.totalElevationGain != null
        ? trimmed(elevationValue(activity.totalElevationGain, unit))
        : "",
    notes: activity?.notes ?? "",
  }));
  const set = (field: string) => (e: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [field]: e.target.value }));

  const submit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const input = manualActivityInput(form, unit);
      if (activity) await updateActivity({ variables: { id: activity.id, input } });
      else await addActivity({ variables: { input } });
      await onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="trip-form" onSubmit={submit}>
      <label>
        Date
        <input type="date" value={form.date} max={localDate()} onChange={set("date")} required />
      </label>
      <label>
        Distance ({distanceUnitLabel(unit)})
        <input
          type="number"
          min="0"
          step="any"
          value={form.distance}
          onChange={set("distance")}
          required
        />
      </label>
      <label>
        Activity type
        <select value={form.activityType} onChange={set("activityType")}>
          {ACTIVITY_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>
      <label>
        Title
        <input
          value={form.title}
          placeholder={defaultManualTitle(form.activityType)}
          onChange={set("title")}
        />
      </label>
      <label>
        Hours (optional)
        <input type="number" min="0" step="1" value={form.hours} onChange={set("hours")} />
      </label>
      <label>
        Minutes (optional)
        <input
          type="number"
          min="0"
          max="59"
          step="1"
          value={form.minutes}
          onChange={set("minutes")}
        />
      </label>
      <label>
        Elevation gain ({elevationUnitLabel(unit)}, optional)
        <input
          type="number"
          min="0"
          step="any"
          value={form.elevationGain}
          onChange={set("elevationGain")}
        />
      </label>
      <label>
        Notes (optional)
        <input value={form.notes} onChange={set("notes")} />
      </label>
      <div className="trip-form-actions">
        <button type="submit" className="title-edit-button" disabled={saving}>
          {saving ? "Saving…" : activity ? "Save" : "Add activity"}
        </button>{" "}
        <button type="button" className="title-edit-button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
      {error && <p className="title-edit-error">Failed to save: {error}</p>}
    </form>
  );
}
