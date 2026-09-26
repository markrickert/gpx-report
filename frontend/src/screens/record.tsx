import { useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { LiveTrackMap } from "@/components/live-track-map";
import { useActiveRecording } from "@/hooks/use-active-recording";
import { useTheme } from "@/hooks/use-theme";
import {
  discardRecording,
  elapsedMs,
  finishRecording,
  pauseRecording,
  resumeRecording,
  startRecording,
  stopRecording,
} from "@/recording/recorder";
import { ACTIVITY_TYPES } from "@/utils/activity-types";
import { formatDuration, trackDistanceMeters } from "@/utils/geo";
import { formatDistance, formatElevation, useUnits } from "@/utils/units";

export function RecordScreen() {
  const colors = useTheme();
  const { unit } = useUnits();
  const { recording, points, refresh } = useActiveRecording();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [activityType, setActivityType] = useState("Unknown");
  const [now, setNow] = useState(() => Date.now());

  const status = recording?.status ?? "idle";
  useEffect(() => {
    if (status !== "recording") return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [status]);

  async function run(action: () => Promise<unknown> | unknown) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      refresh();
      setBusy(false);
    }
  }

  const handleStart = () =>
    run(async () => {
      setNote(null);
      const result = await startRecording();
      if (result.error) setError(result.error);
      if (result.warning) setNote(result.warning);
    });

  const handleSave = () =>
    run(async () => {
      if (!recording) return;
      if (points.length < 2) {
        setError("Not enough GPS points recorded to save an activity.");
        return;
      }
      const saved = await finishRecording(recording, title, activityType);
      setTitle("");
      setActivityType("Unknown");
      if (saved?.status === "uploaded") {
        setNote(
          "Uploaded. It'll show up in your activities once the server finishes processing it.",
        );
      } else if (Platform.OS === "web") {
        setError(
          `Upload failed: ${saved?.lastError}. Keep this tab open — it retries automatically.`,
        );
      } else {
        setNote(
          "Saved on this phone. It uploads automatically once the server is reachable — see History.",
        );
      }
    });

  const last = points[points.length - 1];
  const tiles = [
    { label: "Duration", value: recording ? formatDuration(elapsedMs(recording, now)) : "0:00" },
    { label: "Distance", value: formatDistance(trackDistanceMeters(points), unit) },
    { label: "Elevation", value: last ? formatElevation(last.elevation, unit) : "-" },
    { label: "Points", value: String(points.length) },
  ];

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
      contentInsetAdjustmentBehavior="automatic"
    >
      {Platform.OS === "web" && (
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          Browser recording is foreground-only — keep this tab open and the screen on. Use the phone
          app to record with the screen locked.
        </Text>
      )}
      {error && <Text style={styles.error}>{error}</Text>}
      {note && <Text style={[styles.hint, { color: colors.textSecondary }]}>{note}</Text>}

      <View style={styles.tiles}>
        {tiles.map((t) => (
          <View key={t.label} style={[styles.tile, { backgroundColor: colors.backgroundElement }]}>
            <Text style={[styles.tileValue, { color: colors.text }]} selectable>
              {t.value}
            </Text>
            <Text style={[styles.tileLabel, { color: colors.textSecondary }]}>{t.label}</Text>
          </View>
        ))}
      </View>

      {points.length > 0 ? (
        <LiveTrackMap points={points} follow={status === "recording"} style={styles.map} />
      ) : (
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          {status === "recording"
            ? "Waiting for a GPS fix…"
            : "Start recording to see your live track."}
        </Text>
      )}

      {status === "stopped" && (
        <View style={styles.form}>
          <Text style={[styles.label, { color: colors.text }]}>Title</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder={`Recorded ${new Date().toLocaleDateString()}`}
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, { color: colors.text, borderColor: colors.backgroundSelected }]}
          />
          <Text style={[styles.label, { color: colors.text }]}>Activity type</Text>
          <View style={styles.chips}>
            {ACTIVITY_TYPES.map((t) => (
              <Pressable
                key={t}
                onPress={() => setActivityType(t)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: t === activityType ? "#2563eb" : colors.backgroundElement,
                  },
                ]}
              >
                <Text style={{ color: t === activityType ? "#fff" : colors.text }}>{t}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      <View style={styles.controls}>
        {status === "idle" && (
          <Button label="Start" color="#16a34a" onPress={handleStart} disabled={busy} />
        )}
        {status === "recording" && recording && (
          <>
            <Button
              label="Pause"
              color="#d97706"
              onPress={() => run(() => pauseRecording(recording))}
              disabled={busy}
            />
            <Button
              label="Stop"
              color="#dc2626"
              onPress={() => run(() => stopRecording(recording))}
              disabled={busy}
            />
          </>
        )}
        {status === "paused" && recording && (
          <>
            <Button
              label="Resume"
              color="#16a34a"
              onPress={() => run(() => resumeRecording(recording))}
              disabled={busy}
            />
            <Button
              label="Stop"
              color="#dc2626"
              onPress={() => run(() => stopRecording(recording))}
              disabled={busy}
            />
          </>
        )}
        {status === "stopped" && recording && (
          <>
            <Button label="Save" color="#16a34a" onPress={handleSave} disabled={busy} />
            <Button
              label="Discard"
              color="#6b7280"
              onPress={() => run(() => discardRecording(recording))}
              disabled={busy}
            />
          </>
        )}
      </View>
    </ScrollView>
  );
}

function Button({
  label,
  color,
  onPress,
  disabled,
}: {
  label: string;
  color: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: color, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
      ]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 16, width: "100%", maxWidth: 800, alignSelf: "center" },
  hint: { fontSize: 14 },
  error: { color: "#dc2626", fontSize: 14 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { flexGrow: 1, flexBasis: "40%", padding: 12, borderRadius: 12, borderCurve: "continuous" },
  tileValue: { fontSize: 22, fontWeight: "600", fontVariant: ["tabular-nums"] },
  tileLabel: { fontSize: 13 },
  map: { height: 360, borderRadius: 12, overflow: "hidden" },
  form: { gap: 8 },
  label: { fontSize: 15, fontWeight: "600" },
  input: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16 },
  controls: { flexDirection: "row", gap: 12 },
  button: { flex: 1, paddingVertical: 16, borderRadius: 12, alignItems: "center" },
  buttonText: { color: "#fff", fontSize: 18, fontWeight: "600" },
});
