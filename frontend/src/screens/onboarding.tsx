import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useTheme } from "@/hooks/use-theme";
import { getGraphqlUrl, normalizeGraphqlUrl, setGraphqlUrl } from "@/lib/apollo";
import { getPerson, setPerson } from "@/lib/person";
import { testServer } from "@/screens/settings";

type Status = { state: "idle" } | { state: "testing" } | { state: "error"; message: string };

/**
 * Shown instead of the tabs until the phone has a name and a server URL, since
 * recording and History need both.
 */
export function OnboardingScreen() {
  const colors = useTheme();
  const [name, setName] = useState(() => getPerson() ?? "");
  const [url, setUrl] = useState(getGraphqlUrl);
  const [status, setStatus] = useState<Status>({ state: "idle" });

  function finish() {
    setPerson(name);
    setGraphqlUrl(url);
  }

  async function testAndContinue() {
    setStatus({ state: "testing" });
    try {
      await testServer(normalizeGraphqlUrl(url));
      finish();
    } catch (err) {
      setStatus({ state: "error", message: (err as Error).message });
    }
  }

  const ready = name.trim() !== "" && normalizeGraphqlUrl(url) !== "";
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
      <Text style={[styles.title, text]}>Welcome to GPX Report</Text>
      <Text style={[styles.meta, secondary]}>
        Set your name and your server before you start. You can change both later in Settings.
      </Text>

      <View style={[styles.section, { backgroundColor: colors.backgroundElement }]}>
        <Text style={[styles.heading, text]}>Your name</Text>
        <Text style={[styles.meta, secondary]}>
          Your recordings upload to your own folder on the server.
        </Text>
        <TextInput
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          autoCorrect={false}
          placeholder="e.g. Kristin"
          style={input}
        />
      </View>

      <View style={[styles.section, { backgroundColor: colors.backgroundElement }]}>
        <Text style={[styles.heading, text]}>Server</Text>
        <Text style={[styles.meta, secondary]}>
          Address of your gpx-report server (reachable over Tailscale).
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
          style={input}
        />
        {status.state === "testing" && <Text style={[styles.meta, secondary]}>Testing…</Text>}
        {status.state === "error" && (
          <>
            <Text style={[styles.meta, styles.failure]}>
              {`✗ Couldn't connect: ${status.message}.`}
            </Text>
            <Pressable onPress={finish}>
              <Text style={styles.link}>Continue anyway</Text>
            </Pressable>
          </>
        )}
      </View>

      <Pressable
        onPress={testAndContinue}
        disabled={!ready || status.state === "testing"}
        style={[styles.button, { opacity: ready ? 1 : 0.4 }]}
      >
        <Text style={styles.buttonText}>Test & continue</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingTop: 32, gap: 16 },
  title: { fontSize: 28, fontWeight: "700" },
  section: { padding: 16, borderRadius: 12, borderCurve: "continuous", gap: 8 },
  heading: { fontSize: 17, fontWeight: "600" },
  meta: { fontSize: 13 },
  input: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 15 },
  link: { color: "#2563eb", fontSize: 15, fontWeight: "600" },
  failure: { color: "#dc2626" },
  button: {
    backgroundColor: "#2563eb",
    padding: 14,
    borderRadius: 12,
    borderCurve: "continuous",
    alignItems: "center",
  },
  buttonText: { color: "#ffffff", fontSize: 17, fontWeight: "600" },
});
