import { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as Location from "expo-location";
import { useTheme } from "@/hooks/use-theme";
import { getGraphqlUrl, normalizeGraphqlUrl, setGraphqlUrl } from "@/lib/apollo";
import { getPerson, setPerson } from "@/lib/person";
import { drainUploadQueue } from "@/recording/upload-queue";
import { useUnits } from "@/utils/units";

type ServerStatus =
  | { state: "idle" }
  | { state: "testing" }
  | { state: "ok"; activities: number }
  | { state: "error"; message: string };

// Tests the typed URL with a plain request instead of the Apollo client:
// saving a URL resets Apollo's store, which cancels any query in flight.
async function testServer(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "{ activitySummary { totalActivities } }" }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (body.errors?.length) throw new Error(body.errors[0].message);
    return body.data.activitySummary.totalActivities as number;
  } catch (err) {
    throw new Error(controller.signal.aborted ? "Timed out after 10 s" : (err as Error).message);
  } finally {
    clearTimeout(timeout);
  }
}

export function SettingsScreen() {
  const colors = useTheme();
  const { unit, setUnit } = useUnits();
  const [url, setUrl] = useState(getGraphqlUrl);
  const [savedUrl, setSavedUrl] = useState(getGraphqlUrl);
  const [status, setStatus] = useState<ServerStatus>({ state: "idle" });
  const [name, setName] = useState(() => getPerson() ?? "");
  const [nameSaved, setNameSaved] = useState(false);
  const [permission, setPermission] = useState<string>("…");

  useEffect(() => {
    Promise.all([
      Location.getForegroundPermissionsAsync(),
      Location.getBackgroundPermissionsAsync(),
    ]).then(([fg, bg]) =>
      setPermission(bg.granted ? "Always" : fg.granted ? "While using the app" : "Not granted"),
    );
  }, []);

  function saveUrl() {
    setGraphqlUrl(url);
    setUrl(getGraphqlUrl());
    setSavedUrl(getGraphqlUrl());
    void drainUploadQueue();
  }

  async function testAndSave() {
    setStatus({ state: "testing" });
    try {
      const activities = await testServer(normalizeGraphqlUrl(url));
      saveUrl();
      setStatus({ state: "ok", activities });
    } catch (err) {
      setStatus({ state: "error", message: (err as Error).message });
    }
  }

  const dirty = normalizeGraphqlUrl(url) !== savedUrl;

  const text = { color: colors.text };
  const secondary = { color: colors.textSecondary };

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
      contentInsetAdjustmentBehavior="automatic"
    >
      <View style={[styles.section, { backgroundColor: colors.backgroundElement }]}>
        <Text style={[styles.heading, text]}>Your name</Text>
        <Text style={[styles.meta, secondary]}>
          Your recordings upload to your own folder on the server, and History shows your activities
          plus ones shared with you.
        </Text>
        <TextInput
          value={name}
          onChangeText={(value) => {
            setName(value);
            setNameSaved(false);
          }}
          autoCapitalize="words"
          autoCorrect={false}
          placeholder="e.g. Kristin"
          style={[styles.input, text, { borderColor: colors.backgroundSelected }]}
        />
        <Pressable
          onPress={() => {
            setPerson(name);
            setNameSaved(true);
          }}
        >
          <Text style={styles.link}>Save name</Text>
        </Pressable>
        {nameSaved && <Text style={[styles.meta, secondary]}>Saved.</Text>}
      </View>

      <View style={[styles.section, { backgroundColor: colors.backgroundElement }]}>
        <Text style={[styles.heading, text]}>Server</Text>
        <Text style={[styles.meta, secondary]}>
          GraphQL URL of your gpx-report server (reachable over Tailscale).
        </Text>
        <TextInput
          value={url}
          onChangeText={(value) => {
            setUrl(value);
            setStatus({ state: "idle" });
          }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={[styles.input, text, { borderColor: colors.backgroundSelected }]}
        />
        <Pressable onPress={testAndSave} disabled={status.state === "testing"}>
          <Text style={styles.link}>Test & save</Text>
        </Pressable>
        {status.state === "idle" && dirty && (
          <Text style={[styles.meta, styles.pending]}>Unsaved changes — not tested yet.</Text>
        )}
        {status.state === "testing" && <Text style={[styles.meta, secondary]}>Testing…</Text>}
        {status.state === "ok" && (
          <Text style={[styles.meta, styles.success]}>
            {`✓ Connected and saved — ${status.activities} activities on the server.`}
          </Text>
        )}
        {status.state === "error" && (
          <>
            <Text style={[styles.meta, styles.failure]}>
              {`✗ Couldn't connect: ${status.message}. Not saved.`}
            </Text>
            <Pressable
              onPress={() => {
                saveUrl();
                setStatus({ state: "idle" });
              }}
            >
              <Text style={styles.link}>Save anyway</Text>
            </Pressable>
          </>
        )}
      </View>

      <View style={[styles.section, { backgroundColor: colors.backgroundElement }]}>
        <Text style={[styles.heading, text]}>Units</Text>
        <Pressable onPress={() => setUnit(unit === "imperial" ? "metric" : "imperial")}>
          <Text style={styles.link}>
            {unit === "imperial" ? "Imperial (mi/ft)" : "Metric (km/m)"} — tap to switch
          </Text>
        </Pressable>
      </View>

      <View style={[styles.section, { backgroundColor: colors.backgroundElement }]}>
        <Text style={[styles.heading, text]}>Location permission</Text>
        <Text style={[styles.meta, secondary]}>
          {`Currently: ${permission}. "Always" keeps recording with the screen locked.`}
        </Text>
        <Pressable onPress={() => Linking.openSettings()}>
          <Text style={styles.link}>Open system settings</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 16 },
  section: { padding: 16, borderRadius: 12, borderCurve: "continuous", gap: 8 },
  heading: { fontSize: 17, fontWeight: "600" },
  meta: { fontSize: 13 },
  input: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 15 },
  link: { color: "#2563eb", fontSize: 15, fontWeight: "600" },
  pending: { color: "#d97706" },
  success: { color: "#16a34a" },
  failure: { color: "#dc2626" },
});
