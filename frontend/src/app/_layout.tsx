import "expo-sqlite/localStorage/install";
import "@/recording/task";

import { ApolloProvider } from "@apollo/client";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { useColorScheme } from "react-native";
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

  return (
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
            </Stack>
          ) : (
            <OnboardingScreen />
          )}
        </ThemeProvider>
      </UnitsProvider>
    </ApolloProvider>
  );
}
