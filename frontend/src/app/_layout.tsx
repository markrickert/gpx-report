import "expo-sqlite/localStorage/install";
import "@/recording/task";

import { ApolloProvider } from "@apollo/client";
import {
  DarkTheme,
  DefaultTheme,
  router,
  Stack,
  ThemeProvider,
  useNavigationContainerRef,
} from "expo-router";
import { useColorScheme } from "react-native";
import { type ExpoRouterLike, useAgentJet } from "react-native-agent-jet";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { useTheme } from "@/hooks/use-theme";
import { useUploadQueueTriggers } from "@/hooks/use-upload-queue-triggers";
import { apolloClient, clientFor, useHasSavedGraphqlUrl } from "@/lib/apollo";
import { usePerson } from "@/lib/person";
import { OnboardingScreen } from "@/screens/onboarding";
import { UnitsProvider } from "@/utils/units";

export default function RootLayout() {
  const scheme = useColorScheme();
  const colors = useTheme();
  const person = usePerson();
  const hasServer = useHasSavedGraphqlUrl();
  useUploadQueueTriggers();
  const navigationRef = useNavigationContainerRef();
  useAgentJet({
    navigationRef,
    router: router as ExpoRouterLike,
    appName: "gpx-report",
    // The default Android host (10.0.2.2) only reaches the Mac from an emulator; the MCP server's adb reverse makes localhost work on physical devices too.
    url: "ws://localhost:8765",
  });

  return (
    <KeyboardProvider>
      <ApolloProvider client={person ? clientFor(person) : apolloClient}>
        <UnitsProvider>
          <ThemeProvider value={scheme === "dark" ? DarkTheme : DefaultTheme}>
            {person && hasServer ? (
              <Stack>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen
                  name="activities/[id]"
                  options={{
                    title: "Activity",
                    headerBackTitle: "Back",
                    headerTintColor: colors.text,
                  }}
                />
                <Stack.Screen
                  name="trips/index"
                  options={{
                    title: "Trips",
                    headerBackTitle: "Back",
                    headerTintColor: colors.text,
                  }}
                />
                <Stack.Screen
                  name="trips/[id]"
                  options={{ title: "Trip", headerBackTitle: "Back", headerTintColor: colors.text }}
                />
              </Stack>
            ) : (
              <OnboardingScreen />
            )}
          </ThemeProvider>
        </UnitsProvider>
      </ApolloProvider>
    </KeyboardProvider>
  );
}
