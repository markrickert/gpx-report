const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Expo Router bundles `.web.tsx` routes into the phone app too, and with them
// the web-only screens they import (Leaflet and other code that needs
// `document`). They never render there, but Fast Refresh can re-run them after
// an edit to a shared file and crash. The phone never needs them, so leave
// them out of its bundle.
const WEB_SCREENS = /^@\/screens\/web\//;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform !== "web" && WEB_SCREENS.test(moduleName)) return { type: "empty" };
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
