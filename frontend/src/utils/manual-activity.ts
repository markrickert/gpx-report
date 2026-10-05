import { distanceValue, elevationValue } from "@/utils/units";

export type ManualActivityForm = {
  /** YYYY-MM-DD, a local day. */
  date: string;
  title: string;
  activityType: string;
  /** Typed values in the person's units; an empty string means not given. */
  distance: string;
  hours: string;
  minutes: string;
  elevationGain: string;
  notes: string;
};

export function defaultManualTitle(activityType: string) {
  return activityType === "Unknown" ? "Activity" : activityType;
}

/**
 * The server's ManualActivityInput for what the person typed. A manual
 * activity has a day but no time, so it lands at local noon and never falls
 * on a neighboring date.
 */
export function manualActivityInput(form: ManualActivityForm, unit: string) {
  const seconds = (Number(form.hours) || 0) * 3600 + (Number(form.minutes) || 0) * 60;
  return {
    title: form.title.trim() || defaultManualTitle(form.activityType),
    activityType: form.activityType,
    startTime: new Date(`${form.date}T12:00:00`).toISOString(),
    distanceMeters: Number(form.distance) / distanceValue(1, unit),
    durationSeconds: seconds > 0 ? seconds : null,
    elevationGainMeters:
      form.elevationGain.trim() === ""
        ? null
        : Number(form.elevationGain) / elevationValue(1, unit),
    notes: form.notes.trim() || null,
  };
}
