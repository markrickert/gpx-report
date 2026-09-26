import { Redirect } from "expo-router";

// Web-only analysis page (see the .web.tsx sibling); the phone app has no
// equivalent, so a deep link lands on History instead.
export default function WebOnlyRoute() {
  return <Redirect href="/" />;
}
