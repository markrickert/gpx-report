import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useMutation } from "@apollo/client";
import { ActivityTypePicker } from "@/components/activity-type-picker";
import {
  UPDATE_ACTIVITY_NOTES,
  UPDATE_ACTIVITY_TITLE,
  UPDATE_ACTIVITY_TYPE,
} from "@/graphql/queries";
import { useTheme } from "@/hooks/use-theme";

type Activity = {
  id: string;
  title: string;
  notes: string | null;
  suggestedActivityTypes: string[];
};

/**
 * Asks for the type, title, and note of an activity that needs review, below
 * the activity itself. The type is required; the title and note start from
 * what the server has.
 */
export function ActivityReviewPanel({
  activity,
  onSaved,
}: {
  activity: Activity;
  onSaved: () => void;
}) {
  const colors = useTheme();
  const [updateType] = useMutation(UPDATE_ACTIVITY_TYPE);
  const [updateTitle] = useMutation(UPDATE_ACTIVITY_TITLE);
  const [updateNotes] = useMutation(UPDATE_ACTIVITY_NOTES);
  const [activityType, setActivityType] = useState<string | null>(null);
  const [title, setTitle] = useState(activity.title);
  const [notes, setNotes] = useState(activity.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!activityType) return;
    setBusy(true);
    setError(null);
    const id = activity.id;
    try {
      // Title first: once the type is saved, the activity no longer needs
      // review and this panel goes away.
      if (title.trim() && title !== activity.title) {
        await updateTitle({ variables: { id, title: title.trim() } });
      }
      if (notes !== (activity.notes ?? "")) {
        await updateNotes({ variables: { id, notes } });
      }
      await updateType({ variables: { id, activityType } });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <View
      style={[
        styles.panel,
        { backgroundColor: colors.background, borderColor: colors.backgroundSelected },
      ]}
    >
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Text style={[styles.label, { color: colors.text }]}>What kind of activity was this?</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <ActivityTypePicker
          value={activityType}
          onChange={setActivityType}
          suggestions={activity.suggestedActivityTypes.slice(0, 3)}
          includeUnknown={false}
        />
      </ScrollView>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="Title"
        placeholderTextColor={colors.textSecondary}
        style={[styles.input, { color: colors.text, borderColor: colors.backgroundSelected }]}
      />
      <TextInput
        value={notes}
        onChangeText={setNotes}
        placeholder="Note (optional)"
        placeholderTextColor={colors.textSecondary}
        multiline
        style={[
          styles.input,
          styles.noteInput,
          { color: colors.text, borderColor: colors.backgroundSelected },
        ]}
      />
      <Pressable
        accessibilityRole="button"
        onPress={save}
        disabled={!activityType || busy}
        style={({ pressed }) => [
          styles.button,
          { opacity: !activityType || busy ? 0.5 : pressed ? 0.8 : 1 },
        ]}
      >
        <Text style={styles.buttonText}>{busy ? "Saving…" : "Save"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { padding: 12, gap: 8, borderTopWidth: 1 },
  error: { color: "#dc2626", fontSize: 14 },
  label: { fontSize: 15, fontWeight: "600" },
  input: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 16 },
  noteInput: { minHeight: 60, maxHeight: 100, textAlignVertical: "top" },
  button: {
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    backgroundColor: "#16a34a",
  },
  buttonText: { color: "#fff", fontSize: 17, fontWeight: "600" },
});
