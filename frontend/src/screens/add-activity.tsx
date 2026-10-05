import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { ActivityTypePicker } from "@/components/activity-type-picker";
import { useTheme } from "@/hooks/use-theme";
import { DEFAULT_PERSON, usePerson } from "@/lib/person";
import { queueManualActivity } from "@/recording/manual";
import { drainUploadQueue } from "@/recording/upload-queue";
import { defaultManualTitle, manualActivityInput } from "@/utils/manual-activity";
import { localDate } from "@/utils/trip-pace";
import { distanceUnitLabel, elevationUnitLabel, useUnits } from "@/utils/units";

// Adds an activity with no track. Save never needs the server: the activity
// waits in the upload queue and History shows it until it's sent.
export function AddActivityScreen() {
  const colors = useTheme();
  const router = useRouter();
  const { unit } = useUnits();
  const person = usePerson() ?? DEFAULT_PERSON;
  const [error, setError] = useState<string | null>(null);
  // Days before today: a manual activity has a day but no time.
  const [daysAgo, setDaysAgo] = useState(0);
  const [openedAt] = useState(() => Date.now());
  const [form, setForm] = useState({
    title: "",
    activityType: "Hiking",
    distance: "",
    hours: "",
    minutes: "",
    elevationGain: "",
    notes: "",
  });
  const set = (field: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [field]: value }));
  const day = new Date(openedAt);
  day.setDate(day.getDate() - daysAgo);

  function save() {
    if (!(Number(form.distance) > 0)) {
      setError("Enter a distance.");
      return;
    }
    try {
      queueManualActivity(person, manualActivityInput({ ...form, date: localDate(day) }, unit));
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    void drainUploadQueue();
    router.back();
  }

  const text = { color: colors.text };
  const secondary = { color: colors.textSecondary };
  const input = [styles.input, text, { borderColor: colors.backgroundSelected }];

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[styles.label, text]}>Date</Text>
      <View style={styles.dateRow}>
        <Pressable
          accessibilityLabel="Previous day"
          onPress={() => setDaysAgo((d) => d + 1)}
          style={[styles.step, { backgroundColor: colors.backgroundElement }]}
        >
          <Text style={[styles.stepText, text]}>‹</Text>
        </Pressable>
        <Text style={[styles.date, text]}>
          {daysAgo === 0
            ? "Today"
            : daysAgo === 1
              ? "Yesterday"
              : day.toLocaleDateString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
        </Text>
        <Pressable
          accessibilityLabel="Next day"
          onPress={() => setDaysAgo((d) => Math.max(0, d - 1))}
          disabled={daysAgo === 0}
          style={[
            styles.step,
            { backgroundColor: colors.backgroundElement, opacity: daysAgo === 0 ? 0.4 : 1 },
          ]}
        >
          <Text style={[styles.stepText, text]}>›</Text>
        </Pressable>
      </View>

      <Text style={[styles.label, text]}>{`Distance (${distanceUnitLabel(unit)})`}</Text>
      <TextInput
        value={form.distance}
        onChangeText={set("distance")}
        keyboardType="decimal-pad"
        style={input}
      />

      <Text style={[styles.label, text]}>Activity type</Text>
      <ActivityTypePicker
        value={form.activityType}
        onChange={set("activityType")}
        suggestions={[]}
      />

      <Text style={[styles.label, text]}>Title</Text>
      <TextInput
        value={form.title}
        onChangeText={set("title")}
        placeholder={defaultManualTitle(form.activityType)}
        placeholderTextColor={colors.textSecondary}
        style={input}
      />

      <Text style={[styles.label, text]}>Duration (optional)</Text>
      <View style={styles.durationRow}>
        <TextInput
          value={form.hours}
          onChangeText={set("hours")}
          keyboardType="number-pad"
          placeholder="Hours"
          placeholderTextColor={colors.textSecondary}
          style={[input, styles.duration]}
        />
        <TextInput
          value={form.minutes}
          onChangeText={set("minutes")}
          keyboardType="number-pad"
          placeholder="Minutes"
          placeholderTextColor={colors.textSecondary}
          style={[input, styles.duration]}
        />
      </View>

      <Text style={[styles.label, text]}>
        {`Elevation gain (${elevationUnitLabel(unit)}, optional)`}
      </Text>
      <TextInput
        value={form.elevationGain}
        onChangeText={set("elevationGain")}
        keyboardType="decimal-pad"
        style={input}
      />

      <Text style={[styles.label, text]}>Note (optional)</Text>
      <TextInput
        value={form.notes}
        onChangeText={set("notes")}
        multiline
        style={[input, styles.note]}
      />

      {!!error && <Text style={styles.error}>{error}</Text>}
      <Text style={[styles.hint, secondary]}>
        Saves on this phone and uploads once the server is reachable.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={save}
        style={({ pressed }) => [styles.save, { opacity: pressed ? 0.8 : 1 }]}
      >
        <Text style={styles.saveText}>Save</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 8 },
  label: { fontSize: 15, fontWeight: "600", marginTop: 8 },
  input: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 16 },
  note: { minHeight: 88, textAlignVertical: "top" },
  dateRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  step: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  stepText: { fontSize: 24, fontWeight: "600" },
  date: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "600" },
  durationRow: { flexDirection: "row", gap: 12 },
  duration: { flex: 1 },
  hint: { fontSize: 13, marginTop: 8 },
  error: { color: "#dc2626", fontSize: 14 },
  save: {
    backgroundColor: "#16a34a",
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 8,
  },
  saveText: { color: "#fff", fontSize: 18, fontWeight: "600" },
});
