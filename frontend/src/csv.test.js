import { describe, it, expect, vi, afterEach } from "vitest";
import { toCsv, downloadCsv, downloadJson } from "./csv.js";

const columns = [
  { header: "Name", accessor: (row) => row.name },
  { header: "Distance", accessor: (row) => row.distance },
];

describe("toCsv", () => {
  it("renders a header row followed by one row per input record", () => {
    const rows = [
      { name: "Morning Run", distance: 5 },
      { name: "Evening Hike", distance: 10 },
    ];
    expect(toCsv(rows, columns)).toBe("Name,Distance\r\nMorning Run,5\r\nEvening Hike,10");
  });

  it("renders just the header row when given no rows", () => {
    expect(toCsv([], columns)).toBe("Name,Distance");
  });

  it("quotes and escapes fields containing commas", () => {
    const rows = [{ name: "Run, Fast", distance: 5 }];
    expect(toCsv(rows, columns)).toBe('Name,Distance\r\n"Run, Fast",5');
  });

  it("quotes and escapes fields containing double quotes", () => {
    const rows = [{ name: 'Run "Fast"', distance: 5 }];
    expect(toCsv(rows, columns)).toBe('Name,Distance\r\n"Run ""Fast""",5');
  });

  it("quotes fields containing newlines", () => {
    const rows = [{ name: "Run\nwith notes", distance: 5 }];
    expect(toCsv(rows, columns)).toBe('Name,Distance\r\n"Run\nwith notes",5');
  });

  it("quotes fields containing carriage returns", () => {
    const rows = [{ name: "Run\rwith notes", distance: 5 }];
    expect(toCsv(rows, columns)).toBe('Name,Distance\r\n"Run\rwith notes",5');
  });

  it("renders null/undefined accessor values as empty strings", () => {
    const rows = [{ name: null, distance: undefined }];
    expect(toCsv(rows, columns)).toBe("Name,Distance\r\n,");
  });
});

describe("downloadCsv", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates an object URL, clicks a download link, and revokes the URL", () => {
    const rows = [{ name: "Morning Run", distance: 5 }];
    const createObjectURL = vi.fn(() => "blob:mock-url");
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    downloadCsv("activities.csv", rows, columns);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });
});

describe("downloadJson", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates an object URL from pretty-printed JSON, clicks a download link, and revokes the URL", () => {
    const data = [{ name: "Morning Run", distance: 5 }];
    let blobText;
    const createObjectURL = vi.fn((blob) => {
      blobText = blob;
      return "blob:mock-url";
    });
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    downloadJson("activities.json", data);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(blobText.type).toBe("application/json;charset=utf-8;");
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });
});
