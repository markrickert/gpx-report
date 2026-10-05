import { Stack } from "expo-router/stack";

const titles: Record<string, string> = {
  index: "History",
  "add-activity": "Add activity",
  record: "Record",
  settings: "Settings",
};

// Each tab has its own Stack so its screen gets a native title bar.
export function TabStack() {
  return (
    <Stack
      screenOptions={({ route }) => ({
        title: titles[route.name],
        headerLargeTitleEnabled: route.name !== "record" && route.name !== "add-activity",
      })}
    />
  );
}
