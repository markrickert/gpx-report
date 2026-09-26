import { useTheme } from "@/utils/web-theme";

// On web, React Native screens (e.g. Record) follow the shell's manual
// light/dark toggle rather than only the OS setting.
export function useColorScheme() {
  return useTheme()?.theme ?? "light";
}
