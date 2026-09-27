import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "@/hooks/use-theme";
import { ACTIVITY_TYPES } from "@/utils/activity-types";

/**
 * Activity type chips, with the `suggestions` listed first and outlined.
 * "Unknown" is left out unless `includeUnknown`, for forms that require a type.
 */
export function ActivityTypePicker({
  value,
  onChange,
  suggestions,
  includeUnknown = true,
}: {
  value: string | null;
  onChange: (type: string) => void;
  suggestions: string[];
  includeUnknown?: boolean;
}) {
  const colors = useTheme();
  const types = includeUnknown ? ACTIVITY_TYPES : ACTIVITY_TYPES.filter((t) => t !== "Unknown");
  const choices = [...suggestions, ...types.filter((t) => !suggestions.includes(t))];

  return (
    <View style={styles.chips} accessibilityRole="radiogroup">
      {choices.map((t) => (
        <Pressable
          key={t}
          accessibilityRole="radio"
          accessibilityState={{ checked: t === value }}
          onPress={() => onChange(t)}
          style={[
            styles.chip,
            {
              backgroundColor: t === value ? "#2563eb" : colors.backgroundElement,
              borderColor: suggestions.includes(t) ? "#2563eb" : "transparent",
            },
          ]}
        >
          <Text style={{ color: t === value ? "#fff" : colors.text }}>{t}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1.5 },
});
