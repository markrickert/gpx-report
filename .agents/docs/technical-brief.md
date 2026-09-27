# Technical Brief

## Foundation

- **Backend**: Node with TypeScript and ES modules. It serves one GraphQL API (Apollo Server on Express) and a few plain HTTP routes for source-file download, media proxy, and full backup export. It sends SQL directly through one shared connection pool, with no ORM.
- **Database**: Postgres with PostGIS.
- **Frontend**: one Expo app with Expo Router. It builds the iOS and Android recorder and the web analysis app from the same codebase. A web-specific file variant replaces a screen on web.
- **Web analysis pages** are plain DOM pages with Leaflet maps and Recharts charts. They run only on web and are not React Native components.
- **Native screens** are React Native. Their maps are Apple Maps on iOS and Google Maps on Android. Google Maps needs an API key, which stays out of git.
- The Apollo cache is the only client state store.

## Operating Model

- The stack runs with Docker Compose on one host behind a reverse proxy. It is meant to be reachable only on a private network. The services are the database, the backend, and the web frontend.
- The production images contain the source code, and no source folder is mounted into them. A code change takes effect only after an image rebuild. A container restart keeps the old code.
- The web frontend container serves the web app and passes API requests to the backend. The whole app uses one address, so the web bundle needs no API address.
- An optional development override mounts the source folders and runs the backend and the web frontend in watch mode.
- The phone app reaches the server over the private network. The server address can be changed in the app settings without a new build.
- An initialization script creates the schema only on a new database volume. There is no migration tool. For a schema change on a running deployment, apply the change manually, or rebuild the volume and then run reanalysis.

## Data

- The source files, in one folder for each person, are the source of truth. Treat them with care.
- Activities and routes are derived data. Reanalysis regenerates them, so it is safe to delete the database volume and rebuild it.
- Shares, activity notes, and the Immich settings exist only in the database. Export them before a volume wipe, because a volume wipe deletes them. The full backup export includes the database rows and the shares.
- The database stores each route two times: as a PostGIS geometry for spatial queries, and as a point list that keeps elevation, time, and sensor values for the map and the charts.

## Conventions

- Bulk database work uses bounded concurrency, because the connection pool is small.
- Every page must work on a desktop browser and on a phone.
- Backend pure logic has Vitest unit tests. Database-bound code has integration tests against a real Postgres container. The frontend has Vitest tests that resolve web variants first. A Playwright smoke suite runs against the live stack and is safe for real data.
- Backend, frontend, and the repository root each have their own pnpm project, with no workspace, because Docker builds each one separately. The frontend uses a flat dependency layout for Expo tooling. Each project lists the dependencies that it permits to run install scripts.
- Backend and frontend each have their own ESLint configuration and share one Prettier configuration. A pre-commit hook lints and formats staged TypeScript files.
- The human-facing reference documentation lives in the repository documentation folder. The setup guide holds the most detailed operational notes.
