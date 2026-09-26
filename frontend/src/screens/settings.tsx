import { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as Location from "expo-location";
import { GET_SERVER_CHECK } from "@/graphql/queries";
import { useTheme } from "@/hooks/use-theme";
import { useApolloClient } from "@apollo/client";
import { getGraphqlUrl, setGraphqlUrl } from "@/lib/apollo";
import { getPerson, setPerson } from "@/lib/person";
import { drainUploadQueue } from "@/recording/upload-queue";
import { useUnits } from "@/utils/units";

export function SettingsScreen() {
  const colors = useTheme();
  const { unit, setUnit } = useUnits();
  const apolloClient = useApolloClient();
  const [url, setUrl] = useState(getGraphqlUrl);
  const [name, setName] = useState(() => getPerson() ?? "");
  const [nameSaved, setNameSaved] = useState(false);
  const [check, setCheck] = useState<string | null>(null);
  const [permission, setPermission] = useState<string>("…");

  useEffect(() => {
    Promise.all([
      Location.getForegroundPermissionsAsync(),
      Location.getBackgroundPermissionsAsync(),
    ]).then(([fg, bg]) =>
      setPermission(bg.granted ? "Always" : fg.granted ? "While using the app" : "Not granted"),
    );
  }, []);

  async function saveAndTest() {
    setGraphqlUrl(url);
    setCheck("Checking…");
    try {
      const { data } = await apolloClient.query({
        query: GET_SERVER_CHECK,
        fetchPolicy: "network-only",
      });
      setCheck(`Connected — ${data.activitySummary.totalActivities} activities on the server.`);
      void drainUploadQueue();
    } catch (err) {
      setCheck(`Couldn't connect: ${(err as Error).message}`);
    }
  }

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
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={[styles.input, text, { borderColor: colors.backgroundSelected }]}
        />
        <Pressable onPress={saveAndTest}>
          <Text style={styles.link}>Save & test connection</Text>
        </Pressable>
        {check && <Text style={[styles.meta, secondary]}>{check}</Text>}
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
});
