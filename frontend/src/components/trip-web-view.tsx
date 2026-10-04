import { Linking } from "react-native";
import { WebView } from "react-native-webview";
import { useTheme } from "@/hooks/use-theme";
import { apiOrigin } from "@/lib/apollo";
import { DEFAULT_PERSON, personSlug, usePerson } from "@/lib/person";

/**
 * A web trips page, embedded without its nav, so the phone gets the chart,
 * the breakdown, and the forms without a second copy of those pages.
 */
export function TripWebView({ path }: { path: string }) {
  const person = usePerson() ?? DEFAULT_PERSON;
  const colors = useTheme();
  const origin = apiOrigin();

  return (
    <WebView
      source={{ uri: `${origin}/${personSlug(person)}${path}?embed=1` }}
      style={{ backgroundColor: colors.background }}
      // Links inside the page (a trip, one of its activities) stay in the page.
      allowsBackForwardNavigationGestures
      // Downloads (/api/...) and other sites open in the browser instead.
      onShouldStartLoadWithRequest={(req) => {
        if (req.url.startsWith(origin) && !req.url.startsWith(`${origin}/api/`)) return true;
        void Linking.openURL(req.url);
        return false;
      }}
    />
  );
}
