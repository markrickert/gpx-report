import { useEffect, useRef, useState } from "react";
import { Platform, type StyleProp, type ViewStyle } from "react-native";
import { AppleMaps, GoogleMaps } from "expo-maps";
import * as Location from "expo-location";
import type { TrackPoint } from "@/recording/types";

type Props = { points: TrackPoint[]; follow: boolean; style?: StyleProp<ViewStyle> };
type Camera = { coordinates: { latitude: number; longitude: number }; zoom: number };

const TRACK_COLOR = "#2563eb";
const FOLLOW_ZOOM = 16;

// Neither map view can fit bounds, so estimate the zoom that shows the whole
// track: at zoom z a ~350pt-wide view spans about 492 / 2^z degrees.
function fitCamera(points: TrackPoint[]): Camera {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
  const [minLon, maxLon] = [Math.min(...lons), Math.max(...lons)];
  const midLat = (minLat + maxLat) / 2;
  const span = Math.max(maxLon - minLon, (maxLat - minLat) / Math.cos((midLat * Math.PI) / 180));
  const zoom = span > 0 ? Math.log2(492 / (span * 1.3)) : FOLLOW_ZOOM;
  return {
    coordinates: { latitude: midLat, longitude: (minLon + maxLon) / 2 },
    zoom: Math.min(FOLLOW_ZOOM, Math.max(3, zoom)),
  };
}

export function LiveTrackMap({ points, follow, style }: Props) {
  const map = useRef<{ setCameraPosition(camera: Camera): void }>(null);
  const last = points[points.length - 1];
  // The live position only matters before the first point and while recording,
  // not on a finished track.
  const wantsLocation = !last || follow;
  const [canShowLocation, setCanShowLocation] = useState(false);

  useEffect(() => {
    if (!wantsLocation) return;
    Location.requestForegroundPermissionsAsync().then(async ({ granted }) => {
      setCanShowLocation(granted);
      if (!granted || last) return;
      const here =
        (await Location.getLastKnownPositionAsync()) ?? (await Location.getCurrentPositionAsync());
      const { latitude, longitude } = here.coords;
      map.current?.setCameraPosition({ coordinates: { latitude, longitude }, zoom: FOLLOW_ZOOM });
    });
    // Only re-run when location becomes wanted, not on every new point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsLocation]);

  useEffect(() => {
    if (!last) return;
    map.current?.setCameraPosition(
      follow
        ? { coordinates: { latitude: last.lat, longitude: last.lon }, zoom: FOLLOW_ZOOM }
        : fitCamera(points),
    );
  }, [points, last, follow]);

  const segments = new Map<number, { latitude: number; longitude: number }[]>();
  for (const p of points) {
    if (!segments.has(p.segment)) segments.set(p.segment, []);
    segments.get(p.segment)!.push({ latitude: p.lat, longitude: p.lon });
  }
  const polylines = [...segments.values()].map((coordinates) => ({
    coordinates,
    color: TRACK_COLOR,
    width: 4,
  }));
  const shared = {
    ref: map as never,
    style,
    polylines,
    cameraPosition: last ? fitCamera(points) : undefined,
    properties: { isMyLocationEnabled: wantsLocation && canShowLocation },
  };

  return Platform.OS === "ios" ? <AppleMaps.View {...shared} /> : <GoogleMaps.View {...shared} />;
}
