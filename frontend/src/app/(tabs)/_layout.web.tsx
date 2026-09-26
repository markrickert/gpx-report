import { Slot } from "expo-router";

// The web shell's nav lives in the root _layout.web.tsx; tabs are native-only.
export default function TabLayout() {
  return <Slot />;
}
