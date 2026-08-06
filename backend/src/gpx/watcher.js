import chokidar from "chokidar";
import { processFile } from "./processor.js";

// chokidar fires one 'add' event per pre-existing file on startup (potentially
// hundreds at once with ignoreInitial: false); each handler calling processFile
// independently would open one DB connection per file, far exceeding the pool
// size. Queue them and process one at a time instead.
function createQueue() {
  let tail = Promise.resolve();
  return (task) => {
    tail = tail.then(task, task);
    return tail;
  };
}

export function watchGpxDirectory(directory) {
  const enqueue = createQueue();
  const watcher = chokidar.watch(directory, {
    ignoreInitial: false,
    awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 },
  });

  watcher.on("add", (filePath) => {
    if (!/\.(gpx|igc|slpz|slopes)$/i.test(filePath)) return;
    enqueue(async () => {
      try {
        await processFile(filePath);
        console.log(`Ingested ${filePath}`);
      } catch (err) {
        console.error(`Failed to ingest ${filePath}:`, err.message);
      }
    });
  });

  return watcher;
}
