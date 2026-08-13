import { defineConfig } from "vitest/config";

// Default `npm test` run: fast, pure-logic unit tests only. Excludes
// *.integration.test.ts, which spins up a real Postgres/PostGIS container
// via testcontainers and needs the Docker socket mounted — see
// vitest.integration.config.ts and `npm run test:integration`.
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.integration.test.ts"],
  },
});
