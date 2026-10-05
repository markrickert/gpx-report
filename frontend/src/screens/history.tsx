import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  FlatList,
  type ImageSourcePropType,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useQuery } from "@apollo/client";
import { Link, Stack, useFocusEffect } from "expo-router";
import { unstable_getMaterialSymbolSourceAsync } from "expo-symbols";
import { RouteThumbnail } from "@/components/route-thumbnail";
import { TripsCard } from "@/components/trips-card";
import { GET_DASHBOARD } from "@/graphql/queries";
import { useTheme } from "@/hooks/use-theme";
import { DEFAULT_PERSON, usePerson } from "@/lib/person";
import { pickAndImport } from "@/recording/importer";
import * as store from "@/recording/store";
import { drainUploadQueue, retryNow } from "@/recording/upload-queue";
import type { QueuedImport, Recording } from "@/recording/types";
import { activityTypeIcon, activityTypeLabel } from "@/utils/activity-type-icons";
import { formatDistance, useUnits } from "@/utils/units";

type ServerActivity = {
  id: string;
  title: string;
  activityType: string;
  isManual: boolean;
  startTime: string;
  durationSeconds: number;
  distanceMeters: number;
  locationName: string | null;
  routeThumbnail: number[][] | null;
  mediaCount: number;
};

// Same "1h 23m" format as the web Dashboard list.
// A manual activity can have no duration, stored as zero.
function formatDuration(seconds: number) {
  if (!seconds) return null;
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
  const [imports, setImports] = useState<QueuedImport[]>([]);
  const [importing, setImporting] = useState(false);
  const person = usePerson() ?? DEFAULT_PERSON;
  // The title bar button takes an SF Symbol name on iOS but only an image on
  // Android, so the Material Symbol is rendered to one first; the button waits
  // for it rather than showing up without an icon.
  const [androidImportIcon, setAndroidImportIcon] = useState<ImageSourcePropType | null>(null);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    unstable_getMaterialSymbolSourceAsync("note_add", 24, colors.text).then(setAndroidImportIcon);
  }, [colors.text]);
  const importIcon = Platform.OS === "ios" ? "doc.badge.plus" : androidImportIcon;
  const [refreshing, setRefreshing] = useState(false);

  const loadUnsynced = useCallback(() => {
    setUnsynced(store.listRecordings(["pending", "failed"]));
    setUploaded(store.listRecordings(["uploaded"]));
    setImports(store.listImports(["pending", "failed", "rejected"]));
  }, []);

  async function importFiles() {
    setImporting(true);
    try {
      const lines = await pickAndImport(person);
      if (lines) Alert.alert("Import", lines.join("\n\n"));
    } catch (err) {
      Alert.alert("Import", `Couldn't import: ${(err as Error).message}`);
    } finally {
      setImporting(false);
      loadUnsynced();
      refetch().catch(() => {});
    }
  }

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
      <TripsCard />
      <Link href="/add-activity" asChild>
        <Pressable
          style={StyleSheet.flatten([styles.row, { backgroundColor: colors.backgroundElement }])}
        >
          <Text style={styles.link}>Add an activity by hand</Text>
        </Pressable>
      </Link>
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
      {imports.map((imp) => (
        <View key={imp.id} style={[styles.row, { backgroundColor: colors.backgroundElement }]}>
          <Text style={[styles.title, { color: colors.text }]}>{imp.name}</Text>
          <Text style={[styles.meta, { color: colors.textSecondary }]}>
            {imp.status === "pending"
              ? "Waiting to upload"
              : imp.status === "failed"
                ? `Upload failed: ${imp.lastError}`
                : `Couldn't import: ${imp.lastError}`}
          </Text>
          {imp.status === "failed" && (
            <Pressable onPress={() => retryNow(imp.id).then(loadUnsynced)}>
              <Text style={styles.link}>Retry now</Text>
            </Pressable>
          )}
          {imp.status === "rejected" && (
            <Pressable
              onPress={() => {
                store.deleteImport(imp.id);
                loadUnsynced();
              }}
            >
              <Text style={styles.link}>Dismiss</Text>
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
    <>
      {importIcon && (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon={importIcon}
            tintColor={colors.text}
            onPress={importFiles}
            disabled={importing}
            accessibilityLabel="Import a file"
          >
            Import
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      )}
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
                {item.isManual ? (
                  <View style={[styles.manualIcon, { backgroundColor: colors.backgroundSelected }]}>
                    <Text style={styles.manualIconText}>
                      {activityTypeIcon(item.activityType) ?? "✎"}
                    </Text>
                  </View>
                ) : (
                  <RouteThumbnail routeThumbnail={item.routeThumbnail} />
                )}
                <View style={styles.activityText}>
                  <Text style={[styles.title, { color: colors.text }]}>{item.title}</Text>
                  {item.isManual && (
                    <Text
                      style={[
                        styles.badge,
                        { backgroundColor: colors.backgroundSelected, color: colors.textSecondary },
                      ]}
                    >
                      Manual
                    </Text>
                  )}
                  {unknown && (
                    <Text style={[styles.badge, { backgroundColor: colors.warning }]}>
                      Needs review
                    </Text>
                  )}
                  <Text style={[styles.meta, { color: colors.textSecondary }]}>
                    {[
                      activityTypeLabel(item.activityType),
                      item.isManual
                        ? new Date(item.startTime).toLocaleDateString()
                        : new Date(item.startTime).toLocaleString(),
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
    </>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 8 },
  header: { gap: 8, marginBottom: 8 },
  row: { padding: 12, borderRadius: 12, borderCurve: "continuous", gap: 4 },
  activityRow: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1 },
  activityText: { flex: 1, gap: 2 },
  manualIcon: {
    width: 48,
    height: 48,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  manualIconText: { fontSize: 24 },
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
