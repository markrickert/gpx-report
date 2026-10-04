import { Redirect, useLocalSearchParams } from "expo-router";
import { DEFAULT_PERSON } from "@/lib/person";

// The phone's route; on the web, trips live under /<person>/.
export default function PhoneRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={`/${DEFAULT_PERSON}/trips/${id}`} />;
}
