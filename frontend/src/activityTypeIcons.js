// Best-effort emoji per activityType, shown next to the type badge wherever
// it's rendered. Keyed on the exact strings produced by the backend
// (ACTIVITY_TYPES in activityTypes.js, plus "Skiing"/"Downhill Skiing" —
// guessed/`.skiz`-derived values that aren't in the frontend's preselected
// dropdown list but do show up on real activities). Falls back to no icon
// for anything else (custom/unmapped raw types, "Unknown") rather than
// guessing with a generic symbol.
const ACTIVITY_TYPE_ICONS = {
  Running: "🏃",
  Hiking: "🥾",
  Walking: "🚶",
  Cycling: "🚴",
  "Mountain Biking": "🚵",
  "E-Mountain Bike Ride": "🚵",
  "Alpine Skiing": "⛷️",
  Skiing: "⛷️",
  "Downhill Skiing": "⛷️",
  Paragliding: "🪂",
  Swimming: "🏊",
  Kayaking: "🛶",
};

export function activityTypeIcon(activityType) {
  return ACTIVITY_TYPE_ICONS[activityType] ?? null;
}

// "🥾 Hiking", or just "Hiking" when there's no icon for this type.
export function activityTypeLabel(activityType) {
  const icon = activityTypeIcon(activityType);
  return icon ? `${icon} ${activityType}` : activityType;
}
