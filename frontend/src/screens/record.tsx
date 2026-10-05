import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ActivityTypePicker } from "@/components/activity-type-picker";
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
import { detectLiftSegments } from "@/recording/lift-detection";
import { suggestActivityTypes } from "@/recording/suggest-type";
import type { TrackPoint } from "@/recording/types";
import { formatDuration, trackDistanceMeters } from "@/utils/geo";
import { formatDistance, formatElevation, useUnits } from "@/utils/units";

// A stopped lift stops advancing the ride's end; keep showing it this long.
const ON_LIFT_GRACE_MS = 60_000;
const LIFT_RECHECK_POINTS = 15;
// A fix the phone rates worse than this (meters, position or altitude) counts
// as weak. A guess until recordings show what a bad stretch reports.
const WEAK_ACCURACY_METERS = 15;

function isWeakFix(p: TrackPoint) {
  return (
    (p.accuracy ?? 0) > WEAK_ACCURACY_METERS || (p.altitudeAccuracy ?? 0) > WEAK_ACCURACY_METERS
  );
}

/**
 * `person` is who the recording belongs to: the phone's Settings name, or
 * the /<person>/ of the web page. Null blocks recording until it's set.
 */
export function RecordScreen({ person }: { person: string | null }) {
  const colors = useTheme();
  const { unit } = useUnits();
  const { recording, points, refresh } = useActiveRecording();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Null until the person edits them, so the title follows the chosen type
  // and the type follows the suggestion.
  const [title, setTitle] = useState<string | null>(null);
  const [activityType, setActivityType] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const status = recording?.status ?? "idle";
  useEffect(() => {
    if (status !== "recording") return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [status]);

  const suggestions = useMemo(
    () => (status === "stopped" ? suggestActivityTypes(points).slice(0, 3) : []),
    [status, points],
  );
  const chosenType = activityType ?? suggestions[0] ?? "Unknown";
  const shownTitle = title ?? (recording ? defaultTitle(recording.startedAt, chosenType) : "");

  function resetForm() {
    setTitle(null);
    setActivityType(null);
    setNotes("");
  }

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
      if (!person) {
        setError("Set your name in Settings before recording.");
        return;
      }
      const result = await startRecording(person);
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
      const saved = await finishRecording(recording, shownTitle, chosenType, notes);
      resetForm();
      if (saved?.status === "uploaded") {
        setNote(
          "Uploaded. It'll show up in your activities once the server finishes processing it.",
        );
      } else {
        setNote(
          "Saved on this phone. It uploads automatically once the server is reachable — see History.",
        );
      }
    });

  const last = points[points.length - 1];
  // A ride takes a couple of minutes to recognize, so its distance counts
  // until then and drops out once it's detected. Detection rescans the whole
  // track, so it reruns every few points instead of on each one.
  const liftCheckpoint = Math.floor(points.length / LIFT_RECHECK_POINTS);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lifts = useMemo(() => detectLiftSegments(points), [recording?.id, liftCheckpoint]);
  const trackMeters = useMemo(() => trackDistanceMeters(points), [points]);
  const liftDistanceMeters = lifts.reduce((sum, lift) => sum + lift.distanceMeters, 0);
  const lastLift = lifts[lifts.length - 1];
  const onLift =
    status === "recording" &&
    !!lastLift &&
    last.timestamp - points[lastLift.endIndex].timestamp <= ON_LIFT_GRACE_MS;
  const formatAccuracy = (meters?: number | null) =>
    meters == null ? "-" : `±${formatElevation(meters, unit)}`;
  const tiles = [
    { label: "Duration", value: recording ? formatDuration(elapsedMs(recording, now)) : "0:00" },
    {
      label: "Distance",
      value: formatDistance(trackMeters - liftDistanceMeters, unit),
    },
    { label: "Elevation", value: last ? formatElevation(last.elevation, unit) : "-" },
    { label: "Points", value: String(points.length) },
    { label: "GPS accuracy", value: formatAccuracy(last?.accuracy) },
    { label: "Altitude accuracy", value: formatAccuracy(last?.altitudeAccuracy) },
  ];
  const weakCount = useMemo(() => points.filter(isWeakFix).length, [points]);

  return (
    // The native safe area includes the tab bar, so sizing to it (instead of
    // the scroll view's automatic inset) keeps the controls just above it.
    <SafeAreaView edges={["bottom"]} style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={styles.container} contentInsetAdjustmentBehavior="never">
        {!!error && <Text style={styles.error}>{error}</Text>}
        {note && <Text style={[styles.hint, { color: colors.textSecondary }]}>{note}</Text>}

        <View style={styles.tiles}>
          {tiles.map((t) => (
            <View
              key={t.label}
              style={[styles.tile, { backgroundColor: colors.backgroundElement }]}
            >
              <Text style={[styles.tileValue, { color: colors.text }]} selectable>
                {t.value}
              </Text>
              <Text style={[styles.tileLabel, { color: colors.textSecondary }]}>{t.label}</Text>
            </View>
          ))}
        </View>

        <LiveTrackMap points={points} follow={status === "recording"} style={styles.map} />
        {onLift && (
          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            On a lift — this ride is left out of your distance.
          </Text>
        )}
        {status === "recording" && !!last && isWeakFix(last) && (
          <Text style={styles.error}>
            Weak GPS signal — distance and elevation may be off. Give the phone a clear view of the
            sky.
          </Text>
        )}
        {status !== "recording" && weakCount > 0 && (
          <Text style={[styles.hint, { color: colors.textSecondary }]}>
            {weakCount} of {points.length} points had a weak GPS signal.
          </Text>
        )}
        {points.length === 0 && (
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
              value={shownTitle}
              onChangeText={setTitle}
              placeholderTextColor={colors.textSecondary}
              style={[styles.input, { color: colors.text, borderColor: colors.backgroundSelected }]}
            />
            <Text style={[styles.label, { color: colors.text }]}>Activity type</Text>
            {suggestions.length > 0 && (
              <Text style={[styles.hint, { color: colors.textSecondary }]}>
                Outlined types are suggested from your speed and elevation.
              </Text>
            )}
            <ActivityTypePicker
              value={chosenType}
              onChange={setActivityType}
              suggestions={suggestions}
            />
            <Text style={[styles.label, { color: colors.text }]}>Note</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="How did it go?"
              placeholderTextColor={colors.textSecondary}
              multiline
              style={[
                styles.input,
                styles.noteInput,
                { color: colors.text, borderColor: colors.backgroundSelected },
              ]}
            />
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
                label="Resume"
                color="#d97706"
                onPress={() => run(() => resumeRecording(recording))}
                disabled={busy}
              />
              <Button
                label="Discard"
                color="#6b7280"
                onPress={() =>
                  run(() => {
                    resetForm();
                    discardRecording(recording);
                  })
                }
                disabled={busy}
              />
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function defaultTitle(startedAt: number, activityType: string) {
  const hour = new Date(startedAt).getHours();
  const partOfDay =
    hour < 5
      ? "Night"
      : hour < 12
        ? "Morning"
        : hour < 17
          ? "Afternoon"
          : hour < 21
            ? "Evening"
            : "Night";
  return `${partOfDay} ${activityType === "Unknown" ? "Activity" : activityType}`;
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
  container: {
    flexGrow: 1,
    padding: 16,
    gap: 16,
    width: "100%",
    maxWidth: 800,
    alignSelf: "center",
  },
  hint: { fontSize: 14 },
  error: { color: "#dc2626", fontSize: 14 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { flexGrow: 1, flexBasis: "40%", padding: 12, borderRadius: 12, borderCurve: "continuous" },
  tileValue: { fontSize: 22, fontWeight: "600", fontVariant: ["tabular-nums"] },
  tileLabel: { fontSize: 13 },
  map: { flex: 1, minHeight: 240, borderRadius: 12, overflow: "hidden" },
  form: { gap: 8 },
  label: { fontSize: 15, fontWeight: "600" },
  input: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 16 },
  noteInput: { minHeight: 88, textAlignVertical: "top" },
  controls: { flexDirection: "row", gap: 12 },
  button: { flex: 1, paddingVertical: 16, borderRadius: 12, alignItems: "center" },
  buttonText: { color: "#fff", fontSize: 18, fontWeight: "600" },
});
