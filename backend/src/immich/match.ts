// Pure matching logic for the Immich media gallery integration (see
// docs/TODO.md's "Immich media gallery" entry). Kept free of any DB/HTTP
// calls so it's directly unit-testable; scan.ts wires it up against real
// activities/Immich responses.

export interface ActivityWindow {
  activityId: number;
  startTime: string | Date;
  endTime: string | Date;
}

export interface ImmichCandidateAsset {
  immichAssetId: string;
  assetType: "IMAGE" | "VIDEO";
  takenAt: string | Date;
  lat: number | null;
  lon: number | null;
  durationSeconds: number | null;
}

export interface AssignedMedia extends ImmichCandidateAsset {
  activityId: number;
}

// Does this asset's takenAt fall within [start - bufferMs, end + bufferMs]?
export function isWithinWindow(
  takenAt: string | Date,
  window: ActivityWindow,
  clockSkewBufferMs: number,
): boolean {
  const t = new Date(takenAt).getTime();
  const start = new Date(window.startTime).getTime() - clockSkewBufferMs;
  const end = new Date(window.endTime).getTime() + clockSkewBufferMs;
  return t >= start && t <= end;
}

// Time-primary matching with a geo tiebreak for photos landing in more than
// one overlapping activity's window on the same day: assign each asset to
// the single activity whose window contains it, and when multiple windows
// overlap, prefer whichever activity's route the asset's GPS is physically
// closest to (distanceMetersToRoute, precomputed by the caller via PostGIS
// ST_Distance since that's not something worth reimplementing here). An
// asset with no GPS data in an overlap simply attaches to whichever
// candidate activity started first.
export function assignMediaToActivities(
  candidatesByActivity: Map<number, ImmichCandidateAsset[]>,
  windowsByActivityId: Map<number, ActivityWindow>,
  distanceMetersToRoute: (activityId: number, lat: number, lon: number) => number | null,
): AssignedMedia[] {
  const byAsset = new Map<string, ImmichCandidateAsset & { activityIds: number[] }>();

  for (const [activityId, assets] of candidatesByActivity) {
    for (const asset of assets) {
      const existing = byAsset.get(asset.immichAssetId);
      if (existing) {
        existing.activityIds.push(activityId);
      } else {
        byAsset.set(asset.immichAssetId, { ...asset, activityIds: [activityId] });
      }
    }
  }

  const assigned: AssignedMedia[] = [];
  for (const asset of byAsset.values()) {
    let activityId: number;
    if (asset.activityIds.length === 1) {
      activityId = asset.activityIds[0];
    } else if (asset.lat != null && asset.lon != null) {
      let best = asset.activityIds[0];
      let bestDistance = Infinity;
      for (const candidateId of asset.activityIds) {
        const d = distanceMetersToRoute(candidateId, asset.lat, asset.lon);
        if (d != null && d < bestDistance) {
          bestDistance = d;
          best = candidateId;
        }
      }
      activityId = best;
    } else {
      // No GPS: attach to whichever overlapping activity started first.
      activityId = [...asset.activityIds].sort((a, b) => {
        const wa = windowsByActivityId.get(a);
        const wb = windowsByActivityId.get(b);
        return new Date(wa!.startTime).getTime() - new Date(wb!.startTime).getTime();
      })[0];
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { activityIds, ...rest } = asset;
    assigned.push({ ...rest, activityId });
  }

  return assigned;
}
