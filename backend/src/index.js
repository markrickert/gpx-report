import path from "node:path";
import express from "express";
import cors from "cors";
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

await new Promise((resolve) => httpServer.listen({ port: PORT }, resolve));

console.log(`GraphQL API ready at http://localhost:${PORT}/graphql`);

watchGpxDirectory(GPX_FILES_DIRECTORY);
console.log(`Watching ${GPX_FILES_DIRECTORY} for new GPX files`);
