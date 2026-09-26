import { Linking } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { WebView } from "react-native-webview";
import { useTheme } from "@/hooks/use-theme";
import { apiOrigin } from "@/lib/apollo";
import { DEFAULT_PERSON, usePerson } from "@/lib/person";

// The web activity page, embedded without its nav, so the phone gets the full
// analysis, photos, and editing without a second copy of that page.
export default function ActivityRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const person = usePerson() ?? DEFAULT_PERSON;
  const colors = useTheme();
  const origin = apiOrigin();

  return (
    <WebView
      source={{ uri: `${origin}/${person}/activities/${id}?embed=1` }}
      style={{ backgroundColor: colors.background }}
      allowsInlineMediaPlayback
      // Downloads (/api/...) and other sites open in the browser instead.
      onShouldStartLoadWithRequest={(req) => {
        if (req.url.startsWith(origin) && !req.url.startsWith(`${origin}/api/`)) return true;
        void Linking.openURL(req.url);
        return false;
      }}
    />
  );
}
