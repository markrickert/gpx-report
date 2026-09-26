import { useEffect } from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { StyleProp, ViewStyle } from "react-native";
import { useTheme } from "@/utils/web-theme";
import type { TrackPoint } from "@/recording/types";

type Props = { points: TrackPoint[]; follow: boolean; style?: StyleProp<ViewStyle> };

function Follow({ point, follow }: { point?: TrackPoint; follow: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (point && follow) map.panTo([point.lat, point.lon]);
  }, [map, point, follow]);
  return null;
}

export function LiveTrackMap({ points, follow }: Props) {
  const { theme } = useTheme();
  const last = points[points.length - 1];
  if (!last) return null;
  const segments = new Map<number, [number, number][]>();
  for (const p of points) {
    if (!segments.has(p.segment)) segments.set(p.segment, []);
    segments.get(p.segment)!.push([p.lat, p.lon]);
  }

  return (
    <MapContainer center={[points[0].lat, points[0].lon]} zoom={17} className="record-map">
      {theme === "dark" ? (
        <TileLayer
          attribution='&copy; OpenStreetMap contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
        />
      ) : (
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
      )}
      <Polyline positions={[...segments.values()]} />
      <CircleMarker
        center={[last.lat, last.lon]}
        radius={7}
        pathOptions={{ color: "#fff", weight: 2, fillColor: "#2563eb", fillOpacity: 1 }}
        interactive={false}
      />
      <Follow point={last} follow={follow} />
    </MapContainer>
  );
}
