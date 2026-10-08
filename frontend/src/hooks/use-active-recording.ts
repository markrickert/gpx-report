import { useCallback, useEffect, useRef, useState } from "react";
import { useAppActive } from "@/hooks/use-app-active";
import * as store from "@/recording/store";
import type { Recording, TrackPoint } from "@/recording/types";

// Points are written by the background location task, not by React, so the
// screen polls the store once a second and appends only rows it hasn't seen.
// The poll stops in the background and catches up on return.
export function useActiveRecording() {
  const active = useAppActive();
  const [recording, setRecording] = useState<Recording | null>(() => store.getActiveRecording());
  const [points, setPoints] = useState<TrackPoint[]>([]);
  const cursor = useRef<{ id: string | null; lastPointId: number }>({ id: null, lastPointId: 0 });

  const refresh = useCallback(() => {
    const rec = store.getActiveRecording();
    const c = cursor.current;
    const switched = (rec?.id ?? null) !== c.id;
    if (switched) cursor.current = { id: rec?.id ?? null, lastPointId: 0 };
    const fresh = rec ? store.getPoints(rec.id, cursor.current.lastPointId) : [];
    if (fresh.length) cursor.current.lastPointId = fresh[fresh.length - 1].id;
    if (switched) setPoints(fresh);
    else if (fresh.length) setPoints((prev) => [...prev, ...fresh]);
    setRecording(rec);
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    refresh();
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
  }, [refresh, active]);

  return { recording, points, refresh };
}
