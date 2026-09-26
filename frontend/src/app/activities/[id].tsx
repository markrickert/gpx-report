import { useLocalSearchParams } from "expo-router";
import { ActivitySummaryScreen } from "@/screens/activity-summary";

export default function ActivityRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ActivitySummaryScreen id={id} />;
}
