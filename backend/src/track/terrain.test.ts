import { describe, it, expect } from "vitest";
import { cellName, sampleCell, terrainElevations } from "./terrain.js";

const SAMPLES = 3601;

// A cell whose elevation is `row + 2 * col` meters, so any interpolated value
// is predictable from the position alone.
function buildCell() {
  const cell = Buffer.alloc(SAMPLES * SAMPLES * 2);
  for (let r = 0; r < SAMPLES; r++) {
    for (let c = 0; c < SAMPLES; c++) cell.writeInt16BE(r + 2 * c, 2 * (r * SAMPLES + c));
  }
  return cell;
}

describe("cellName", () => {
  it("names the cell by its south-west corner", () => {
    expect(cellName(38.56, -109.55)).toBe("N38W110");
    expect(cellName(-33.9, 151.2)).toBe("S34E151");
    expect(cellName(0.5, 0.5)).toBe("N00E000");
  });
});

describe("sampleCell", () => {
  const cell = buildCell();

  it("reads rows from the north edge down and columns from the west edge", () => {
    expect(sampleCell(cell, 38, -110)).toBeCloseTo(3600);
    expect(sampleCell(cell, 39 - 1 / 3600, -110 + 1 / 3600)).toBeCloseTo(3);
    expect(sampleCell(cell, 38.5, -109.5)).toBeCloseTo(1800 + 3600);
  });

  it("interpolates between samples", () => {
    const lat = 39 - 10.25 / 3600;
    const lon = -110 + 20.5 / 3600;
    expect(sampleCell(cell, lat, lon)).toBeCloseTo(10.25 + 2 * 20.5, 3);
  });

  it("returns null next to a void", () => {
    const withVoid = Buffer.from(cell);
    withVoid.writeInt16BE(-32768, 2 * (10 * SAMPLES + 20));
    expect(sampleCell(withVoid, 39 - 10.5 / 3600, -110 + 20.5 / 3600)).toBeNull();
  });
});

describe("terrainElevations", () => {
  it("looks up each point in its own cell and leaves gaps where there is no data", async () => {
    const cell = buildCell();
    const requested = [];
    const load = async (name) => {
      requested.push(name);
      return name === "N38W110" ? cell : null;
    };
    const elevations = await terrainElevations(
      [
        { lat: 39 - 100 / 3600, lon: -110 + 50 / 3600 },
        { lat: 10.5, lon: -150.5 },
      ],
      load,
    );
    expect(elevations).toEqual([200, null]);
    expect(requested).toEqual(["N38W110", "N10W151"]);
  });
});
