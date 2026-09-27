import { useRef } from "react";
import { Linking, View } from "react-native";
import { useQuery } from "@apollo/client";
import { useLocalSearchParams } from "expo-router";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { ActivityReviewPanel } from "@/components/activity-review-panel";
import { GET_ACTIVITY_REVIEW } from "@/graphql/queries";
import { useTheme } from "@/hooks/use-theme";
import { apiOrigin } from "@/lib/apollo";
import { DEFAULT_PERSON, personSlug, usePerson } from "@/lib/person";

// The web activity page, embedded without its nav, so the phone gets the full
// analysis, photos, and editing without a second copy of that page.
export default function ActivityRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const person = usePerson() ?? DEFAULT_PERSON;
  const colors = useTheme();
  const origin = apiOrigin();
  const webView = useRef<WebView>(null);
  const insets = useSafeAreaInsets();
  const { data } = useQuery(GET_ACTIVITY_REVIEW, { variables: { id } });
  const activity = data?.activity;
  // Only the owner can edit, so a shared activity just shows.
  const needsReview = activity?.activityType === "Unknown" && activity.owner === personSlug(person);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <WebView
        ref={webView}
        source={{ uri: `${origin}/${personSlug(person)}/activities/${id}?embed=1` }}
        style={{ backgroundColor: colors.background }}
        allowsInlineMediaPlayback
        // Downloads (/api/...) and other sites open in the browser instead.
        onShouldStartLoadWithRequest={(req) => {
          if (req.url.startsWith(origin) && !req.url.startsWith(`${origin}/api/`)) return true;
          void Linking.openURL(req.url);
          return false;
        }}
      />
      {needsReview && (
        // Rides on top of the keyboard so the inputs stay visible; the bottom
        // inset is already under the keyboard, so it isn't added twice.
        <KeyboardStickyView offset={{ opened: insets.bottom }}>
          <SafeAreaView edges={["bottom"]}>
            <ActivityReviewPanel activity={activity} onSaved={() => webView.current?.reload()} />
          </SafeAreaView>
        </KeyboardStickyView>
      )}
    </View>
  );
}
