import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
    // Resolve platform files the way Metro does for web, so tests exercise
    // the in-memory store.web.ts instead of the native expo-sqlite one.
    extensions: [".web.tsx", ".web.ts", ".tsx", ".ts", ".mjs", ".js", ".json"],
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
