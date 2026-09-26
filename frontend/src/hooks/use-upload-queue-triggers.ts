import { useEffect } from "react";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { drainUploadQueue } from "@/recording/upload-queue";

// NetInfo "connected" doesn't mean the Tailscale-only server is reachable, so
// a slow timer also retries while the app is open; the queue's own backoff
// decides whether a given recording is actually due.
export function useUploadQueueTriggers() {
  useEffect(() => {
    void drainUploadQueue();
    const unsubscribeNet = NetInfo.addEventListener((state) => {
      if (state.isConnected) void drainUploadQueue();
    });
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") void drainUploadQueue();
    });
    const timer = setInterval(() => void drainUploadQueue(), 60_000);
    return () => {
      unsubscribeNet();
      appState.remove();
      clearInterval(timer);
    };
  }, []);
}
