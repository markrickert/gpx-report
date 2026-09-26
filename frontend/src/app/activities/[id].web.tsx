import { Redirect, useLocalSearchParams } from "expo-router";
import { DEFAULT_PERSON } from "@/lib/person";

// Pre-accounts URL; pages now live under /<person>/.
export default function LegacyRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={`/${DEFAULT_PERSON}/activities/${id}`} />;
}
