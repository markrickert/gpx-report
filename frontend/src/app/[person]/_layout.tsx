import { Slot } from "expo-router";

// Every screen under /<person>/ is web-only; the native fallbacks redirect.
export default function PersonLayout() {
  return <Slot />;
}
