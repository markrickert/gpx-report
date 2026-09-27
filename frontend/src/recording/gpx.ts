import type { TrackPoint } from "./types";

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Minimal GPX 1.1 document in the shape backend/src/gpx/writer.ts writes and
// backend/src/gpx/parser.ts reads: <trk><name>/<type> + <trkpt><ele>/<time>.
// <type> is picked up by the parser's resolveActivityType(), so the chosen
// activity type lands at ingest with no follow-up mutation.
export function buildGpxXml(
  points: TrackPoint[],
  title: string,
  activityType: string,
  note: string | null = null,
) {
  const segments = new Map<number, TrackPoint[]>();
  for (const p of points) {
    if (!segments.has(p.segment)) segments.set(p.segment, []);
    segments.get(p.segment)!.push(p);
  }
  const trksegs = [...segments.values()]
    .map((seg) => {
      const trkpts = seg
        .map((p) => {
          const ele = p.elevation != null ? `<ele>${p.elevation.toFixed(1)}</ele>` : "";
          const time = `<time>${new Date(p.timestamp).toISOString()}</time>`;
          return `   <trkpt lat="${p.lat}" lon="${p.lon}">${ele}${time}</trkpt>`;
        })
        .join("\n");
      return `  <trkseg>\n${trkpts}\n  </trkseg>`;
    })
    .join("\n");
  const type = activityType !== "Unknown" ? `\n  <type>${escapeXml(activityType)}</type>` : "";
  const desc = note ? `\n  <desc>${escapeXml(note)}</desc>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx creator="gpx-report" version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
 <trk>
  <name>${escapeXml(title)}</name>${desc}${type}
${trksegs}
 </trk>
</gpx>
`;
}
