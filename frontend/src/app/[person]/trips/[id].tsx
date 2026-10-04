import { Redirect } from "expo-router";

// Web-only per-person page (see the .web.tsx sibling); the phone app shows
// its own person's data from Settings instead, so a deep link lands on History.
export default function WebOnlyRoute() {
  return <Redirect href="/" />;
}
