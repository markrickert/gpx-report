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

app.use("/graphql", cors(), express.json({ limit: "50mb" }), expressMiddleware(server));

app.get("/activities/:id/download", async (req, res) => {
  const { rows } = await pool.query("SELECT gpx_filename FROM activities WHERE id = $1", [
    req.params.id,
  ]);
  if (!rows[0]) {
    res.status(404).send("Activity not found");
    return;
  }
  const gpxFilename = rows[0].gpx_filename;
  res.download(path.join(GPX_FILES_DIRECTORY, gpxFilename), gpxFilename);
});

// Full disaster-recovery/migration export: every raw source file under
// GPX_FILES_DIRECTORY as-is, plus a JSON dump of every activities/
// activity_routes row (full fidelity, including points_data and
// route_geom as GeoJSON) — distinct from the Settings page's summary-only
// analysis export, which excludes per-point track data. No client input is
// used to build any filesystem path or query here.
app.get("/export/full", async (req, res) => {
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

  await archive.finalize();
});

async function* dbExportJsonChunks(rows) {
  yield "[\n";
  for (let i = 0; i < rows.length; i++) {
    yield (i > 0 ? ",\n" : "") + JSON.stringify(rows[i]);
  }
  yield "\n]\n";
}

await new Promise((resolve) => httpServer.listen({ port: PORT }, resolve));

console.log(`GraphQL API ready at http://localhost:${PORT}/graphql`);

watchGpxDirectory(GPX_FILES_DIRECTORY);
console.log(`Watching ${GPX_FILES_DIRECTORY} for new GPX files`);
