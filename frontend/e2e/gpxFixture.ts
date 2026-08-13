import { mkdir, readdir, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The live backend's file watcher (backend/src/gpx/watcher.ts) polls
// GPX_FILES_DIRECTORY, bind-mounted from ./data/gpx on the host (see
// docker-compose.yml's `./data/gpx:/gpx-files`). Dropping a file here gets
// it ingested exactly like a real Syncthing-synced file — this is the
// suite's only way to get a disposable, editable/trimmable/deletable
// activity without touching any of the real ones.
export const GPX_DIR = path.resolve(__dirname, "../../data/gpx");

export const GRAPHQL_URL = process.env.E2E_GRAPHQL_URL || "http://localhost:4000/graphql";

export async function graphql<T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json()) as { data: T; errors?: { message: string }[] };
  if (json.errors) {
    throw new Error(
      `GraphQL error: ${json.errors.map((e: { message: string }) => e.message).join("; ")}`,
    );
  }
  return json.data as T;
}

const MOVING_SPEED_MPS = 3; // roughly running pace
const METERS_PER_DEGREE_LAT = 111_320;
const STATIONARY_SECONDS = 40; // > ActivityDetail's 30s MIN_STILLNESS_DURATION_SECONDS
const MOVING_SECONDS = 40;

// Builds a small synthetic GPX track: a stationary lead-in long enough to
// trigger ActivityDetail.tsx's auto-suggested trim crop
// (suggestTrimRange()/MIN_STILLNESS_DURATION_SECONDS), followed by a
// steadily-moving stretch with real elevation change (so map/chart
// rendering has something to draw). Coordinates sit far out in the Pacific
// (nowhere near this deployment's real Moab-area activities), so the
// fixture can never be visually mistaken for real data on the map/heatmap
// even if teardown is briefly mid-flight.
export function buildFixtureGpx(title: string, startTime = new Date("2020-01-01T00:00:00Z")) {
  const baseLat = 0.0;
  const baseLon = -160.0;
  const points: string[] = [];
  let t = new Date(startTime);

  const pushPoint = (lat: number, lon: number, ele: number) => {
    points.push(
      `<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><ele>${ele.toFixed(1)}</ele><time>${t.toISOString()}</time></trkpt>`,
    );
    t = new Date(t.getTime() + 1000);
  };

  for (let i = 0; i < STATIONARY_SECONDS; i++) {
    pushPoint(baseLat, baseLon, 10);
  }
  const latStep = MOVING_SPEED_MPS / METERS_PER_DEGREE_LAT;
  for (let i = 1; i <= MOVING_SECONDS; i++) {
    pushPoint(baseLat + latStep * i, baseLon, 10 + i * 0.5);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="gpx-report-e2e-fixture">
<trk><name>${title}</name><trkseg>${points.join("")}</trkseg></trk>
</gpx>`;
}

export async function writeFixtureFile(filename: string, content: string) {
  await mkdir(GPX_DIR, { recursive: true });
  await writeFile(path.join(GPX_DIR, filename), content, "utf-8");
}

// The watcher's FIFO ingestion queue (see watcher.ts) means a freshly
// written file isn't in the DB instantly — poll the real GraphQL API
// (searching by the fixture's unique title) rather than guessing a fixed
// delay.
export async function waitForIngest(title: string, timeoutMs = 30_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const data = await graphql<{ activities: { id: string; title: string }[] }>(
      `
        query ($search: String) {
          activities(limit: 5, search: $search) {
            id
            title
          }
        }
      `,
      { search: title },
    );
    const match = data.activities.find((a) => a.title === title);
    if (match) return match.id;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Fixture activity "${title}" was not ingested within ${timeoutMs}ms`);
}

// Best-effort, order-independent teardown — every step is wrapped so one
// already-done piece (e.g. the delete-flow test itself already removed the
// DB row and file) doesn't stop the rest from running. Called from
// test.afterAll, which Playwright still runs when an earlier test in the
// file failed/threw, so this is the backstop against ever leaving a stray
// fixture activity or file in the live, 500+-activity deployment.
export async function cleanupFixture(filename: string, id?: string | null) {
  if (id) {
    try {
      await graphql(
        `
          mutation ($id: ID!) {
            deleteActivity(id: $id)
          }
        `,
        { id },
      );
    } catch {
      // Already deleted (e.g. the delete-flow test itself succeeded) — fine.
    }
  }
  try {
    await unlink(path.join(GPX_DIR, filename));
  } catch {
    // Already removed by deleteActivity above, or ingestion never got this
    // far — fine either way.
  }
  try {
    // gpx/writer.ts backs up the pre-edit file into a sibling _backups/ dir
    // before every title/type/trim edit; the edit-flow test triggers a few
    // of these, and they're not cleaned up by deleteActivity (which only
    // touches the main file + DB row).
    const backupsDir = path.join(GPX_DIR, "_backups");
    const entries = await readdir(backupsDir);
    await Promise.all(
      entries
        .filter((name) => name.startsWith(`${filename}.`))
        .map((name) => rm(path.join(backupsDir, name), { force: true })),
    );
  } catch {
    // No _backups dir, or nothing matched — fine.
  }
}
