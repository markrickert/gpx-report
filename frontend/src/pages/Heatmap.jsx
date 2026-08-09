import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@apollo/client";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet.heat";
import { GET_HEATMAP_POINTS, GET_RECENT_ACTIVITY_BOUNDS } from "../graphql/queries.js";
import { useTheme } from "../theme.jsx";

// Low -> high elevation.
const ELEVATION_BAND_COLORS = ["#2563eb", "#22c55e", "#f59e0b", "#ef4444"];

// Smoother, cooler-to-warmer intensity ramp than leaflet.heat's default
// blue/lime/red, closer to the app's existing accent palette.
const DEFAULT_GRADIENT = { 0.3: "#2563eb", 0.55: "#22c55e", 0.8: "#f59e0b", 1: "#ef4444" };

// leaflet.heat is a plain Leaflet plugin (not React-aware), so it's wired
// into react-leaflet's MapContainer imperatively via useMap() instead of
// being rendered as JSX.
function HeatLayer({ points, gradient = DEFAULT_GRADIENT }) {
  const map = useMap();

  useEffect(() => {
    if (!points.length) return undefined;
    const layer = L.heatLayer(points, {
      radius: 14,
      blur: 22,
      maxZoom: 17,
      minOpacity: 0.35,
      gradient,
    }).addTo(map);

    // leaflet.heat only repositions/redraws its canvas on "moveend" and
    // "zoomanim" (the single CSS-animated transition from a button/wheel
    // zoom). Touch pinch-zoom drives the map via repeated "move"/"zoom"
    // events instead of a "zoomanim" transition, which leaflet.heat never
    // listens for, so the overlay sat frozen for the whole pinch gesture
    // and only snapped into place once the gesture ended. Re-running its
    // own reset on "move" keeps it live during pinch too — "move" alone is
    // enough (Leaflet's Map._move always fires "move" whenever it fires
    // "zoom" for a pinch update), and listening to both fired the same
    // O(latlngs.length) canvas redraw twice per animation frame during a
    // two-finger pinch, which was the main cause of choppy pinch-zoom on
    // this page (a plain one-finger drag never triggers the "zoom" event,
    // so it never hit the double-redraw).
    const follow = () => layer._reset();
    map.on("move", follow);

    return () => {
      map.off("move", follow);
      map.removeLayer(layer);
    };
  }, [map, points, gradient]);

  return null;
}

export default function Heatmap() {
  const { theme } = useTheme();
  const { data, loading, error } = useQuery(GET_HEATMAP_POINTS);
  const { data: recentBoundsData, loading: recentBoundsLoading } = useQuery(
    GET_RECENT_ACTIVITY_BOUNDS,
  );
  const [byElevation, setByElevation] = useState(false);

  const points = useMemo(() => data?.heatmapPoints ?? [], [data]);

  // Default the initial view to wherever activity has actually happened in
  // the last few months (recentActivityBounds), falling back to fitting all
  // points on record if there's no recent activity (fresh install, or a
  // stale/inactive deployment).
  const allPointsBounds = useMemo(() => points.map(([lat, lon]) => [lat, lon]), [points]);
  const bounds = recentBoundsData?.recentActivityBounds ?? allPointsBounds;

  // Quartile boundaries of this dataset's elevation range, used both to
  // bucket points into the 4 color bands and to label the legend.
  const bandBounds = useMemo(() => {
    const elevations = points
      .map((p) => p[2])
      .filter((e) => e != null)
      .sort((a, b) => a - b);
    if (!elevations.length) return null;
    const at = (p) =>
      elevations[Math.min(elevations.length - 1, Math.floor(p * (elevations.length - 1)))];
    return [at(0), at(0.25), at(0.5), at(0.75), at(1)];
  }, [points]);

  const bands = useMemo(() => {
    if (!byElevation || !bandBounds) return [];
    const buckets = [[], [], [], []];
    for (const [lat, lon, elevation] of points) {
      if (elevation == null) continue;
      let band = 0;
      for (let i = 1; i < 4; i++) {
        if (elevation >= bandBounds[i]) band = i;
      }
      buckets[band].push([lat, lon, 0.5]);
    }
    return buckets;
  }, [byElevation, points, bandBounds]);

  if (loading || recentBoundsLoading) return <p>Loading...</p>;
  if (error) return <p>Error loading heatmap: {error.message}</p>;
  if (!points.length) return <p>No activity data yet.</p>;

  return (
    <div>
      <h1>Heatmap</h1>
      <div className="heatmap-card heatmap-controls">
        <label>
          <input
            type="checkbox"
            checked={byElevation}
            onChange={(e) => setByElevation(e.target.checked)}
          />
          Color by elevation
        </label>
        {byElevation && bandBounds && (
          <ul className="heatmap-legend">
            {ELEVATION_BAND_COLORS.map((color, i) => (
              <li key={color}>
                <span className="heatmap-legend-swatch" style={{ backgroundColor: color }} />
                {Math.round(bandBounds[i])}–{Math.round(bandBounds[i + 1])}m
              </li>
            ))}
          </ul>
        )}
      </div>
      <MapContainer bounds={bounds} boundsOptions={{ padding: [20, 20] }} className="heatmap-map">
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
        {byElevation ? (
          bands.map(
            (bandPoints, i) =>
              bandPoints.length > 0 && (
                <HeatLayer
                  key={ELEVATION_BAND_COLORS[i]}
                  points={bandPoints}
                  gradient={{ 0.4: ELEVATION_BAND_COLORS[i], 1: ELEVATION_BAND_COLORS[i] }}
                />
              ),
          )
        ) : (
          <HeatLayer points={points.map(([lat, lon]) => [lat, lon, 0.5])} />
        )}
      </MapContainer>
    </div>
  );
}
