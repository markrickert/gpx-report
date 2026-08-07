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

  // chokidar's initial 'add' burst (every pre-existing file, on every backend
  // restart) shouldn't trigger reverse-geocoding — that's a bulk operation
  // and belongs to the dedicated, explicitly-throttled backfill script
  // (backend/scripts/backfillLocationNames.js), not to a startup replay of
  // the ingest path. Only 'add' events for genuinely new files (after the
  // initial scan settles, per chokidar's 'ready' event) geocode.
  let ready = false;
  watcher.on("ready", () => {
    ready = true;
  });

  watcher.on("add", (filePath) => {
    if (!/\.(gpx|igc|skiz)$/i.test(filePath)) return;
    const skipGeocode = !ready;
    enqueue(async () => {
      try {
        await processFile(filePath, { skipGeocode });
        console.log(`Ingested ${filePath}`);
      } catch (err) {
        console.error(`Failed to ingest ${filePath}:`, err.message);
      }
    });
  });

  return watcher;
}
