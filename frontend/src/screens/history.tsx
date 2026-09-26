import { useCallback, useState } from "react";
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@apollo/client";
import { Link, useFocusEffect } from "expo-router";
import { RouteThumbnail } from "@/components/route-thumbnail";
import { GET_DASHBOARD } from "@/graphql/queries";
import { useTheme } from "@/hooks/use-theme";
import * as store from "@/recording/store";
import { drainUploadQueue, retryNow } from "@/recording/upload-queue";
import type { Recording } from "@/recording/types";
import { activityTypeLabel } from "@/utils/activity-type-icons";
import { formatDistance, useUnits } from "@/utils/units";

type ServerActivity = {
  id: string;
  title: string;
  activityType: string;
  startTime: string;
  durationSeconds: number;
  distanceMeters: number;
  locationName: string | null;
  routeThumbnail: number[][] | null;
  mediaCount: number;
};

// Same "1h 23m" format as the web Dashboard list.
function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function HistoryScreen() {
  const colors = useTheme();
  const { unit } = useUnits();
  const { data, error, refetch } = useQuery(GET_DASHBOARD, { variables: { limit: 50 } });
  const [unsynced, setUnsynced] = useState<Recording[]>([]);
  const [uploaded, setUploaded] = useState<Recording[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadUnsynced = useCallback(() => {
    setUnsynced(store.listRecordings(["pending", "failed"]));
    setUploaded(store.listRecordings(["uploaded"]));
  }, []);

  // The server has the file (and backs up the original before any edit), so
  // the phone's copy is only a safety net until the user clears it.
  function removeUploaded() {
    Alert.alert(
      "Remove from this phone?",
      "These recordings are already on the server. Recordings that haven't uploaded yet stay.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            for (const rec of store.listRecordings(["uploaded"])) store.deleteRecording(rec.id);
            loadUnsynced();
          },
        },
      ],
    );
  }

  useFocusEffect(
    useCallback(() => {
      loadUnsynced();
      const timer = setInterval(loadUnsynced, 2000);
      return () => clearInterval(timer);
    }, [loadUnsynced]),
  );

  async function onRefresh() {
    setRefreshing(true);
    await drainUploadQueue();
    loadUnsynced();
    await refetch().catch(() => {});
    setRefreshing(false);
  }

  const header = (
    <View style={styles.header}>
      {error && (
        <Text style={[styles.meta, { color: colors.textSecondary }]}>
          {`Can't reach the server (${error.message}). Recordings stay on this phone until it's back.`}
        </Text>
      )}
      {unsynced.map((rec) => (
        <View key={rec.id} style={[styles.row, { backgroundColor: colors.backgroundElement }]}>
          <Text style={[styles.title, { color: colors.text }]}>{rec.title}</Text>
          <Text style={[styles.meta, { color: colors.textSecondary }]}>
            {rec.status === "pending" ? "Waiting to upload" : `Upload failed: ${rec.lastError}`}
          </Text>
          {rec.status === "failed" && (
            <Pressable onPress={() => retryNow(rec.id).then(loadUnsynced)}>
              <Text style={styles.link}>Retry now</Text>
            </Pressable>
          )}
        </View>
      ))}
      {uploaded.length > 0 && (
        <View style={[styles.row, { backgroundColor: colors.backgroundElement }]}>
          <Text style={[styles.meta, { color: colors.textSecondary }]}>
            {`${uploaded.length} uploaded ${uploaded.length === 1 ? "recording is" : "recordings are"} still saved on this phone. ${uploaded.length === 1 ? "It's" : "They're"} on the server now.`}
          </Text>
          <Pressable onPress={removeUploaded}>
            <Text style={styles.link}>Remove from phone</Text>
          </Pressable>
        </View>
      )}
    </View>
  );

  return (
    <FlatList<ServerActivity>
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.list}
      contentInsetAdjustmentBehavior="automatic"
      data={data?.activities ?? []}
      keyExtractor={(a) => a.id}
      ListHeaderComponent={header}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      renderItem={({ item }) => {
        const unknown = item.activityType === "Unknown";
        return (
          <Link href={`/activities/${item.id}`} asChild>
            <Pressable
              style={StyleSheet.flatten([
                styles.row,
                styles.activityRow,
                unknown
                  ? { backgroundColor: colors.warningSoft, borderColor: colors.warning }
                  : { backgroundColor: colors.backgroundElement, borderColor: colors.border },
              ])}
            >
              <RouteThumbnail routeThumbnail={item.routeThumbnail} />
              <View style={styles.activityText}>
                <Text style={[styles.title, { color: colors.text }]}>{item.title}</Text>
                {unknown && (
                  <Text style={[styles.badge, { backgroundColor: colors.warning }]}>
                    Needs review
                  </Text>
                )}
                <Text style={[styles.meta, { color: colors.textSecondary }]}>
                  {[
                    activityTypeLabel(item.activityType),
                    new Date(item.startTime).toLocaleString(),
                    formatDistance(item.distanceMeters, unit),
                    formatDuration(item.durationSeconds),
                    item.locationName,
                    item.mediaCount > 0 && `📷 ${item.mediaCount}`,
                  ]
                    .filter(Boolean)
                    .join(" — ")}
                </Text>
              </View>
            </Pressable>
          </Link>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 8 },
  header: { gap: 8, marginBottom: 8 },
  row: { padding: 12, borderRadius: 12, borderCurve: "continuous", gap: 4 },
  activityRow: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1 },
  activityText: { flex: 1, gap: 2 },
  badge: {
    alignSelf: "flex-start",
    color: "white",
    fontSize: 12,
    fontWeight: "600",
    paddingHorizontal: 8,
    paddingVertical: 1,
    borderRadius: 999,
    overflow: "hidden",
  },
  title: { fontSize: 16, fontWeight: "600" },
  meta: { fontSize: 13 },
  link: { color: "#2563eb", fontSize: 14, fontWeight: "600" },
});
