import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/apollo", () => {
  const clients = new Map();
  return {
    clientFor: vi.fn((person: string) => {
      if (!clients.has(person))
        clients.set(person, { mutate: vi.fn(), refetchQueries: vi.fn(() => Promise.resolve()) });
      return clients.get(person);
    }),
  };
});
vi.mock("expo-crypto", () => ({ randomUUID: () => "unused" }));
vi.mock("./import-files", () => ({
  readBase64: vi.fn(async (uri: string) => `base64-of-${uri}`),
  readText: vi.fn(async () => JSON.stringify({ title: "Hiking", distanceMeters: 6437 })),
  writeIntoQueue: vi.fn(),
  removeFile: vi.fn(),
}));

const { clientFor } = (await import("@/lib/apollo")) as any;
const apolloClient = clientFor("kristin");
const store = await import("./store");
const { drainUploadQueue, retryDelayMs, takeImportResult } = await import("./upload-queue");
const { removeFile } = (await import("./import-files")) as any;

function pendingRecording(id: string, person = "kristin") {
  store.createRecording(id, 1_000, person);
  store.appendPoints(id, [
    { lat: 40, lon: -105, elevation: 1600, timestamp: 1_000, segment: 0 },
    { lat: 40.001, lon: -105, elevation: 1601, timestamp: 3_000, segment: 0 },
  ]);
  store.updateRecording(id, { status: "pending", title: "Walk", activityType: "Walking" });
}

describe("drainUploadQueue", () => {
  beforeEach(() => {
    apolloClient.mutate.mockReset();
    for (const r of store.listRecordings(["pending", "failed", "uploaded"]))
      store.deleteRecording(r.id);
  });

  it("uploads with the recording id as clientId and marks it uploaded", async () => {
    pendingRecording("rec-1");
    apolloClient.mutate.mockResolvedValue({
      data: { saveRecordedActivity: { filename: "recorded-rec-1.gpx" } },
    });

    await drainUploadQueue(10_000);

    const { variables } = apolloClient.mutate.mock.calls[0][0];
    expect(variables.clientId).toBe("rec-1");
    expect(variables.gpxContent).toContain("<type>Walking</type>");
    expect(store.getRecording("rec-1")).toMatchObject({
      status: "uploaded",
      uploadedFilename: "recorded-rec-1.gpx",
    });
  });

  it("backs off after a failure and skips the recording until the delay passes", async () => {
    pendingRecording("rec-2");
    apolloClient.mutate.mockRejectedValue(new Error("Network request failed"));

    await drainUploadQueue(10_000);
    expect(store.getRecording("rec-2")).toMatchObject({
      status: "failed",
      uploadAttempts: 1,
      nextAttemptAt: 10_000 + retryDelayMs(1),
      lastError: "Network request failed",
    });

    await drainUploadQueue(10_001);
    expect(apolloClient.mutate).toHaveBeenCalledTimes(1);

    apolloClient.mutate.mockResolvedValue({
      data: { saveRecordedActivity: { filename: "f.gpx" } },
    });
    await drainUploadQueue(10_000 + retryDelayMs(1));
    expect(store.getRecording("rec-2")?.status).toBe("uploaded");
  });
});

describe("drainUploadQueue per person", () => {
  it("uploads each recording through its recorder's client", async () => {
    for (const r of store.listRecordings(["pending", "failed", "uploaded"]))
      store.deleteRecording(r.id);
    const markClient = clientFor("mark");
    apolloClient.mutate.mockReset();
    apolloClient.mutate.mockResolvedValue({
      data: { saveRecordedActivity: { filename: "k.gpx" } },
    });
    markClient.mutate.mockResolvedValue({ data: { saveRecordedActivity: { filename: "m.gpx" } } });
    pendingRecording("rec-k", "kristin");
    pendingRecording("rec-m", "mark");

    await drainUploadQueue(10_000);

    expect(apolloClient.mutate.mock.calls[0][0].variables.clientId).toBe("rec-k");
    expect(markClient.mutate.mock.calls[0][0].variables.clientId).toBe("rec-m");
  });
});

describe("retryDelayMs", () => {
  it("doubles per attempt and caps at 6 hours", () => {
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(2)).toBe(60_000);
    expect(retryDelayMs(20)).toBe(6 * 60 * 60 * 1000);
  });
});

describe("drainUploadQueue imports", () => {
  const queue = (id: string, name = "hike.gpx") =>
    store.createImport(
      { id, person: "kristin", name, localUri: `file:///imports/${id}.gpx` },
      5_000,
    );

  beforeEach(() => {
    apolloClient.mutate.mockReset();
    removeFile.mockReset();
    for (const i of store.listImports(["pending", "failed", "rejected"])) store.deleteImport(i.id);
  });

  it("sends the file as base64 through the importer's client, then drops it from the queue", async () => {
    queue("imp-1");
    const result = { status: "IMPORTED", activityId: "42", title: "Morning Hike", reason: null };
    apolloClient.mutate.mockResolvedValue({ data: { importActivityFile: result } });

    await drainUploadQueue(10_000);

    expect(apolloClient.mutate.mock.calls[0][0].variables).toEqual({
      filename: "hike.gpx",
      contentBase64: "base64-of-file:///imports/imp-1.gpx",
    });
    expect(store.listImports(["pending", "failed", "rejected"])).toEqual([]);
    expect(removeFile).toHaveBeenCalledWith("file:///imports/imp-1.gpx");
    expect(takeImportResult("imp-1")).toEqual(result);
    expect(takeImportResult("imp-1")).toBeUndefined();
  });

  it("treats a duplicate as done", async () => {
    queue("imp-2");
    apolloClient.mutate.mockResolvedValue({
      data: {
        importActivityFile: { status: "DUPLICATE", activityId: "7", title: "Hike", reason: null },
      },
    });
    await drainUploadQueue(10_000);
    expect(store.listImports(["pending", "failed", "rejected"])).toEqual([]);
  });

  it("stops retrying a file the server refused", async () => {
    queue("imp-3", "route.gpx");
    apolloClient.mutate.mockResolvedValue({
      data: {
        importActivityFile: {
          status: "REJECTED",
          activityId: null,
          title: null,
          reason: "No timestamps",
        },
      },
    });

    await drainUploadQueue(10_000);
    await drainUploadQueue(10_000_000);

    expect(apolloClient.mutate).toHaveBeenCalledTimes(1);
    expect(store.listImports(["rejected"])[0]).toMatchObject({
      id: "imp-3",
      lastError: "No timestamps",
    });
    expect(removeFile).toHaveBeenCalledWith("file:///imports/imp-3.gpx");
  });

  it("sends a manual activity through its own mutation with the queue id as clientId", async () => {
    store.createImport(
      {
        id: "man-1",
        person: "kristin",
        name: "Hiking",
        localUri: "file:///imports/man-1.manual.json",
      },
      5_000,
    );
    apolloClient.mutate.mockResolvedValue({ data: { addManualActivity: { id: "43" } } });

    await drainUploadQueue(10_000);

    expect(apolloClient.mutate.mock.calls[0][0].variables).toEqual({
      input: { title: "Hiking", distanceMeters: 6437 },
      clientId: "man-1",
    });
    expect(store.listImports(["pending", "failed", "rejected"])).toEqual([]);
    expect(removeFile).toHaveBeenCalledWith("file:///imports/man-1.manual.json");
  });

  it("keeps the file and backs off when the server can't be reached", async () => {
    queue("imp-4");
    apolloClient.mutate.mockRejectedValue(new Error("Network request failed"));

    await drainUploadQueue(10_000);

    expect(store.listImports(["failed"])[0]).toMatchObject({
      id: "imp-4",
      uploadAttempts: 1,
      nextAttemptAt: 10_000 + retryDelayMs(1),
      lastError: "Network request failed",
    });
    expect(removeFile).not.toHaveBeenCalled();
  });
});
