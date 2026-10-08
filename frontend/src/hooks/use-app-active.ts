import { useEffect, useState } from "react";
import { AppState } from "react-native";

// Android queues every screen update made while the app is in the background
// and applies them all when it returns, so per-second work has to stop then.
export function useAppActive() {
  const [active, setActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setActive(state === "active"),
    );
    return () => subscription.remove();
  }, []);
  return active;
}
