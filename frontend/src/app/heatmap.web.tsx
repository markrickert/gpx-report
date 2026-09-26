import { Redirect } from "expo-router";
import { DEFAULT_PERSON } from "@/lib/person";

// Pre-accounts URL; pages now live under /<person>/.
export default function LegacyRoute() {
  return <Redirect href={`/${DEFAULT_PERSON}/heatmap`} />;
}
