import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@apollo/client";
import { Stack } from "expo-router";
import { LiveTrackMap } from "@/components/live-track-map";
import { GET_ACTIVITY_SUMMARY } from "@/graphql/queries";
import { useTheme } from "@/hooks/use-theme";
import { formatDuration } from "@/utils/geo";
import { formatDistance, formatElevation, formatSpeed, useUnits } from "@/utils/units";

// Deliberately light: the full analysis (charts, trim, outliers, media) is the
// web ActivityDetail page on the big screen.
export function ActivitySummaryScreen({ id }: { id: string }) {
  const colors = useTheme();
  const { unit } = useUnits();
  const { data, error } = useQuery(GET_ACTIVITY_SUMMARY, { variables: { id } });
  const activity = data?.activity;

  if (error) return <Text style={[styles.pad, { color: "#dc2626" }]}>{error.message}</Text>;
  if (!activity) return null;

  const points = (activity.route?.coordinates ?? []).map((p: any) => ({ ...p, segment: 0 }));
  const tiles = [
    { label: "Distance", value: formatDistance(activity.distanceMeters, unit) },
    { label: "Duration", value: formatDuration(activity.durationSeconds * 1000) },
    { label: "Elevation gain", value: formatElevation(activity.totalElevationGain, unit) },
    { label: "Moving speed", value: formatSpeed(activity.movingAvgSpeedMps, unit) },
  ];

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Stack.Screen options={{ title: activity.title }} />
      <Text style={[styles.meta, { color: colors.textSecondary }]}>
        {activity.activityType} · {new Date(activity.startTime).toLocaleString()}
        {activity.locationName ? ` · ${activity.locationName}` : ""}
      </Text>
      {points.length > 0 && <LiveTrackMap points={points} follow={false} style={styles.map} />}
      <View style={styles.tiles}>
        {tiles.map((t) => (
          <View key={t.label} style={[styles.tile, { backgroundColor: colors.backgroundElement }]}>
            <Text style={[styles.value, { color: colors.text }]} selectable>
              {t.value}
            </Text>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>{t.label}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 16 },
  container: { padding: 16, gap: 16 },
  map: { height: 320, borderRadius: 12, overflow: "hidden" },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { flexGrow: 1, flexBasis: "40%", padding: 12, borderRadius: 12, borderCurve: "continuous" },
  value: { fontSize: 20, fontWeight: "600", fontVariant: ["tabular-nums"] },
  meta: { fontSize: 13 },
});
