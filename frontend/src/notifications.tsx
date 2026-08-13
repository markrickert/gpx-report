import { createContext, useContext, useEffect, useRef, useState } from "react";
import { apolloClient } from "./apolloClient";
import { GET_LATEST_ACTIVITY_FOR_NOTIFY } from "./graphql/queries";

const ENABLED_KEY = "gpx-report-notify-ingest-enabled";
const LAST_SEEN_KEY = "gpx-report-notify-ingest-last-seen-id";
const POLL_INTERVAL_MS = 45000;

const NotificationsContext = createContext(null);

const supported = typeof window !== "undefined" && "Notification" in window;

// Polls for the most recently ingested activity (foreground-only — see
// docs/TODO.md) and fires a browser Notification when a new one shows up
// since the last poll. Runs as a top-level provider (mounted once in
// main.tsx) rather than inside Dashboard so it keeps working no matter which
// page is open, matching the theme/units provider pattern in this file's
// siblings (theme.tsx, units.tsx).
export function NotificationsProvider({ children }) {
  const [enabled, setEnabled] = useState(
    () => supported && localStorage.getItem(ENABLED_KEY) === "true",
  );
  const [permission, setPermission] = useState(supported ? Notification.permission : "denied");
  const lastSeenIdRef = useRef(localStorage.getItem(LAST_SEEN_KEY));

  useEffect(() => {
    if (!enabled || permission !== "granted") return undefined;

    let cancelled = false;

    async function poll() {
      try {
        const { data } = await apolloClient.query({
          query: GET_LATEST_ACTIVITY_FOR_NOTIFY,
          fetchPolicy: "network-only",
        });
        const latest = data?.activities?.[0];
        if (cancelled || !latest) return;

        const isFirstPoll = lastSeenIdRef.current === null;
        if (latest.id !== lastSeenIdRef.current) {
          lastSeenIdRef.current = latest.id;
          localStorage.setItem(LAST_SEEN_KEY, latest.id);
          // Don't fire on the first poll after enabling/reloading — that
          // would notify for an activity that was already there.
          if (!isFirstPoll) {
            new Notification(`${latest.title} ingested`);
          }
        }
      } catch {
        // Network hiccup — just try again on the next interval.
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enabled, permission]);

  async function enableNotifications() {
    if (!supported) return;
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === "granted") {
      setEnabled(true);
      localStorage.setItem(ENABLED_KEY, "true");
    }
  }

  function disableNotifications() {
    setEnabled(false);
    localStorage.setItem(ENABLED_KEY, "false");
  }

  return (
    <NotificationsContext.Provider
      value={{ supported, enabled, permission, enableNotifications, disableNotifications }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  return useContext(NotificationsContext);
}
