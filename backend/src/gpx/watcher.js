import chokidar from "chokidar";
import { processFile } from "./processor.js";

export function watchGpxDirectory(directory) {
  const watcher = chokidar.watch(directory, {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 },
  });

  watcher.on("add", async (filePath) => {
    if (!filePath.toLowerCase().endsWith(".gpx")) return;
    try {
      await processFile(filePath);
      console.log(`Ingested ${filePath}`);
    } catch (err) {
      console.error(`Failed to ingest ${filePath}:`, err.message);
    }
  });

  return watcher;
}
