import { StyleSheet, View } from "react-native";
import { useTheme } from "@/hooks/use-theme";

const SIZE = 48;
const PADDING = 4;
const STROKE = 2;

// Native twin of the web dashboard's SVG RouteThumbnail. routeThumbnail is
// already sampled down to a handful of [lat, lon] pairs by the server; each
// segment is drawn as a rotated View since the app has no SVG renderer.
export function RouteThumbnail({ routeThumbnail }: { routeThumbnail?: number[][] | null }) {
  const colors = useTheme();
  const points = project(routeThumbnail);

  return (
    <View style={[styles.box, points && { backgroundColor: colors.backgroundSelected }]}>
      {points?.slice(1).map(([x2, y2], i) => {
        const [x1, y1] = points[i];
        // Overshoot by one stroke width so neighboring segments overlap at the joins.
        const length = Math.hypot(x2 - x1, y2 - y1) + STROKE;
        return (
          <View
            key={i}
            style={[
              styles.segment,
              {
                left: (x1 + x2) / 2 - length / 2,
                top: (y1 + y2) / 2 - STROKE / 2,
                width: length,
                transform: [{ rotate: `${Math.atan2(y2 - y1, x2 - x1)}rad` }],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

function project(routeThumbnail?: number[][] | null): number[][] | null {
  if (!routeThumbnail || routeThumbnail.length < 2) return null;

  const lats = routeThumbnail.map((p) => p[0]);
  const lons = routeThumbnail.map((p) => p[1]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const latRange = maxLat - minLat || 1e-9;
  const lonRange = maxLon - minLon || 1e-9;

  const drawable = SIZE - PADDING * 2;
  const scale = drawable / Math.max(latRange, lonRange);
  const offsetX = PADDING + (drawable - lonRange * scale) / 2;
  const offsetY = PADDING + (drawable - latRange * scale) / 2;

  return routeThumbnail.map(([lat, lon]) => [
    offsetX + (lon - minLon) * scale,
    offsetY + (maxLat - lat) * scale,
  ]);
}

const styles = StyleSheet.create({
  box: { width: SIZE, height: SIZE, borderRadius: 6, overflow: "hidden" },
  segment: {
    position: "absolute",
    height: STROKE,
    borderRadius: STROKE / 2,
    backgroundColor: "#2563eb",
  },
});
