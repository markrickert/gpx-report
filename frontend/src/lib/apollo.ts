import { ApolloClient, InMemoryCache, HttpLink } from "@apollo/client";

const SERVER_URL_KEY = "gpx-report-server-url";
const DEFAULT_URL = process.env.EXPO_PUBLIC_GRAPHQL_URL || "http://localhost:4000/graphql";

// The web build is served by the same server it talks to, so the baked-in
// EXPO_PUBLIC_GRAPHQL_URL is always right there. The phone app reaches the
// server over Tailscale, whose hostname can change without a rebuild, so it
// can be overridden from the native Settings screen (localStorage is
// polyfilled on native by expo-sqlite, see src/app/_layout.tsx).
export function getGraphqlUrl(): string {
  return localStorage.getItem(SERVER_URL_KEY) || DEFAULT_URL;
}

export function setGraphqlUrl(url: string) {
  if (url.trim()) localStorage.setItem(SERVER_URL_KEY, url.trim());
  else localStorage.removeItem(SERVER_URL_KEY);
  apolloClient.resetStore().catch(() => {});
}

export const apolloClient = new ApolloClient({
  link: new HttpLink({ uri: () => getGraphqlUrl() }),
  cache: new InMemoryCache(),
});

export function apiOrigin(): string {
  return getGraphqlUrl().replace(/\/graphql\/?$/, "");
}
