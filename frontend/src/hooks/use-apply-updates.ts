import { useEffect } from "react";
import * as Updates from "expo-updates";
import { useAppActive } from "@/hooks/use-app-active";
import * as store from "@/recording/store";

// expo-updates only looks for an update on a cold start and only runs it on
// the start after that, so a process that lives for days never gets one.
// This looks each time the app comes to the front and restarts into a
// downloaded update right away, unless a recording is open on the screen.
export function useApplyUpdates() {
  const active = useAppActive();
  const { isUpdatePending } = Updates.useUpdates();

  useEffect(() => {
    if (!Updates.isEnabled || !active) return;
    Updates.checkForUpdateAsync()
      .then((check) => check.isAvailable && Updates.fetchUpdateAsync())
      .catch(() => {});
  }, [active]);

  useEffect(() => {
    if (isUpdatePending && active && !store.getActiveRecording()) void Updates.reloadAsync();
  }, [isUpdatePending, active]);
}
