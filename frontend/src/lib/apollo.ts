import { ApolloClient, InMemoryCache, HttpLink } from "@apollo/client";
import { Platform } from "react-native";

const SERVER_URL_KEY = "gpx-report-server-url";
const DEFAULT_URL =
  process.env.EXPO_PUBLIC_GRAPHQL_URL ||
  (Platform.OS === "web" ? "/graphql" : "http://localhost:4000/graphql");

// The production web build is served by the same site that proxies /graphql
// and /api to the backend, so it calls itself. The phone app reaches the
// server over Tailscale, whose hostname can change without a rebuild, so it
// can be overridden from the native Settings screen (localStorage is
// polyfilled on native by expo-sqlite, see src/app/_layout.tsx).
export function getGraphqlUrl(): string {
  return localStorage.getItem(SERVER_URL_KEY) || DEFAULT_URL;
}

/** Accepts a bare server address and adds the /graphql path it's missing. */
export function normalizeGraphqlUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed || /\/graphql$/.test(trimmed)) return trimmed;
  return `${trimmed}/graphql`;
}

export function setGraphqlUrl(url: string) {
  url = normalizeGraphqlUrl(url);
  if (url) localStorage.setItem(SERVER_URL_KEY, url);
  else localStorage.removeItem(SERVER_URL_KEY);
  for (const client of [apolloClient, ...clients.values()]) client.resetStore().catch(() => {});
}

/**
 * No X-GPX-Person header, so the server treats it as its default person.
 * Used where no person applies (web people picker).
 */
export const apolloClient = new ApolloClient({
  link: new HttpLink({ uri: () => getGraphqlUrl() }),
  cache: new InMemoryCache(),
});

const clients = new Map<string, typeof apolloClient>();

/**
 * One client per person, each sending X-GPX-Person, so one person's cached
 * activities lists never show up while viewing another's.
 */
export function clientFor(person: string) {
  let client = clients.get(person);
  if (!client) {
    client = new ApolloClient({
      link: new HttpLink({ uri: () => getGraphqlUrl(), headers: { "X-GPX-Person": person } }),
      cache: new InMemoryCache(),
    });
    clients.set(person, client);
  }
  return client;
}

export function apiOrigin(): string {
  return getGraphqlUrl().replace(/\/graphql\/?$/, "");
}
