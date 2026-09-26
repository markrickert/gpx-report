import { Redirect } from "expo-router";
import { DEFAULT_PERSON } from "@/lib/person";

// Recording is phone-only: a browser stops delivering GPS once the tab is
// backgrounded or the screen locks.
export default function LegacyRoute() {
  return <Redirect href={`/${DEFAULT_PERSON}`} />;
}
