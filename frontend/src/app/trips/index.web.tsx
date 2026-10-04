import { Redirect } from "expo-router";
import { DEFAULT_PERSON } from "@/lib/person";

// The phone's route; on the web, trips live under /<person>/.
export default function PhoneRoute() {
  return <Redirect href={`/${DEFAULT_PERSON}/trips`} />;
}
