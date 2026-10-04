import { useLocalSearchParams } from "expo-router";
import { TripWebView } from "@/components/trip-web-view";

export default function TripRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <TripWebView path={`/trips/${id}`} />;
}
