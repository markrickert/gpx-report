import { Map, Camera, GeoJSONSource, Layer } from "@maplibre/maplibre-react-native";
import type { StyleProp, ViewStyle } from "react-native";
import type { TrackPoint } from "@/recording/types";

// Raster OSM tiles: no API key, no Google/Apple map SDK account needed.
const OSM_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: "raster" as const,
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster" as const, source: "osm" }],
};

type Props = { points: TrackPoint[]; follow: boolean; style?: StyleProp<ViewStyle> };

export function LiveTrackMap({ points, follow, style }: Props) {
  const last = points[points.length - 1];
  const segments = new globalThis.Map<number, [number, number][]>();
  for (const p of points) {
    if (!segments.has(p.segment)) segments.set(p.segment, []);
    segments.get(p.segment)!.push([p.lon, p.lat]);
  }

  return (
    <Map style={style} mapStyle={OSM_STYLE} attribution>
      {last && follow && <Camera center={[last.lon, last.lat]} zoom={16} duration={500} />}
      {last && !follow && (
        <Camera
          initialViewState={{
            bounds: [
              Math.min(...points.map((p) => p.lon)),
              Math.min(...points.map((p) => p.lat)),
              Math.max(...points.map((p) => p.lon)),
              Math.max(...points.map((p) => p.lat)),
            ],
            padding: { top: 32, right: 32, bottom: 32, left: 32 },
          }}
        />
      )}
      <GeoJSONSource
        id="track"
        data={{ type: "MultiLineString", coordinates: [...segments.values()] }}
      >
        <Layer type="line" id="track-line" paint={{ "line-color": "#2563eb", "line-width": 4 }} />
      </GeoJSONSource>
      {last && (
        <GeoJSONSource id="position" data={{ type: "Point", coordinates: [last.lon, last.lat] }}>
          <Layer
            type="circle"
            id="position-dot"
            paint={{
              "circle-radius": 7,
              "circle-color": "#2563eb",
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 2,
            }}
          />
        </GeoJSONSource>
      )}
    </Map>
  );
}
