import { memo, useEffect, useRef, useState } from "react";
import { Platform, type StyleProp, type ViewStyle } from "react-native";
import { AppleMaps, GoogleMaps } from "expo-maps";
import * as Location from "expo-location";
import type { TrackPoint } from "@/recording/types";

type Props = { points: TrackPoint[]; follow: boolean; style?: StyleProp<ViewStyle> };
type Camera = { coordinates: { latitude: number; longitude: number }; zoom: number };

const TRACK_COLOR = "#2563eb";
const FOLLOW_ZOOM = 16;
// The native map decodes and redraws the whole polyline on the main thread at
// every update, so a long track freezes the screen's buttons. Only the newest
// points stay at full detail; the older ones thin out to a fixed budget.
const FULL_DETAIL_POINTS = 200;
const MAX_THINNED_VERTICES = 1000;

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

// Memoized so the screen's one-second clock tick doesn't resend the track.
export const LiveTrackMap = memo(function LiveTrackMap({ points, follow, style }: Props) {
  const map = useRef<{ setCameraPosition(camera: Camera): void }>(null);
  const last = points[points.length - 1];
  // The live position only matters before the first point and while recording,
  // not on a finished track.
  const wantsLocation = !last || follow;
  const [canShowLocation, setCanShowLocation] = useState(false);
  const [here, setHere] = useState<Camera["coordinates"]>();
  // Google Maps rejects camera moves until its map has loaded; Apple Maps
  // accepts them right away.
  const [mapReady, setMapReady] = useState(Platform.OS === "ios");

  useEffect(() => {
    if (!wantsLocation) return;
    Location.requestForegroundPermissionsAsync().then(async ({ granted }) => {
      setCanShowLocation(granted);
      if (!granted) return;
      const position =
        (await Location.getLastKnownPositionAsync()) ?? (await Location.getCurrentPositionAsync());
      const { latitude, longitude } = position.coords;
      setHere({ latitude, longitude });
    });
  }, [wantsLocation]);

  useEffect(() => {
    if (!mapReady) return;
    let camera: Camera | undefined;
    if (!last) camera = here && { coordinates: here, zoom: FOLLOW_ZOOM };
    else if (follow)
      camera = { coordinates: { latitude: last.lat, longitude: last.lon }, zoom: FOLLOW_ZOOM };
    else camera = fitCamera(points);
    if (camera) map.current?.setCameraPosition(camera);
  }, [mapReady, here, points, last, follow]);

  const segments = new Map<number, { latitude: number; longitude: number }[]>();
  const detailFrom = points.length - FULL_DETAIL_POINTS;
  const stride = Math.max(1, Math.ceil(detailFrom / MAX_THINNED_VERTICES));
  for (const [i, p] of points.entries()) {
    if (i < detailFrom && i % stride !== 0) continue;
    if (!segments.has(p.segment)) segments.set(p.segment, []);
    segments.get(p.segment)!.push({ latitude: p.lat, longitude: p.lon });
  }
  // Without a stable id the map gives each update a new one and rebuilds the
  // line instead of extending it.
  const polylines = [...segments].map(([segment, coordinates]) => ({
    id: String(segment),
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

  return Platform.OS === "ios" ? (
    <AppleMaps.View {...shared} />
  ) : (
    <GoogleMaps.View {...shared} onMapLoaded={() => setMapReady(true)} />
  );
});
