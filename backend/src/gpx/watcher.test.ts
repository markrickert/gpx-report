import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

const fakeWatcher = new EventEmitter();

vi.mock("chokidar", () => ({
  default: { watch: vi.fn(() => fakeWatcher) },
}));

vi.mock("./processor.js", () => ({ processFile: vi.fn() }));

const chokidar = ((await import("chokidar")).default as any);
const { processFile } = (await import("./processor.js")) as any;
const { watchGpxDirectory } = await import("./watcher.js");

describe("watchGpxDirectory", () => {
  beforeEach(() => {
    fakeWatcher.removeAllListeners();
    chokidar.watch.mockClear();
    processFile.mockReset();
  });

  it("processes queued files strictly one at a time, in FIFO order", async () => {
    // Each processFile call blocks until we explicitly resolve it, so we can
    // observe whether a second call starts before the first finishes.
    const resolvers = [];
    processFile.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );

    watchGpxDirectory("/data/gpx");
    fakeWatcher.emit("ready");
    fakeWatcher.emit("add", "/data/gpx/a.gpx");
    fakeWatcher.emit("add", "/data/gpx/b.gpx");
    fakeWatcher.emit("add", "/data/gpx/c.gpx");

    // Let the microtask queue settle so the queue's first task starts.
    await Promise.resolve();
    await Promise.resolve();

    expect(processFile).toHaveBeenCalledTimes(1);
    expect(processFile).toHaveBeenCalledWith("/data/gpx/a.gpx", { skipGeocode: false });

    resolvers[0]();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(processFile).toHaveBeenCalledTimes(2);
    expect(processFile).toHaveBeenCalledWith("/data/gpx/b.gpx", { skipGeocode: false });

    resolvers[1]();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(processFile).toHaveBeenCalledTimes(3);
    expect(processFile).toHaveBeenCalledWith("/data/gpx/c.gpx", { skipGeocode: false });

    resolvers[2]();
  });

  it("ignores non-gpx/igc/skiz files", async () => {
    processFile.mockResolvedValue(undefined);

    watchGpxDirectory("/data/gpx");
    fakeWatcher.emit("ready");
    fakeWatcher.emit("add", "/data/gpx/notes.txt");
    await Promise.resolve();
    await Promise.resolve();

    expect(processFile).not.toHaveBeenCalled();
  });

  it("skips geocoding for the initial pre-existing-file replay (before 'ready'), but not for files added after 'ready'", async () => {
    processFile.mockResolvedValue(undefined);

    watchGpxDirectory("/data/gpx");

    // Pre-existing files: chokidar fires these before 'ready'.
    fakeWatcher.emit("add", "/data/gpx/existing1.gpx");
    fakeWatcher.emit("add", "/data/gpx/existing2.gpx");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Initial scan settles.
    fakeWatcher.emit("ready");

    // Genuinely new file, arriving after 'ready'.
    fakeWatcher.emit("add", "/data/gpx/new.gpx");
    await new Promise((resolve) => setImmediate(resolve));

    expect(processFile).toHaveBeenNthCalledWith(1, "/data/gpx/existing1.gpx", {
      skipGeocode: true,
    });
    expect(processFile).toHaveBeenNthCalledWith(2, "/data/gpx/existing2.gpx", {
      skipGeocode: true,
    });
    expect(processFile).toHaveBeenNthCalledWith(3, "/data/gpx/new.gpx", { skipGeocode: false });
  });

  it("passes the watched directory through to chokidar.watch with ignoreInitial: false", () => {
    watchGpxDirectory("/data/gpx");
    expect(chokidar.watch).toHaveBeenCalledWith(
      "/data/gpx",
      expect.objectContaining({ ignoreInitial: false }),
    );
  });
});
