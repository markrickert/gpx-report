import { gunzipSync } from "node:zlib";

// Ground elevation from a terrain model, for tracks whose recorded altitude
// is unusable but whose positions are good. Data is SRTM at 1 arc-second
// (~30 m), read from the public AWS Terrain Tiles "skadi" set (free, no key):
// one gzipped file per 1°x1° cell, 3601x3601 big-endian int16 meters, rows
// north to south. Only the cell name leaves the server, never a coordinate.
const SAMPLES = 3601;
const VOID = -32768;
// A decompressed cell is ~26 MB.
const MAX_CACHED_CELLS = 4;

const cellCache = new Map();

export function cellName(lat, lon) {
  const latFloor = Math.floor(lat);
  const lonFloor = Math.floor(lon);
  const ns = latFloor >= 0 ? "N" : "S";
  const ew = lonFloor >= 0 ? "E" : "W";
  return `${ns}${String(Math.abs(latFloor)).padStart(2, "0")}${ew}${String(Math.abs(lonFloor)).padStart(3, "0")}`;
}

// Bilinear interpolation between the four samples around the position.
// Returns null when any of them is a void (no data).
export function sampleCell(cell, lat, lon) {
  const row = (Math.floor(lat) + 1 - lat) * (SAMPLES - 1);
  const col = (lon - Math.floor(lon)) * (SAMPLES - 1);
  const r0 = Math.min(Math.floor(row), SAMPLES - 2);
  const c0 = Math.min(Math.floor(col), SAMPLES - 2);
  const at = (r, c) => cell.readInt16BE(2 * (r * SAMPLES + c));
  const nw = at(r0, c0);
  const ne = at(r0, c0 + 1);
  const sw = at(r0 + 1, c0);
  const se = at(r0 + 1, c0 + 1);
  if (nw === VOID || ne === VOID || sw === VOID || se === VOID) return null;
  const fr = row - r0;
  const fc = col - c0;
  return (nw * (1 - fc) + ne * fc) * (1 - fr) + (sw * (1 - fc) + se * fc) * fr;
}

async function fetchCell(name) {
  const url = `https://s3.amazonaws.com/elevation-tiles-prod/skadi/${name.slice(0, 3)}/${name}.hgt.gz`;
  const res = await fetch(url);
  // No file means no land in the cell (open ocean).
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error(`Terrain data download failed: HTTP ${res.status}`);
  return gunzipSync(Buffer.from(await res.arrayBuffer()));
}

function loadCell(name) {
  if (!cellCache.has(name)) {
    if (cellCache.size >= MAX_CACHED_CELLS) cellCache.delete(cellCache.keys().next().value);
    const pending = fetchCell(name);
    pending.catch(() => cellCache.delete(name));
    cellCache.set(name, pending);
  }
  return cellCache.get(name);
}

// One elevation (meters, rounded to 0.1) per point, or null where the terrain
// model has no data.
export async function terrainElevations(points, load = loadCell) {
  const elevations = [];
  for (const { lat, lon } of points) {
    const cell = await load(cellName(lat, lon));
    const elevation = cell ? sampleCell(cell, lat, lon) : null;
    elevations.push(elevation == null ? null : Math.round(elevation * 10) / 10);
  }
  return elevations;
}
