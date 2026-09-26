import { useLocalSearchParams } from "expo-router";
import { RecordScreen } from "@/screens/record";

export default function RecordRoute() {
  const { person } = useLocalSearchParams<{ person: string }>();
  return <RecordScreen person={person} />;
}
