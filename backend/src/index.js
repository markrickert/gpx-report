import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { typeDefs } from "./graphql/typeDefs.js";
import { resolvers } from "./graphql/resolvers.js";
import { watchGpxDirectory } from "./gpx/watcher.js";

const PORT = Number(process.env.GRAPHQL_PORT) || 4000;
const GPX_FILES_DIRECTORY = process.env.GPX_FILES_DIRECTORY;

if (!GPX_FILES_DIRECTORY) {
  throw new Error("GPX_FILES_DIRECTORY environment variable is required");
}

const server = new ApolloServer({ typeDefs, resolvers });

const { url } = await startStandaloneServer(server, {
  listen: { port: PORT },
});

console.log(`GraphQL API ready at ${url}`);

watchGpxDirectory(GPX_FILES_DIRECTORY);
console.log(`Watching ${GPX_FILES_DIRECTORY} for new GPX files`);
