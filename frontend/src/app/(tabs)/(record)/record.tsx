import { usePerson } from "@/lib/person";
import { RecordScreen } from "@/screens/record";

export default function RecordRoute() {
  return <RecordScreen person={usePerson()} />;
}
