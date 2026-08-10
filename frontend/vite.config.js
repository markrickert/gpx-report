import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png"],
      manifest: {
        name: "GPX Report",
        short_name: "GPX Report",
        description: "Self-hosted activity tracker for GPX files",
        theme_color: "#2563eb",
        background_color: "#f9fafb",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      // Default generateSW behavior: precache the built app shell (JS/CSS/
      // HTML/icons) only. The GraphQL API lives on a separate origin
      // (VITE_GRAPHQL_URL) and is never runtime-cached — this app has no
      // offline data story, just an installable app shell.
    }),
  ],
  server: {
    port: 3000,
    host: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.js"],
  },
});
