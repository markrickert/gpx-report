import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/apollo", () => ({
  apolloClient: { mutate: vi.fn(), refetchQueries: vi.fn(() => Promise.resolve()) },
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "unused" }));

const { apolloClient } = (await import("@/lib/apollo")) as any;
const store = await import("./store");
const { drainUploadQueue, retryDelayMs } = await import("./upload-queue");

function pendingRecording(id: string) {
  store.createRecording(id, 1_000);
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

describe("retryDelayMs", () => {
  it("doubles per attempt and caps at 6 hours", () => {
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(2)).toBe(60_000);
    expect(retryDelayMs(20)).toBe(6 * 60 * 60 * 1000);
  });
});
