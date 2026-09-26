import { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@apollo/client";
import { Link, useFocusEffect } from "expo-router";
import { RouteThumbnail } from "@/components/route-thumbnail";
import { GET_DASHBOARD } from "@/graphql/queries";
import { useTheme } from "@/hooks/use-theme";
import * as store from "@/recording/store";
import { drainUploadQueue, retryNow } from "@/recording/upload-queue";
import type { Recording } from "@/recording/types";
import { formatDuration } from "@/utils/geo";
import { formatDistance, useUnits } from "@/utils/units";

type ServerActivity = {
  id: string;
  title: string;
  activityType: string;
  startTime: string;
  durationSeconds: number;
  distanceMeters: number;
  routeThumbnail: number[][] | null;
};

export function HistoryScreen() {
  const colors = useTheme();
  const { unit } = useUnits();
  const { data, error, refetch } = useQuery(GET_DASHBOARD, { variables: { limit: 50 } });
  const [unsynced, setUnsynced] = useState<Recording[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadUnsynced = useCallback(
    () => setUnsynced(store.listRecordings(["pending", "failed"])),
    [],
  );

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
      renderItem={({ item }) => (
        <Link href={`/activities/${item.id}`} asChild>
          <Pressable
            style={StyleSheet.flatten([
              styles.row,
              styles.activityRow,
              { backgroundColor: colors.backgroundElement },
            ])}
          >
            <RouteThumbnail routeThumbnail={item.routeThumbnail} />
            <View style={styles.activityText}>
              <Text style={[styles.title, { color: colors.text }]}>{item.title}</Text>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>
                {item.activityType} · {new Date(item.startTime).toLocaleDateString()} ·{" "}
                {formatDistance(item.distanceMeters, unit)} ·{" "}
                {formatDuration(item.durationSeconds * 1000)}
              </Text>
            </View>
          </Pressable>
        </Link>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 8 },
  header: { gap: 8, marginBottom: 8 },
  row: { padding: 12, borderRadius: 12, borderCurve: "continuous", gap: 4 },
  activityRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  activityText: { flex: 1, gap: 4 },
  title: { fontSize: 16, fontWeight: "600" },
  meta: { fontSize: 13 },
  link: { color: "#2563eb", fontSize: 14, fontWeight: "600" },
});
