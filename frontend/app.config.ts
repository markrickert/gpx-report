import type { ConfigContext, ExpoConfig } from "expo/config";

// Google Maps on Android needs an API key; it's kept out of git and read from
// the environment (frontend/.env or the shell) at build time.
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  android: {
    ...config.android,
    config: { googleMaps: { apiKey: process.env.GOOGLE_MAPS_API_KEY } },
  },
});
