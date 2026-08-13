import { defineConfig } from "vitest/config";

// `npm run test:integration`: real-Postgres/PostGIS tests via testcontainers
// (gpx/processor.integration.test.ts). Needs a Docker daemon reachable from
// wherever the test runs (the Docker socket) to start the container, so it's
// kept out of the default `npm test` run (vitest.config.ts) rather than
// bundled in.
export default defineConfig({
  test: {
    include: ["**/*.integration.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
