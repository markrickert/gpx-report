import path from "node:path";
import { Readable } from "node:stream";
import express from "express";
import cors from "cors";
import { ZipArchive } from "archiver";
import { ApolloServer } from "@apollo/server";
import { expressMiddleware } from "@apollo/server/express4";
import { ApolloServerPluginDrainHttpServer } from "@apollo/server/plugin/drainHttpServer";
import http from "node:http";
import { typeDefs } from "./graphql/typeDefs.js";
import { resolvers } from "./graphql/resolvers.js";
import { watchGpxDirectory } from "./gpx/watcher.js";
import { pool } from "./db.js";
import { getImmichSettings } from "./immich/settings.js";
import { fetchImmichAssetStream } from "./immich/client.js";
import { personFromHeader } from "./people.js";

const PORT = Number(process.env.GRAPHQL_PORT) || 4000;
const GPX_FILES_DIRECTORY = process.env.GPX_FILES_DIRECTORY;

if (!GPX_FILES_DIRECTORY) {
  throw new Error("GPX_FILES_DIRECTORY environment variable is required");
}

const app = express();
const httpServer = http.createServer(app);

const server = new ApolloServer({
  typeDefs,
  resolvers,
  plugins: [ApolloServerPluginDrainHttpServer({ httpServer })],
});

await server.start();

// Who's asking: the phone sends the name from its Settings, the web app the
// /<person>/ from its URL. Missing/invalid falls back to DEFAULT_PERSON so
// older clients keep working.
app.use(
  "/graphql",
  cors(),
  express.json({ limit: "50mb" }),
  expressMiddleware(server, {
    context: async ({ req }) => ({ person: personFromHeader(req.headers["x-gpx-person"]) }),
  }),
);

app.get("/api/activities/:id/download", async (req, res) => {
  const { rows } = await pool.query("SELECT gpx_filename FROM activities WHERE id = $1", [
    req.params.id,
  ]);
  if (!rows[0]) {
    res.status(404).send("Activity not found");
    return;
  }
  const gpxFilename = rows[0].gpx_filename;
  res.download(path.join(GPX_FILES_DIRECTORY, gpxFilename), path.basename(gpxFilename));
});

// Streams an Immich photo/video (or its thumbnail) through the backend
// rather than the frontend, so the Immich API key never reaches the
// browser and the Immich server itself doesn't need to be exposed outside
// Tailscale. Only ever proxies an asset id already recorded in
// activity_media for this activity — never an arbitrary client-supplied id.
async function proxyImmichAsset(req, res, variant: "original" | "thumbnail") {
  const { id, assetId } = req.params;
  const { rows } = await pool.query(
    "SELECT 1 FROM activity_media WHERE activity_id = $1 AND immich_asset_id = $2",
    [id, assetId],
  );
  if (!rows[0]) {
    res.status(404).send("Media not found for this activity");
    return;
  }

  const settings = await getImmichSettings();
  if (!settings) {
    res.status(503).send("Immich is not configured");
    return;
  }

  const upstream = await fetchImmichAssetStream(settings, assetId, variant);
  if (!upstream.ok || !upstream.body) {
    res.status(upstream.status).send("Failed to fetch media from Immich");
    return;
  }

  const contentType = upstream.headers.get("content-type");
  const etag = upstream.headers.get("etag");
  if (contentType) res.setHeader("Content-Type", contentType);
  if (etag) res.setHeader("ETag", etag);
  // Assets are immutable by id in Immich; cache aggressively so scrolling
  // the gallery doesn't re-stream the same large file through this proxy
  // every time.
  res.setHeader("Cache-Control", "public, max-age=604800, immutable");

  Readable.fromWeb(upstream.body as any).pipe(res);
}

app.get("/api/activities/:id/media/:assetId", (req, res) => proxyImmichAsset(req, res, "original"));
app.get("/api/activities/:id/media/:assetId/thumbnail", (req, res) =>
  proxyImmichAsset(req, res, "thumbnail"),
);

// Full disaster-recovery/migration export: every raw source file under
// GPX_FILES_DIRECTORY as-is, plus a JSON dump of every activities/
// activity_routes row (full fidelity, including points_data and
// route_geom as GeoJSON) — distinct from the Settings page's summary-only
// analysis export, which excludes per-point track data. No client input is
// used to build any filesystem path or query here.
app.get("/api/export/full", async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      a.*,
      ST_AsGeoJSON(r.route_geom)::json AS route_geom_geojson,
      r.elevation_profile_data,
      r.points_data
    FROM activities a
    LEFT JOIN activity_routes r ON r.activity_id = a.id
    ORDER BY a.id
  `);

  const dateStamp = new Date().toISOString().slice(0, 10);
  res.attachment(`gpx-report-full-export-${dateStamp}.zip`);

  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.on("error", (err) => {
    console.error("Full export archive error:", err);
    res.destroy(err);
  });
  archive.pipe(res);

  archive.directory(GPX_FILES_DIRECTORY, "gpx-files");
  // Stream the JSON array one row at a time rather than JSON.stringify-ing
  // the whole result set at once — with ~500 activities' worth of
  // points_data, a single pretty-printed string blows past V8's per-string
  // length limit (RangeError: Invalid string length) even though the raw
  // data itself is a very manageable size.
  archive.append(Readable.from(dbExportJsonChunks(rows)), { name: "db-export.json" });
  // activity_shares isn't derivable from the GPX files, so it's exported too.
  const { rows: shares } = await pool.query(
    "SELECT gpx_filename, person FROM activity_shares ORDER BY gpx_filename, person",
  );
  archive.append(JSON.stringify(shares, null, 2), { name: "activity-shares.json" });
  // Nor are trips.
  const { rows: trips } = await pool.query(`
    SELECT t.id, t.name, to_char(t.start_date, 'YYYY-MM-DD') AS start_date,
      to_char(t.end_date, 'YYYY-MM-DD') AS end_date, t.goal_meters,
      ARRAY(SELECT person FROM trip_participants p WHERE p.trip_id = t.id ORDER BY person)
        AS participants
    FROM trips t
    ORDER BY t.id
  `);
  archive.append(JSON.stringify(trips, null, 2), { name: "trips.json" });

  await archive.finalize();
});

async function* dbExportJsonChunks(rows) {
  yield "[\n";
  for (let i = 0; i < rows.length; i++) {
    yield (i > 0 ? ",\n" : "") + JSON.stringify(rows[i]);
  }
  yield "\n]\n";
}

await new Promise<void>((resolve) => httpServer.listen({ port: PORT }, resolve));

console.log(`GraphQL API ready at http://localhost:${PORT}/graphql`);

watchGpxDirectory(GPX_FILES_DIRECTORY);
console.log(`Watching ${GPX_FILES_DIRECTORY} for new GPX files`);
