import { Redirect } from "expo-router";
import { DEFAULT_PERSON } from "@/lib/person";

// On the web, a manual activity is added from the dashboard.
export default function LegacyRoute() {
  return <Redirect href={`/${DEFAULT_PERSON}`} />;
}
