export type LiveStatus = {
  paused: boolean;
  elapsedMs: number;
  /** Formatted in the person's units. */
  distance: string;
};

// The web app does not record. The phone builds resolve the .ios and .android
// files, which have the same exports.
export function show(_status: LiveStatus) {}

export function hide() {}

export async function requestPermission() {}
