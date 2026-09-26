import "expo-sqlite/localStorage/install";
import "@/recording/task";

import { ApolloProvider } from "@apollo/client";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from "expo-router";
import { useColorScheme } from "react-native";
import { useUploadQueueTriggers } from "@/hooks/use-upload-queue-triggers";
import { apolloClient } from "@/lib/apollo";
import { UnitsProvider } from "@/utils/units";

export default function RootLayout() {
  const scheme = useColorScheme();
  useUploadQueueTriggers();

  return (
    <ApolloProvider client={apolloClient}>
      <UnitsProvider>
        <ThemeProvider value={scheme === "dark" ? DarkTheme : DefaultTheme}>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="activities/[id]" options={{ title: "Activity" }} />
          </Stack>
        </ThemeProvider>
      </UnitsProvider>
    </ApolloProvider>
  );
}
